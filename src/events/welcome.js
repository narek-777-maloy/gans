const { getConfig } = require('../utils/guildConfig');
const { buildTemplateEmbed } = require('../utils/embeds');

async function send(member, key, mention) {
  if (member.user.bot) return;
  const block = (await getConfig(member.guild.id))[key];
  if (!block.enabled || !block.channelId) return;
  const ch = member.guild.channels.cache.get(block.channelId);
  if (!ch?.isTextBased()) return;
  await ch
    .send({
      content: mention ? `<@${member.id}>` : undefined,
      embeds: [buildTemplateEmbed(block, member, { mention })],
    })
    .catch((e) => console.warn(`[${key}] не удалось отправить:`, e.message));
}

module.exports = [
  { name: 'guildMemberAdd', execute: (client, member) => send(member, 'welcome', true) },
  { name: 'guildMemberRemove', execute: (client, member) => send(member, 'goodbye', false) },
];
