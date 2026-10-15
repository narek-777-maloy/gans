const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const { homePayload } = require('../modules/settings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Панель управления модулями сервера')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    await interaction.reply({ ...homePayload(), flags: MessageFlags.Ephemeral });
  },
};
