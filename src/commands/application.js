const { SlashCommandBuilder, PermissionFlagsBits, InteractionContextType, ChannelType, MessageFlags } = require('discord.js');
const { panelPayload } = require('../modules/applications');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('application')
    .setDescription('Система заявок')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s.setName('setup').setDescription('Опубликовать вечную кнопку «Подать заявку»')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('Канал для кнопки (по умолчанию — текущий)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        )
    ),
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    await channel.send(panelPayload());
    await interaction.reply({
      content: `✅ Кнопка опубликована в ${channel}. Канал рассмотрения и вопросы — в \`/settings\` → Заявки.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
