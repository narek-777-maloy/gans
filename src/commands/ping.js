const { SlashCommandBuilder, EmbedBuilder, InteractionContextType } = require('discord.js');
const { COLOR, FOOTER } = require('../config');

const fmt = (s) => `${Math.floor(s / 86400)}д ${Math.floor((s % 86400) / 3600)}ч ${Math.floor((s % 3600) / 60)}м`;

module.exports = {
  data: new SlashCommandBuilder().setName('ping').setDescription('Задержка и аптайм бота').setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    const latency = Date.now() - interaction.createdTimestamp;
    const embed = new EmbedBuilder()
      .setColor(COLOR).setFooter(FOOTER).setTitle('🏓 Понг!')
      .addFields(
        { name: 'Ответ', value: `${Math.max(latency, 0)} мс`, inline: true },
        { name: 'WebSocket', value: `${Math.round(interaction.client.ws.ping)} мс`, inline: true },
        { name: 'Аптайм', value: fmt(process.uptime()), inline: true }
      );
    return interaction.reply({ embeds: [embed] });
  },
};
