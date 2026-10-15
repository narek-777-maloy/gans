const { COLOR, FOOTER } = require('../config');
const { SlashCommandBuilder, InteractionContextType, EmbedBuilder } = require('discord.js');
const InviteJoin = require('../models/InviteJoin');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Сколько человек пригласил участник')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('user').setDescription('Участник (по умолчанию — вы)')),
  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const q = { guildId: interaction.guildId, inviterId: user.id };
    const [total, left] = await Promise.all([InviteJoin.countDocuments(q), InviteJoin.countDocuments({ ...q, left: true })]);
    const embed = new EmbedBuilder()
      .setColor(COLOR).setFooter(FOOTER)
      .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
      .setTitle('📨 Инвайты')
      .addFields(
        { name: 'Всего', value: String(total), inline: true },
        { name: 'Остались', value: String(total - left), inline: true },
        { name: 'Вышли', value: String(left), inline: true }
      );
    return interaction.reply({ embeds: [embed] });
  },
};
