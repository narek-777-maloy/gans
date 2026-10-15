const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, MessageFlags } = require('discord.js');
const { panelPayload } = require('../modules/tickets');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Система тикетов')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('setup').setDescription('Опубликовать панель создания тикетов')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Канал для панели (по умолчанию — текущий)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    ),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    await channel.send(panelPayload());
    await interaction.reply({
      content: `✅ Панель опубликована в ${channel}. Категория, роль и канал логов — в \`/settings\` → Тикеты.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
