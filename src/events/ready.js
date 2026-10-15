const { Events } = require('discord.js');
const { ensureGuild } = require('../utils/guildConfig');
const { startAfkCron } = require('../modules/afk');
const { startDashboard } = require('../dashboard/server');

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    console.log(`[bot] вошёл как ${client.user.tag}`);

    // Конфиги для серверов, на которых бот уже был до запуска
    for (const guild of client.guilds.cache.values()) await ensureGuild(guild.id);

    const body = [...client.commands.values()].map((c) => c.data.toJSON());
    if (process.env.DEV_GUILD_ID) {
      const g = await client.guilds.fetch(process.env.DEV_GUILD_ID);
      await g.commands.set(body);
    } else {
      await client.application.commands.set(body);
    }
    console.log(`[bot] зарегистрировано команд: ${body.length}`);

    startAfkCron(client);
    startDashboard(client);
  },
};
