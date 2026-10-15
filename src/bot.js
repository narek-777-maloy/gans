require('dotenv').config();
const path = require('node:path');
const mongoose = require('mongoose');
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const loadDir = require('./utils/loader');

const { DISCORD_TOKEN, MONGO_URI } = process.env;
if (!DISCORD_TOKEN || !MONGO_URI) {
  console.error('❌ Заполните DISCORD_TOKEN и MONGO_URI в файле .env');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,        // привилегированный
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,      // привилегированный
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

// --- Команды ---
client.commands = new Collection();
for (const cmd of loadDir(path.join(__dirname, 'commands'))) client.commands.set(cmd.data.name, cmd);

// --- Кнопки / селекты / модалки по префиксу customId ---
client.components = new Map([
  ['settings', require('./modules/settings')],
  ['app', require('./modules/applications')],
  ['ticket', require('./modules/tickets')],
  ['backup', require('./modules/backup')],
  ['marry', require('./modules/marriage')],
]);

client.invites = new Map(); // guildId -> Map(code -> uses)

// --- События (каждое обёрнуто: ошибка в одном обработчике не роняет бота) ---
for (const ev of loadDir(path.join(__dirname, 'events'))) {
  const run = (...args) =>
    Promise.resolve()
      .then(() => ev.execute(client, ...args))
      .catch((err) => console.error(`[event:${ev.name}]`, err));
  ev.once ? client.once(ev.name, run) : client.on(ev.name, run);
}

// --- Глобальная защита от крашей ---
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
client.on('error', (err) => console.error('[client:error]', err));
client.on('shardError', (err) => console.error('[client:shardError]', err));
mongoose.connection.on('error', (err) => console.error('[mongo:error]', err.message));
mongoose.connection.on('disconnected', () => console.warn('[mongo] соединение потеряно, драйвер переподключится сам'));

async function shutdown(signal) {
  console.log(`[bot] ${signal}: завершаю работу…`);
  try {
    await client.destroy();
    await mongoose.disconnect();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10_000 });
    console.log('[mongo] подключено');
    await client.login(DISCORD_TOKEN);
  } catch (err) {
    console.error('❌ Не удалось запустить бота:', err.message);
    process.exit(1);
  }
})();
