const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const Marriage = require('../models/Marriage');

const find = (guildId, userId) =>
  Marriage.findOne({ guildId, $or: [{ user1: userId }, { user2: userId }] });
const partnerOf = (m, userId) => (m.user1 === userId ? m.user2 : m.user1);

async function propose(interaction) {
  const target = interaction.options.getUser('user');
  const me = interaction.user;
  const eph = { flags: MessageFlags.Ephemeral };
  if (target.bot || target.id === me.id) return interaction.reply({ content: '❌ Выберите другого человека.', ...eph });
  if (await find(interaction.guildId, me.id)) return interaction.reply({ content: '❌ Вы уже в браке.', ...eph });
  if (await find(interaction.guildId, target.id)) return interaction.reply({ content: '❌ Этот пользователь уже в браке.', ...eph });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`marry:yes:${me.id}:${target.id}`).setLabel('Согласиться').setEmoji('💍').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`marry:no:${me.id}:${target.id}`).setLabel('Отказать').setEmoji('💔').setStyle(ButtonStyle.Danger)
  );
  await interaction.reply({
    content: `💍 ${target}, **${me.username}** делает вам предложение!`,
    components: [row],
    allowedMentions: { users: [target.id] },
  });
  setTimeout(() => interaction.editReply({ components: [] }).catch(() => {}), 5 * 60_000);
}

async function divorce(interaction) {
  const m = await find(interaction.guildId, interaction.user.id);
  if (!m) return interaction.reply({ content: '❌ Вы не в браке.', flags: MessageFlags.Ephemeral });
  await m.deleteOne();
  return interaction.reply(`💔 <@${interaction.user.id}> и <@${partnerOf(m, interaction.user.id)}> больше не в браке.`);
}

async function handle(interaction) {
  const [, action, proposerId, targetId] = interaction.customId.split(':');
  if (interaction.user.id !== targetId)
    return interaction.reply({ content: '❌ Это предложение адресовано не вам.', flags: MessageFlags.Ephemeral });
  if (action === 'no')
    return interaction.update({ content: `💔 <@${targetId}> отклонил(а) предложение <@${proposerId}>.`, components: [] });

  if ((await find(interaction.guildId, proposerId)) || (await find(interaction.guildId, targetId)))
    return interaction.update({ content: '❌ Кто-то из вас уже в браке.', components: [] });
  await Marriage.create({ guildId: interaction.guildId, user1: proposerId, user2: targetId });
  return interaction.update({ content: `🎉 <@${proposerId}> и <@${targetId}> теперь в браке! Совет да любовь 💖`, components: [] });
}

module.exports = { handle, propose, divorce, find, partnerOf };
