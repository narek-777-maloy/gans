const { EmbedBuilder } = require('discord.js');
const { getConfig } = require('../utils/guildConfig');
const { FOOTER } = require('../config');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const trim = (s, n = 1000) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

/** Отправка в канал журнала. key=null — игнорировать флаги событий (служебные уведомления). */
async function sendLog(guild, key, embed) {
  const cfg = await getConfig(guild.id);
  const { enabled, channelId, events } = cfg.logs;
  if (!enabled || !channelId) return;
  if (key && events[key] === false) return;
  const ch = guild.channels.cache.get(channelId);
  if (!ch?.isTextBased()) return;
  await ch.send({ embeds: [embed.setTimestamp()], allowedMentions: { parse: [] } }).catch(() => {});
}

/** Ищет свежую запись аудит-лога (нужно право View Audit Log). */
async function findAuditEntry(guild, type, targetId = null, maxAge = 6000) {
  await sleep(1000); // аудит-лог пишется с задержкой
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 10 });
    return (
      logs.entries.find(
        (e) => Date.now() - e.createdTimestamp < maxAge && (!targetId || e.target?.id === targetId)
      ) ?? null
    );
  } catch {
    return null;
  }
}

const logEmbed = (title, color, description) =>
  new EmbedBuilder().setTitle(title).setColor(color).setDescription(description || null).setFooter(FOOTER);

module.exports = { sendLog, findAuditEntry, logEmbed, trim, sleep };
