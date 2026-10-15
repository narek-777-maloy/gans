const cron = require('node-cron');
const UserActivity = require('../models/UserActivity');
const { getConfig } = require('../utils/guildConfig');

const lastWrite = new Map(); // троттлинг записей в БД
const DAY = 86_400_000;
const state = { running: false, lastRun: null, lastResult: null }; // для /afk и дашборда

/** Фиксирует активность и снимает роль AFK, если она есть. */
async function markActive(member) {
  if (!member || member.user.bot) return;
  const cfg = await getConfig(member.guild.id);
  const roleId = cfg.afk.roleId;
  const hasRole = Boolean(roleId && member.roles.cache.has(roleId));

  const key = `${member.guild.id}:${member.id}`;
  const now = Date.now();
  if (!hasRole && now - (lastWrite.get(key) ?? 0) < 60_000) return; // не чаще раза в минуту
  lastWrite.set(key, now);

  await UserActivity.updateOne(
    { guildId: member.guild.id, userId: member.id },
    { $set: { lastActive: new Date(now), hasAfk: false } },
    { upsert: true }
  );
  if (hasRole) await member.roles.remove(roleId, 'Активность: снятие AFK').catch(() => {});
}

async function checkGuild(guild) {
  const { enabled, roleId, days } = (await getConfig(guild.id)).afk;
  if (!enabled) return { skipped: 'модуль выключен' };
  if (!roleId) return { skipped: 'не выбрана роль AFK' };
  const role = guild.roles.cache.get(roleId);
  if (!role) return { skipped: 'роль AFK не найдена' };
  if (!role.editable) return { skipped: 'роль бота стоит ниже роли AFK' };

  // Все, кто сейчас сидит в голосовых каналах, считаются активными
  for (const vs of guild.voiceStates.cache.values()) if (vs.channelId && vs.member) await markActive(vs.member);

  const members = await guild.members.fetch();
  const records = await UserActivity.find({ guildId: guild.id }).lean();
  const lastMap = new Map(records.map((r) => [r.userId, r.lastActive.getTime()]));
  const threshold = Date.now() - days * DAY;

  let checked = 0;
  let assigned = 0;
  for (const member of members.values()) {
    if (member.user.bot) continue;
    checked++;
    if (member.roles.cache.has(roleId)) continue;
    // Нет записи — считаем от даты захода на сервер
    const last = lastMap.get(member.id) ?? member.joinedTimestamp ?? Date.now();
    if (last >= threshold) continue;
    const ok = await member.roles.add(roleId, `Инактив более ${days} дн.`).then(() => true, () => false);
    if (!ok) continue;
    assigned++;
    await UserActivity.updateOne(
      { guildId: guild.id, userId: member.id },
      { $set: { hasAfk: true }, $setOnInsert: { lastActive: new Date(last) } },
      { upsert: true }
    );
  }
  return { checked, assigned };
}

/** Проверка всех серверов (или одного). Параллельный запуск блокируется. */
async function runAfkCheck(client, onlyGuild = null) {
  if (state.running) return { skipped: true };
  state.running = true;
  try {
    lastWrite.clear();
    const results = {};
    const guilds = onlyGuild ? [onlyGuild] : [...client.guilds.cache.values()];
    for (const g of guilds) {
      try {
        results[g.id] = await checkGuild(g);
      } catch (e) {
        console.error(`[afk] ${g.id}`, e);
        results[g.id] = { error: e.message };
      }
    }
    state.lastRun = Date.now();
    state.lastResult = { ...(state.lastResult ?? {}), ...results };
    return results;
  } finally {
    state.running = false;
  }
}

/** Автопроверка: через 30 с после запуска + по расписанию (по умолчанию ежедневно 04:00). */
function startAfkCron(client) {
  let expr = process.env.AFK_CRON || '0 4 * * *';
  if (!cron.validate(expr)) {
    console.warn(`[afk] неверный AFK_CRON "${expr}", использую "0 4 * * *"`);
    expr = '0 4 * * *';
  }
  cron.schedule(expr, () => runAfkCheck(client).catch(console.error), { timezone: process.env.CRON_TZ || 'UTC' });
  setTimeout(() => runAfkCheck(client).catch(console.error), 30_000);
  console.log(`[afk] автопроверка: при старте и по cron "${expr}"`);
}

module.exports = { markActive, runAfkCheck, startAfkCron, state };
