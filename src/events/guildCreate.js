const { ensureGuild } = require('../utils/guildConfig');

module.exports = {
  name: 'guildCreate',
  async execute(client, guild) {
    await ensureGuild(guild.id); // документ конфигурации по умолчанию
    console.log(`[guildCreate] ${guild.name} (${guild.id}) — конфигурация создана`);
  },
};
