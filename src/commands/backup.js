const {
  SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, AttachmentBuilder, MessageFlags,
} = require('discord.js');
const Backup = require('../models/Backup');
const { create, confirmRow } = require('../modules/backup');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Бэкап структуры сервера (роли, категории, каналы)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('create').setDescription('Сохранить структуру сервера в JSON')
      .addStringOption((o) => o.setName('name').setDescription('Название бэкапа').setMaxLength(50)))
    .addSubcommand((s) => s.setName('load').setDescription('Загрузить бэкап')
      .addStringOption((o) => o.setName('id').setDescription('Бэкап').setRequired(true).setAutocomplete(true))
      .addBooleanOption((o) => o.setName('clear').setDescription('Сначала удалить все текущие каналы и роли (по умолчанию — да)')))
    .addSubcommand((s) => s.setName('list').setDescription('Список бэкапов')),

  async autocomplete(interaction) {
    const list = await Backup.find({ guildId: interaction.guildId }).sort({ createdAt: -1 }).limit(25).select('name createdAt').lean();
    await interaction.respond(list.map((b) => ({ name: `${b.name} — ${b.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`.slice(0, 100), value: String(b._id) })));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { doc, data } = await create(interaction.guild, interaction.options.getString('name'));
      return interaction.editReply({
        content: `✅ Бэкап **${doc.name}** создан (ролей: ${data.roles.length}, каналов: ${data.channels.length}).\nID: \`${doc.id}\``,
        files: [new AttachmentBuilder(Buffer.from(JSON.stringify(data, null, 2)), { name: `backup-${doc.id}.json` })],
      });
    }

    if (sub === 'list') {
      const list = await Backup.find({ guildId: interaction.guildId }).sort({ createdAt: -1 }).limit(20).lean();
      const text = list.map((b) => `• **${b.name}** — <t:${Math.floor(b.createdAt.getTime() / 1000)}:f>\n  \`${b._id}\``).join('\n');
      return interaction.reply({ content: text || 'Бэкапов нет.', flags: MessageFlags.Ephemeral });
    }

    // load
    const id = interaction.options.getString('id');
    const clear = interaction.options.getBoolean('clear') ?? true;
    const doc = await Backup.findOne({ _id: id, guildId: interaction.guildId }).select('name').catch(() => null);
    if (!doc) return interaction.reply({ content: '❌ Бэкап не найден.', flags: MessageFlags.Ephemeral });
    return interaction.reply({
      content: `⚠️ Загрузить бэкап **${doc.name}**?${clear ? '\n**Все текущие каналы и роли будут удалены!**' : '\nСтруктура будет добавлена к существующей.'}`,
      components: [confirmRow(id, clear, interaction.user.id)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
