const { EmbedBuilder } = require('discord.js');

function fill(text, member, mention) {
  return (text ?? '')
    .replaceAll('{user}', mention ? `<@${member.id}>` : member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount));
}

/** Embed приветствия/прощания из конфигурации. Переменные: {user} {server} {count}. */
function buildTemplateEmbed(c, member, { mention = true } = {}) {
  const color = /^#?[0-9a-f]{6}$/i.test(c.color ?? '') ? c.color : '#5865F2';
  const e = new EmbedBuilder()
    .setColor(color.startsWith('#') ? color : `#${color}`)
    .setTitle(fill(c.title, member, mention) || null)
    .setDescription(fill(c.description, member, mention) || null)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();
  if (c.banner) e.setImage(c.banner);
  if (c.footer) e.setFooter({ text: fill(c.footer, member, mention) });
  return e;
}

module.exports = { buildTemplateEmbed };
