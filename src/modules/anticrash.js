const { AuditLogEvent } = require('discord.js');
const { getConfig } = require('../utils/guildConfig');
const { sendLog, findAuditEntry, logEmbed } = require('./logger');

const hits = new Map(); // "guildId:userId" -> [timestamps]

/** Учитывает удаление канала/роли и наказывает при превышении лимита за окно времени. */
async function track(guild, auditType, targetId, label) {
  const { anticrash: ac } = (await getConfig(guild.id)).security;
  if (!ac.enabled) return;

  const entry =
    (await findAuditEntry(guild, auditType, targetId)) ?? (await findAuditEntry(guild, auditType, null));
  const executor = entry?.executor;
  if (!executor) return;
  if (executor.id === guild.client.user.id || executor.id === guild.ownerId) return;
  if (ac.whitelistUsers.includes(executor.id)) return;

  const key = `${guild.id}:${executor.id}`;
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < ac.interval * 1000);
  list.push(now);
  hits.set(key, list);
  if (list.length < ac.limit) return;
  hits.delete(key);

  const reason = `Антикраш: массовое удаление (${label})`;
  const member = await guild.members.fetch(executor.id).catch(() => null);
  let result = '⚠️ не удалось применить наказание (проверьте права/иерархию ролей)';
  try {
    if (ac.punishment === 'ban') await guild.members.ban(executor.id, { reason }), (result = '🔨 бан');
    else if (ac.punishment === 'kick') await member.kick(reason), (result = '👢 кик');
    else {
      const keep = member.roles.cache.filter((r) => r.managed || r.id === guild.id).map((r) => r.id);
      await member.roles.set(keep, reason);
      result = '🧹 сняты все роли';
    }
  } catch {}

  await sendLog(
    guild,
    null,
    logEmbed('🛡️ Сработал антикраш', 0xed4245, `**Нарушитель:** <@${executor.id}>\n**Действие:** ${label}\n**Мера:** ${result}`)
  );
}

module.exports = { track, AuditLogEvent };
