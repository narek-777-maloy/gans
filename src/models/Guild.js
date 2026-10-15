const { Schema, model } = require('mongoose');

const embedBlock = (d) => ({
  enabled: { type: Boolean, default: false },
  channelId: { type: String, default: null },
  color: { type: String, default: d.color },
  title: { type: String, default: d.title },
  description: { type: String, default: d.description },
  banner: { type: String, default: null },
  footer: { type: String, default: null },
});

const flag = (v = false) => ({ type: Boolean, default: v });
const ids = () => ({ type: [String], default: [] });
const id = () => ({ type: String, default: null });

const guildSchema = new Schema(
  {
    guildId: { type: String, required: true, unique: true },

    welcome: embedBlock({
      color: '#57F287',
      title: 'Добро пожаловать!',
      description: '{user}, рады видеть тебя на **{server}**!\nТы наш участник №{count}.',
    }),
    goodbye: embedBlock({
      color: '#ED4245',
      title: 'До встречи!',
      description: '**{user}** покинул **{server}**.\nОсталось участников: {count}.',
    }),

    logs: {
      enabled: flag(),
      channelId: id(),
      events: {
        messageDelete: flag(true),
        messageUpdate: flag(true),
        roles: flag(true),
        ban: flag(true),
        kick: flag(true),
        leave: flag(true),
        channels: flag(true),
      },
    },

    security: {
      antilink: { enabled: flag(), blockAll: flag(), whitelistRoles: ids(), whitelistChannels: ids() },
      antibot: { enabled: flag(), whitelist: ids() },
      anticrash: {
        enabled: flag(),
        limit: { type: Number, default: 3 },
        interval: { type: Number, default: 10 }, // секунд
        punishment: { type: String, enum: ['ban', 'kick', 'strip'], default: 'ban' },
        whitelistUsers: ids(),
      },
    },

    applications: {
      channelId: id(), // канал, куда приходят заявки
      acceptRoleId: id(),
      questions: {
        type: [String],
        default: ['Сколько вам лет?', 'Расскажите о себе', 'Почему вы хотите к нам?'],
      },
    },

    afk: { enabled: flag(), roleId: id(), days: { type: Number, default: 7 } },

    tickets: { enabled: flag(), categoryId: id(), logChannelId: id(), supportRoleId: id() },

    // Система Akemi: { [commandName]: { whitelist: [roleId], blacklist: [roleId] } }
    permissions: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, minimize: false }
);

module.exports = model('Guild', guildSchema);
