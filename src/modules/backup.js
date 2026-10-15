const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, OverwriteType,
  PermissionFlagsBits, MessageFlags,
} = require('discord.js');
const Backup = require('../models/Backup');

const TEXTLIKE = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];
const VOICE = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Снимок структуры: роли, категории, каналы и оверрайды прав ролей. */
function snapshot(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((r) => !r.managed)
    .map((r) => ({
      id: r.id, name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
      permissions: r.permissions.bitfield.toString(), position: r.position, isEveryone: r.id === guild.id,
    }));
  const channels = [...guild.channels.cache.values()].map((c) => ({
    id: c.id, name: c.name, type: c.type, parentId: c.parentId, position: c.rawPosition,
    topic: c.topic ?? null, nsfw: c.nsfw ?? false, rateLimitPerUser: c.rateLimitPerUser ?? 0,
    bitrate: c.bitrate ?? null, userLimit: c.userLimit ?? null,
    overwrites: [...c.permissionOverwrites.cache.values()]
      .filter((o) => o.type === OverwriteType.Role)
      .map((o) => ({ id: o.id, allow: o.allow.bitfield.toString(), deny: o.deny.bitfield.toString() })),
  }));
  return { version: 1, guildName: guild.name, createdAt: new Date().toISOString(), roles, channels };
}

async function create(guild, name) {
  const data = snapshot(guild);
  const doc = await Backup.create({ guildId: guild.id, name: name || `backup-${new Date().toISOString().slice(0, 10)}`, data });
  return { doc, data };
}

async function restore(guild, data, clear) {
  const stats = { roles: 0, channels: 0, errors: 0 };
  const reason = 'Backup load';
  const roleMap = {};
  const chMap = {};

  if (clear) {
    for (const ch of guild.channels.cache.values()) await ch.delete(reason).catch(() => stats.errors++);
    for (const r of guild.roles.cache.values())
      if (r.id !== guild.id && !r.managed && r.editable) await r.delete(reason).catch(() => stats.errors++);
  }

  // Роли: от высшей к низшей — новые роли встают под предыдущие, порядок сохраняется
  const everyone = data.roles.find((r) => r.isEveryone);
  if (everyone) {
    roleMap[everyone.id] = guild.id;
    await guild.roles.everyone.setPermissions(BigInt(everyone.permissions), reason).catch(() => stats.errors++);
  }
  for (const r of data.roles.filter((x) => !x.isEveryone).sort((a, b) => b.position - a.position)) {
    try {
      const nr = await guild.roles.create({
        name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable,
        permissions: BigInt(r.permissions), reason,
      });
      roleMap[r.id] = nr.id;
      stats.roles++;
    } catch { stats.errors++; }
  }

  const make = async (c) => {
    const opts = {
      name: c.name, type: c.type, reason,
      parent: c.parentId ? chMap[c.parentId] : undefined,
      permissionOverwrites: c.overwrites.filter((o) => roleMap[o.id]).map((o) => ({ id: roleMap[o.id], allow: BigInt(o.allow), deny: BigInt(o.deny) })),
    };
    if (TEXTLIKE.includes(c.type)) {
      if (c.topic) opts.topic = c.topic;
      if (c.nsfw) opts.nsfw = true;
      if (c.rateLimitPerUser) opts.rateLimitPerUser = c.rateLimitPerUser;
    }
    if (VOICE.includes(c.type)) {
      if (c.bitrate) opts.bitrate = Math.min(c.bitrate, guild.maximumBitrate);
      if (c.userLimit) opts.userLimit = c.userLimit;
    }
    try {
      chMap[c.id] = (await guild.channels.create(opts)).id;
      stats.channels++;
    } catch {
      // Announcement требует Community — пробуем как обычный текстовый
      if (c.type === ChannelType.GuildAnnouncement) {
        try { chMap[c.id] = (await guild.channels.create({ ...opts, type: ChannelType.GuildText })).id; stats.channels++; return; } catch {}
      }
      stats.errors++;
    }
    await sleep(250);
  };

  const byPos = (a, b) => a.position - b.position;
  for (const c of data.channels.filter((x) => x.type === ChannelType.GuildCategory).sort(byPos)) await make(c);
  for (const c of data.channels.filter((x) => x.type !== ChannelType.GuildCategory).sort(byPos)) await make(c);
  return stats;
}

function confirmRow(backupId, clear, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`backup:confirm:${backupId}:${clear ? 1 : 0}:${userId}`).setLabel('Да, загрузить').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`backup:cancel:${backupId}:0:${userId}`).setLabel('Отмена').setStyle(ButtonStyle.Secondary)
  );
}

async function handle(interaction) {
  const [, action, backupId, clear, userId] = interaction.customId.split(':');
  if (interaction.user.id !== userId)
    return interaction.reply({ content: '❌ Это подтверждение не для вас.', flags: MessageFlags.Ephemeral });
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator))
    return interaction.reply({ content: '❌ Нужны права администратора.', flags: MessageFlags.Ephemeral });
  if (action === 'cancel') return interaction.update({ content: 'Отменено.', components: [] });

  const doc = await Backup.findOne({ _id: backupId, guildId: interaction.guildId });
  if (!doc) return interaction.update({ content: '❌ Бэкап не найден.', components: [] });

  await interaction.update({ content: '⏳ Загружаю бэкап… это может занять несколько минут.', components: [] });
  const stats = await restore(interaction.guild, doc.data, clear === '1');
  // Канал с командой мог быть удалён — отвечаем через вебхук интеракции
  await interaction
    .editReply(`✅ Готово: ролей — **${stats.roles}**, каналов — **${stats.channels}**, ошибок — **${stats.errors}**.`)
    .catch(() => {});
}

module.exports = { handle, create, confirmRow };
