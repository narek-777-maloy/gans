const { PermissionFlagsBits } = require('discord.js');

/**
 * Права команд (Napakoe): права на команды через БД.
 *  - владелец и Administrator обходят проверку (защита от самоблокировки);
 *  - роль из blacklist → доступ запрещён;
 *  - если whitelist не пуст → нужна хотя бы одна роль из него;
 *  - иначе → разрешено (дальше работают стандартные права Discord).
 */
function canUse(member, commandName, cfg, guild) {
  if (commandName === 'perms') return true;
  if (member.id === guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const entry = cfg.permissions?.[commandName];
  if (!entry) return true;
  const roles = member.roles.cache;
  if (entry.blacklist?.some((id) => roles.has(id))) return false;
  if (entry.whitelist?.length) return entry.whitelist.some((id) => roles.has(id));
  return true;
}

module.exports = { canUse };
