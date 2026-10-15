const { markActive } = require('../modules/afk');

module.exports = [
  {
    name: 'messageCreate',
    async execute(client, message) {
      if (!message.inGuild() || message.author.bot) return;
      await markActive(message.member);
    },
  },
  {
    name: 'voiceStateUpdate',
    async execute(client, oldState, newState) {
      if (newState.channelId && oldState.channelId !== newState.channelId) await markActive(newState.member);
    },
  },
];
