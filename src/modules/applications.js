const { COLOR, FOOTER } = require('../config');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const Application = require('../models/Application');
const { getConfig } = require('../utils/guildConfig');

const EPH = MessageFlags.Ephemeral;

/** Кнопка с СТАТИЧНЫМ customId «app:apply» — работает всегда, в т.ч. после перезапуска бота. */
function panelPayload() {
  const embed = new EmbedBuilder()
    .setColor(COLOR).setFooter(FOOTER)
    .setTitle('📝 Подать заявку')
    .setDescription('Нажмите кнопку ниже и ответьте на вопросы анкеты.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('app:apply').setLabel('Подать заявку').setEmoji('📝').setStyle(ButtonStyle.Primary)
  );
  return { embeds: [embed], components: [row] };
}

async function openForm(interaction) {
  const { applications: a } = await getConfig(interaction.guildId);
  if (!a.channelId || !a.questions.length)
    return interaction.reply({ content: '❌ Заявки ещё не настроены администрацией.', flags: EPH });
  if (await Application.exists({ guildId: interaction.guildId, userId: interaction.user.id, status: 'pending' }))
    return interaction.reply({ content: '⏳ Ваша предыдущая заявка ещё рассматривается.', flags: EPH });

  const modal = new ModalBuilder().setCustomId('app:submit').setTitle('Анкета');
  a.questions.slice(0, 5).forEach((q, i) =>
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(`q${i}`).setLabel(q.slice(0, 45)).setPlaceholder(q.slice(0, 100))
          .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
      )
    )
  );
  return interaction.showModal(modal);
}

async function submit(interaction) {
  const { applications: a } = await getConfig(interaction.guildId);
  const channel = interaction.guild.channels.cache.get(a.channelId);
  if (!channel?.isTextBased())
    return interaction.reply({ content: '❌ Канал для заявок недоступен. Сообщите администрации.', flags: EPH });

  const answers = a.questions.slice(0, 5).map((q, i) => ({ question: q, answer: interaction.fields.getTextInputValue(`q${i}`) }));
  const doc = await Application.create({ guildId: interaction.guildId, userId: interaction.user.id, answers });

  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('📝 Новая заявка')
    .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
    .setDescription(`**Автор:** <@${interaction.user.id}> (\`${interaction.user.id}\`)`)
    .addFields(answers.map((x) => ({ name: x.question.slice(0, 256), value: x.answer.slice(0, 1024) })))
    .setFooter({ text: `ID: ${doc.id}` })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`app:accept:${doc.id}`).setLabel('Принять').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`app:reject:${doc.id}`).setLabel('Отклонить').setEmoji('❌').setStyle(ButtonStyle.Danger)
  );
  const msg = await channel.send({ embeds: [embed], components: [row] });
  doc.messageId = msg.id;
  await doc.save();
  return interaction.reply({ content: '✅ Заявка отправлена! Ожидайте решения.', flags: EPH });
}

async function review(interaction, id, status, reason = null) {
  const app = await Application.findById(id);
  if (!app || app.status !== 'pending')
    return interaction.reply({ content: 'ℹ️ Эта заявка уже обработана.', flags: EPH });

  app.status = status;
  app.reviewerId = interaction.user.id;
  app.reason = reason;
  app.reviewedAt = new Date();
  await app.save();

  const accepted = status === 'accepted';
  if (accepted) {
    const { applications: a } = await getConfig(interaction.guildId);
    if (a.acceptRoleId) {
      const member = await interaction.guild.members.fetch(app.userId).catch(() => null);
      await member?.roles.add(a.acceptRoleId, 'Заявка принята').catch(() => {});
    }
  }

  const embed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(accepted ? 0x57f287 : 0xed4245)
    .addFields({
      name: 'Решение',
      value: `${accepted ? '✅ Принята' : '❌ Отклонена'} — <@${interaction.user.id}>${reason ? `\nПричина: ${reason}` : ''}`,
    });
  await interaction.update({ embeds: [embed], components: [] });

  const user = await interaction.client.users.fetch(app.userId).catch(() => null);
  await user
    ?.send(`Ваша заявка на **${interaction.guild.name}** ${accepted ? '✅ принята!' : `❌ отклонена.${reason ? `\nПричина: ${reason}` : ''}`}`)
    .catch(() => {});
}

async function handle(interaction) {
  const [, action, id] = interaction.customId.split(':');
  if (action === 'apply') return openForm(interaction);
  if (action === 'submit') return submit(interaction);

  // Дальше — только модераторы
  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles))
    return interaction.reply({ content: '❌ Нужно право «Управление ролями».', flags: EPH });

  if (action === 'accept') return review(interaction, id, 'accepted');
  if (action === 'reject') {
    const modal = new ModalBuilder().setCustomId(`app:rejectsubmit:${id}`).setTitle('Отклонение заявки').addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('reason').setLabel('Причина (необязательно)')
          .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)
      )
    );
    return interaction.showModal(modal);
  }
  if (action === 'rejectsubmit') return review(interaction, id, 'rejected', interaction.fields.getTextInputValue('reason').trim() || null);
}

module.exports = { handle, panelPayload };
