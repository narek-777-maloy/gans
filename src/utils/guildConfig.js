const Guild = require('../models/Guild');

const cache = new Map();
const TTL = 30_000;

/** Mongoose-документ конфигурации (создаёт конфиг по умолчанию, если его нет). */
async function ensureGuild(guildId) {
  const found = await Guild.findOne({ guildId });
  if (found) return found;
  try {
    return await Guild.create({ guildId });
  } catch (e) {
    if (e.code === 11000) return Guild.findOne({ guildId }); // гонка двух создателей
    throw e;
  }
}

/** Кэшированный plain-объект — для горячих обработчиков событий. */
async function getConfig(guildId) {
  const hit = cache.get(guildId);
  if (hit && Date.now() - hit.t < TTL) return hit.v;
  const v = (await ensureGuild(guildId)).toObject();
  cache.set(guildId, { v, t: Date.now() });
  return v;
}

const invalidate = (guildId) => cache.delete(guildId);

async function save(doc) {
  await doc.save();
  invalidate(doc.guildId);
}

module.exports = { ensureGuild, getConfig, invalidate, save };
