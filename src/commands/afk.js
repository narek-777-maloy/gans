const {
  SlashCommandBuilder, InteractionContextType, PermissionFlagsBits, EmbedBuilder, MessageFlags,
} = require('discord.js');
const { COLOR, FOOTER } = require('../config');
const UserActivity = require('../models/UserActivity');
const { getConfig } = require('../utils/guildConfig');
const { runAfkCheck, state } = require('../modules/afk');

const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('afk')
    .setDescription('Контроль инактива')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('status').setDescription('Настройки и статус автопроверки'))
    .addSubcommand((s) => s.setName('list').setDescription('Кто сейчас в AFK'))
    .addSubcommand((s) => s.setName('check').setDescription('Запустить проверку прямо сейчас (для админов)')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const eph = { flags: MessageFlags.Ephemeral };
    const { afk } = await getConfig(interaction.guildId);

    if (sub === 'status') {
      const count = await UserActivity.countDocuments({ guildId: interaction.guildId, hasAfk: true });
      const embed = new EmbedBuilder().setColor(COLOR).setFooter(FOOTER).setTitle('💤 Контроль инактива')
        .addFields(
          { name: 'Модуль', value: afk.enabled ? '✅ включён' : '❌ выключен', inline: true },
          { name: 'Срок', value: `${afk.days} дн.`, inline: true },
          { name: 'Роль', value: afk.roleId ? `<@&${afk.roleId}>` : '—', inline: true },
          { name: 'В AFK сейчас', value: String(count), inline: true },
          { name: 'Последняя проверка', value: state.lastRun ? ts(state.lastRun) : 'ещё не было', inline: true }
        );
      return interaction.reply({ embeds: [embed], ...eph });
    }

    if (sub === 'list') {
      const list = await UserActivity.find({ guildId: interaction.guildId, hasAfk: true }).sort({ lastActive: 1 }).limit(25).lean();
      const text = list.map((r) => `<@${r.userId}> — была активность ${ts(r.lastActive.getTime())}`).join('\n');
      return interaction.reply({ content: text || '✅ Сейчас никто не в AFK.', allowedMentions: { parse: [] }, ...eph });
    }

    // check
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild))
      return interaction.reply({ content: '❌ Нужно право «Управление сервером».', ...eph });
    await interaction.deferReply(eph);
    const res = await runAfkCheck(interaction.client, interaction.guild);
    if (res.skipped === true) return interaction.editReply('⏳ Проверка уже выполняется, попробуйте через минуту.');
    const r = res[interaction.guildId];
    if (r.skipped) return interaction.editReply(`ℹ️ Проверка пропущена: ${r.skipped}.`);
    if (r.error) return interaction.editReply(`⚠️ Ошибка проверки: ${r.error}`);
    return interaction.editReply(`✅ Проверено участников: **${r.checked}**, выдано AFK: **${r.assigned}**.`);
  },
};
