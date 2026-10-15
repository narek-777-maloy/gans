const { MessageFlags } = require('discord.js');
const { getConfig } = require('../utils/guildConfig');
const { canUse } = require('../modules/permissions');

module.exports = {
  name: 'interactionCreate',
  async execute(client, interaction) {
    try {
      if (!interaction.inGuild()) return;

      if (interaction.isAutocomplete()) {
        return client.commands.get(interaction.commandName)?.autocomplete?.(interaction);
      }

      if (interaction.isChatInputCommand()) {
        const cmd = client.commands.get(interaction.commandName);
        if (!cmd) return;
        const cfg = await getConfig(interaction.guildId);
        if (!canUse(interaction.member, interaction.commandName, cfg, interaction.guild)) {
          return interaction.reply({ content: '⛔ У вас нет доступа к этой команде.', flags: MessageFlags.Ephemeral });
        }
        return await cmd.execute(interaction);
      }

      // Кнопки / селекты / модалки: префикс customId выбирает модуль
      if (interaction.customId) {
        const handler = client.components.get(interaction.customId.split(':')[0]);
        if (handler) return await handler.handle(interaction);
      }
    } catch (err) {
      // 10062 — интеракция устарела, 40060 — уже подтверждена: не ошибка бота
      if (err?.code === 10062 || err?.code === 40060) return console.warn('[interactionCreate]', err.message);
      console.error('[interactionCreate]', err);
      const payload = { content: '⚠️ Произошла ошибка. Попробуйте позже.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else if (interaction.isRepliable()) await interaction.reply(payload).catch(() => {});
    }
  },
};
