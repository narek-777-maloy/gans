const { COLOR, FOOTER } = require('../config');
const { SlashCommandBuilder, InteractionContextType, EmbedBuilder } = require('discord.js');
const { propose, divorce, find, partnerOf } = require('../modules/marriage');
const InviteJoin = require('../models/InviteJoin');
const UserActivity = require('../models/UserActivity');

const ctx = InteractionContextType.Guild;
const ts = (d) => `<t:${Math.floor(new Date(d).getTime() / 1000)}:R>`;

module.exports = [
  {
    data: new SlashCommandBuilder().setName('marry').setDescription('Сделать предложение').setContexts(ctx)
      .addUserOption((o) => o.setName('user').setDescription('Кому').setRequired(true)),
    execute: propose,
  },
  {
    data: new SlashCommandBuilder().setName('divorce').setDescription('Расторгнуть брак').setContexts(ctx),
    execute: divorce,
  },
  {
    data: new SlashCommandBuilder().setName('profile').setDescription('Профиль участника').setContexts(ctx)
      .addUserOption((o) => o.setName('user').setDescription('Участник (по умолчанию — вы)')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const [marriage, invited, activity, joinRec] = await Promise.all([
        find(interaction.guildId, user.id),
        InviteJoin.countDocuments({ guildId: interaction.guildId, inviterId: user.id, left: false }),
        UserActivity.findOne({ guildId: interaction.guildId, userId: user.id }).lean(),
        InviteJoin.findOne({ guildId: interaction.guildId, userId: user.id }).sort({ joinedAt: -1 }).lean(),
      ]);
      const embed = new EmbedBuilder()
        .setColor(COLOR).setFooter(FOOTER)
        .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: '💍 Брак', value: marriage ? `<@${partnerOf(marriage, user.id)}> — ${ts(marriage.marriedAt)}` : 'Не в браке', inline: true },
          { name: '📨 Приглашено', value: String(invited), inline: true },
          { name: '🕒 Активность', value: activity ? ts(activity.lastActive) : 'нет данных', inline: true },
          { name: '📅 На сервере', value: member?.joinedTimestamp ? ts(member.joinedTimestamp) : '—', inline: true },
          { name: '🔗 Пригласил', value: joinRec?.inviterId ? `<@${joinRec.inviterId}>` : '—', inline: true }
        );
      return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },
];
