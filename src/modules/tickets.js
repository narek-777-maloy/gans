const { COLOR, FOOTER } = require('../config');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder,
  ChannelType, PermissionFlagsBits: P, MessageFlags,
} = require('discord.js');
const Ticket = require('../models/Ticket');
const { getConfig } = require('../utils/guildConfig');

const EPH = MessageFlags.Ephemeral;
const MEMBER_PERMS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles];

function panelPayload() {
  const embed = new EmbedBuilder().setColor(COLOR).setFooter(FOOTER).setTitle('🎫 Поддержка')
    .setDescription('Нужна помощь? Нажмите кнопку — мы создадим приватный канал.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:open').setLabel('Создать тикет').setEmoji('🎫').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

async function open(interaction) {
  const { guild, user } = interaction;
  const t = (await getConfig(guild.id)).tickets;
  if (!t.enabled || !t.categoryId)
    return interaction.reply({ content: '❌ Тикеты не настроены.', flags: EPH });

  const existing = await Ticket.findOne({ guildId: guild.id, userId: user.id, status: 'open' });
  if (existing) {
    if (guild.channels.cache.has(existing.channelId))
      return interaction.reply({ content: `У вас уже есть тикет: <#${existing.channelId}>`, flags: EPH });
    existing.status = 'closed';
    await existing.save();
  }

  await interaction.deferReply({ flags: EPH });
  const number = (await Ticket.countDocuments({ guildId: guild.id })) + 1;
  const supportRole = t.supportRoleId && guild.roles.cache.has(t.supportRoleId) ? t.supportRoleId : null;

  const channel = await guild.channels.create({
    name: `ticket-${String(number).padStart(4, '0')}`,
    type: ChannelType.GuildText,
    parent: t.categoryId,
    topic: `Тикет #${number} — ${user.tag} (${user.id})`,
    permissionOverwrites: [
      { id: guild.id, deny: [P.ViewChannel] },
      { id: user.id, allow: MEMBER_PERMS },
      { id: interaction.client.user.id, allow: [...MEMBER_PERMS, P.ManageChannels] },
      ...(supportRole ? [{ id: supportRole, allow: MEMBER_PERMS }] : []),
    ],
  });
  await Ticket.create({ guildId: guild.id, channelId: channel.id, userId: user.id, number });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Закрыть тикет').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );
  await channel.send({
    content: `${user}${supportRole ? ` <@&${supportRole}>` : ''}`,
    embeds: [new EmbedBuilder().setColor(0x57f287).setTitle(`Тикет #${number}`)
      .setDescription('Опишите вашу проблему — скоро с вами свяжутся.')],
    components: [row],
    allowedMentions: { users: [user.id], roles: supportRole ? [supportRole] : [] },
  });
  return interaction.editReply(`✅ Тикет создан: ${channel}`);
}

async function buildTranscript(channel) {
  const all = [];
  let before;
  for (let i = 0; i < 10; i++) { // до 1000 сообщений
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
  }
  return all.reverse().map((m) =>
    `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}${m.attachments.size ? ` ${m.attachments.map((a) => a.url).join(' ')}` : ''}`
  ).join('\n');
}

async function close(interaction) {
  const ticket = await Ticket.findOne({ channelId: interaction.channelId, status: 'open' });
  if (!ticket) return interaction.reply({ content: 'Тикет не найден или уже закрыт.', flags: EPH });

  const t = (await getConfig(interaction.guildId)).tickets;
  const m = interaction.member;
  const allowed = interaction.user.id === ticket.userId || (t.supportRoleId && m.roles.cache.has(t.supportRoleId)) || m.permissions.has(P.ManageChannels);
  if (!allowed) return interaction.reply({ content: '❌ Закрыть тикет может автор или поддержка.', flags: EPH });

  await interaction.reply('🔒 Закрываю тикет, сохраняю лог…');
  const text = (await buildTranscript(interaction.channel)) || '(пусто)';

  ticket.status = 'closed';
  ticket.closedBy = interaction.user.id;
  await ticket.save();

  const logCh = t.logChannelId && interaction.guild.channels.cache.get(t.logChannelId);
  if (logCh?.isTextBased()) {
    await logCh.send({
      embeds: [new EmbedBuilder().setColor(0xed4245).setTitle(`🎫 Тикет #${ticket.number} закрыт`)
        .addFields({ name: 'Автор', value: `<@${ticket.userId}>`, inline: true }, { name: 'Закрыл', value: `<@${interaction.user.id}>`, inline: true }).setTimestamp()],
      files: [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `ticket-${ticket.number}.txt` })],
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
  setTimeout(() => interaction.channel.delete(`Тикет закрыт: ${interaction.user.tag}`).catch(() => {}), 5000);
}

async function handle(interaction) {
  const action = interaction.customId.split(':')[1];
  if (action === 'open') return open(interaction);
  if (action === 'close') return close(interaction);
}

module.exports = { handle, panelPayload };
