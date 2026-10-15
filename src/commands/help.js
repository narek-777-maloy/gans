const { SlashCommandBuilder, EmbedBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const { COLOR, FOOTER, NAME } = require('../config');

const CATEGORIES = [
  ['🎉 Для всех', ['help', 'ping', 'profile', 'invites', 'marry', 'divorce', 'afk']],
  ['⚙️ Управление сервером', ['settings', 'application', 'ticket', 'perms', 'backup']],
];

function lines(cmd) {
  const j = cmd.data.toJSON();
  const lock = j.default_member_permissions ? ' 🔒' : '';
  const subs = (j.options ?? []).filter((o) => o.type === 1);
  if (!subs.length) return [`\`/${j.name}\` — ${j.description}${lock}`];
  return subs.map((s) => `\`/${j.name} ${s.name}\` — ${s.description}${lock}`);
}

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Список всех команд бота').setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    const all = interaction.client.commands;
    const used = new Set();
    const blocks = [];
    for (const [title, names] of CATEGORIES) {
      const cmds = names.map((n) => all.get(n)).filter(Boolean);
      cmds.forEach((c) => used.add(c.data.name));
      if (cmds.length) blocks.push(`**${title}**\n${cmds.flatMap(lines).join('\n')}`);
    }
    const rest = [...all.values()].filter((c) => !used.has(c.data.name));
    if (rest.length) blocks.push(`**📦 Прочее**\n${rest.flatMap(lines).join('\n')}`);

    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setTitle(`📖 ${NAME} — команды`)
      .setDescription(`${blocks.join('\n\n')}\n\n🔒 — нужны права администрации.\nНастройки всех модулей: \`/settings\`.`)
      .setFooter(FOOTER);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
