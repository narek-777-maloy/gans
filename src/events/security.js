const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const { getConfig } = require('../utils/guildConfig');
const { sendLog, findAuditEntry, logEmbed, trim } = require('../modules/logger');
const { track } = require('../modules/anticrash');

const INVITE_RE = /(?:discord(?:app)?\.(?:gg|com\/invite)|discord\.com\/invite)\/[\w-]+/i;
const URL_RE = /(?:https?:\/\/|www\.)[^\s<>]+/i;

module.exports = [
  // ---------- Антилинк ----------
  {
    name: 'messageCreate',
    async execute(client, message) {
      if (!message.inGuild() || message.author.bot || message.webhookId) return;
      const { antilink: al } = (await getConfig(message.guildId)).security;
      if (!al.enabled) return;

      if (al.whitelistChannels.includes(message.channelId)) return;
      if (message.channel.parentId && al.whitelistChannels.includes(message.channel.parentId)) return;
      const member = message.member;
      if (!member) return;
      if (member.permissions.has(PermissionFlagsBits.Administrator)) return;
      if (member.roles.cache.some((r) => al.whitelistRoles.includes(r.id))) return;

      const text = message.content;
      const hit = al.blockAll ? URL_RE.test(text) || INVITE_RE.test(text) : INVITE_RE.test(text);
      if (!hit) return;

      await message.delete().catch(() => {});
      const warn = await message.channel
        .send({ content: `${message.author}, ссылки в этом канале запрещены.`, allowedMentions: { users: [message.author.id] } })
        .catch(() => null);
      setTimeout(() => warn?.delete().catch(() => {}), 5000);

      await sendLog(
        message.guild,
        null,
        logEmbed('🔗 Антилинк', 0xfee75c, `**Автор:** <@${message.author.id}>\n**Канал:** <#${message.channelId}>\n\n${trim(text, 800)}`)
      );
    },
  },

  // ---------- Антибот ----------
  {
    name: 'guildMemberAdd',
    async execute(client, member) {
      if (!member.user.bot || member.id === client.user.id) return;
      const { antibot } = (await getConfig(member.guild.id)).security;
      if (!antibot.enabled || antibot.whitelist.includes(member.id)) return;

      const entry = await findAuditEntry(member.guild, AuditLogEvent.BotAdd, member.id, 15000);
      await member.kick('Антибот: бот не в белом списке').catch(() => {});
      await sendLog(
        member.guild,
        null,
        logEmbed(
          '🤖 Антибот',
          0xed4245,
          `Бот **${member.user.tag}** (\`${member.id}\`) выгнан.\n**Добавил:** ${entry?.executor ? `<@${entry.executor.id}>` : 'неизвестно'}`
        )
      );
    },
  },

  // ---------- Антикраш ----------
  {
    name: 'channelDelete',
    async execute(client, channel) {
      if (channel.guild) await track(channel.guild, AuditLogEvent.ChannelDelete, channel.id, 'удаление каналов');
    },
  },
  {
    name: 'roleDelete',
    async execute(client, role) {
      await track(role.guild, AuditLogEvent.RoleDelete, role.id, 'удаление ролей');
    },
  },
];
