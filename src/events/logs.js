const { COLOR, FOOTER } = require('../config');
const { AuditLogEvent, ChannelType } = require('discord.js');
const { sendLog, findAuditEntry, logEmbed, trim } = require('../modules/logger');

const C = { red: 0xed4245, green: 0x57f287, yellow: 0xfee75c, blue: COLOR, grey: 0x99aab5 };
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
const who = (u) => (u ? `<@${u.id}>` : 'неизвестно');

module.exports = [
  // ---------- Сообщения ----------
  {
    name: 'messageDelete',
    async execute(client, m) {
      if (!m.guild || m.author?.bot) return;
      const e = logEmbed(
        '🗑️ Сообщение удалено',
        C.red,
        `**Автор:** ${m.author ? `<@${m.author.id}>` : 'неизвестно'}\n**Канал:** <#${m.channelId}>\n\n${trim(m.content, 1500) || '*нет текста / сообщения не было в кэше*'}`
      );
      if (m.attachments?.size) e.addFields({ name: 'Вложения', value: trim(m.attachments.map((a) => a.url).join('\n')) });
      await sendLog(m.guild, 'messageDelete', e);
    },
  },
  {
    name: 'messageUpdate',
    async execute(client, before, after) {
      if (!after.guild || after.author?.bot || before.content === after.content) return;
      const e = logEmbed('✏️ Сообщение изменено', C.yellow, `**Автор:** ${who(after.author)}\n**Канал:** <#${after.channelId}>\n[Перейти к сообщению](${after.url})`).addFields(
        { name: 'До', value: trim(before.content) || '*не было в кэше*' },
        { name: 'После', value: trim(after.content) || '—' }
      );
      await sendLog(after.guild, 'messageUpdate', e);
    },
  },

  // ---------- Роли ----------
  { name: 'roleCreate', execute: (c, r) => sendLog(r.guild, 'roles', logEmbed('🎭 Роль создана', C.green, `**${r.name}** (\`${r.id}\`)`)) },
  { name: 'roleDelete', execute: (c, r) => sendLog(r.guild, 'roles', logEmbed('🎭 Роль удалена', C.red, `**${r.name}** (\`${r.id}\`)`)) },
  {
    name: 'roleUpdate',
    async execute(client, o, n) {
      const d = [];
      if (o.name !== n.name) d.push(`Название: **${o.name}** → **${n.name}**`);
      if (o.color !== n.color) d.push(`Цвет: ${hex(o.color)} → ${hex(n.color)}`);
      if (o.hoist !== n.hoist) d.push(`Отдельно в списке: ${o.hoist} → ${n.hoist}`);
      if (o.permissions.bitfield !== n.permissions.bitfield) d.push('Изменены права роли');
      if (d.length) await sendLog(n.guild, 'roles', logEmbed('🎭 Роль изменена', C.yellow, `<@&${n.id}>\n${d.join('\n')}`));
    },
  },
  {
    name: 'guildMemberUpdate',
    async execute(client, o, n) {
      if (o.partial) return;
      const added = n.roles.cache.filter((r) => !o.roles.cache.has(r.id));
      const removed = o.roles.cache.filter((r) => !n.roles.cache.has(r.id));
      if (!added.size && !removed.size) return;
      const lines = [`**Участник:** <@${n.id}>`];
      if (added.size) lines.push(`➕ ${added.map((r) => `<@&${r.id}>`).join(' ')}`);
      if (removed.size) lines.push(`➖ ${removed.map((r) => `<@&${r.id}>`).join(' ')}`);
      await sendLog(n.guild, 'roles', logEmbed('👤 Роли участника изменены', C.blue, lines.join('\n')));
    },
  },

  // ---------- Баны / кики / выходы ----------
  {
    name: 'guildBanAdd',
    async execute(client, ban) {
      const entry = await findAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
      await sendLog(
        ban.guild,
        'ban',
        logEmbed('🔨 Бан', C.red, `**Пользователь:** ${ban.user.tag} (\`${ban.user.id}\`)\n**Модератор:** ${who(entry?.executor)}\n**Причина:** ${entry?.reason ?? ban.reason ?? '—'}`)
      );
    },
  },
  {
    name: 'guildBanRemove',
    async execute(client, ban) {
      const entry = await findAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
      await sendLog(ban.guild, 'ban', logEmbed('♻️ Разбан', C.green, `**Пользователь:** ${ban.user.tag} (\`${ban.user.id}\`)\n**Модератор:** ${who(entry?.executor)}`));
    },
  },
  {
    name: 'guildMemberRemove',
    async execute(client, member) {
      const entry = await findAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
      if (entry) {
        return sendLog(
          member.guild,
          'kick',
          logEmbed('👢 Кик', C.red, `**Пользователь:** ${member.user.tag} (\`${member.id}\`)\n**Модератор:** ${who(entry.executor)}\n**Причина:** ${entry.reason ?? '—'}`)
        );
      }
      await sendLog(member.guild, 'leave', logEmbed('🚪 Участник вышел', C.grey, `**${member.user.tag}** (\`${member.id}\`)`));
    },
  },

  // ---------- Каналы ----------
  {
    name: 'channelCreate',
    execute: (c, ch) => ch.guild && sendLog(ch.guild, 'channels', logEmbed('📁 Канал создан', C.green, `<#${ch.id}> — ${ChannelType[ch.type]}`)),
  },
  {
    name: 'channelDelete',
    execute: (c, ch) => ch.guild && sendLog(ch.guild, 'channels', logEmbed('📁 Канал удалён', C.red, `**#${ch.name}** — ${ChannelType[ch.type]}`)),
  },
  {
    name: 'channelUpdate',
    async execute(client, o, n) {
      if (!n.guild) return;
      const d = [];
      if (o.name !== n.name) d.push(`Название: **${o.name}** → **${n.name}**`);
      if (o.parentId !== n.parentId) d.push(`Категория: ${o.parentId ? `<#${o.parentId}>` : '—'} → ${n.parentId ? `<#${n.parentId}>` : '—'}`);
      if ((o.topic ?? null) !== (n.topic ?? null)) d.push('Изменена тема канала');
      if (d.length) await sendLog(n.guild, 'channels', logEmbed('📁 Канал изменён', C.yellow, `<#${n.id}>\n${d.join('\n')}`));
    },
  },
];
