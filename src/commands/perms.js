const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, MessageFlags } = require('discord.js');
const { ensureGuild, save } = require('../utils/guildConfig');

const cmdOpt = (o) => o.setName('command').setDescription('Команда').setRequired(true).setAutocomplete(true);
const roleOpt = (o) => o.setName('role').setDescription('Роль').setRequired(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('perms')
    .setDescription('Napakoe: права на использование команд')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('allow').setDescription('Добавить роль в белый список команды').addStringOption(cmdOpt).addRoleOption(roleOpt))
    .addSubcommand((s) => s.setName('deny').setDescription('Добавить роль в чёрный список команды').addStringOption(cmdOpt).addRoleOption(roleOpt))
    .addSubcommand((s) => s.setName('reset').setDescription('Сбросить ограничения команды').addStringOption(cmdOpt))
    .addSubcommand((s) => s.setName('list').setDescription('Показать все ограничения')),

  async autocomplete(interaction) {
    const q = interaction.options.getFocused().toLowerCase();
    const names = [...interaction.client.commands.keys()].filter((n) => n !== 'perms' && n.includes(q)).slice(0, 25);
    await interaction.respond(names.map((n) => ({ name: `/${n}`, value: n })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const cfg = await ensureGuild(interaction.guildId);
    const perms = { ...(cfg.permissions ?? {}) };

    if (sub === 'list') {
      const lines = Object.entries(perms).map(
        ([c, e]) => `**/${c}**\n✅ ${e.whitelist?.map((r) => `<@&${r}>`).join(' ') || '—'}\n⛔ ${e.blacklist?.map((r) => `<@&${r}>`).join(' ') || '—'}`
      );
      return interaction.reply({ content: lines.join('\n\n') || 'Ограничений нет.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    }

    const name = interaction.options.getString('command');
    if (name === 'perms' || !interaction.client.commands.has(name))
      return interaction.reply({ content: '❌ Неизвестная команда.', flags: MessageFlags.Ephemeral });

    const entry = { whitelist: [], blacklist: [], ...(perms[name] ?? {}) };
    if (sub === 'reset') delete perms[name];
    else {
      const role = interaction.options.getRole('role').id;
      const [add, remove] = sub === 'allow' ? ['whitelist', 'blacklist'] : ['blacklist', 'whitelist'];
      entry[remove] = entry[remove].filter((r) => r !== role);
      if (!entry[add].includes(role)) entry[add].push(role);
      perms[name] = entry;
    }
    cfg.set('permissions', perms);
    cfg.markModified('permissions');
    await save(cfg);
    return interaction.reply({ content: `✅ Права для \`/${name}\` обновлены.`, flags: MessageFlags.Ephemeral });
  },
};
