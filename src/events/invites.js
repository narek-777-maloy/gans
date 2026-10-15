const { Events } = require('discord.js');
const InviteJoin = require('../models/InviteJoin');

const snapshot = (invites) => new Map(invites.map((i) => [i.code, i.uses ?? 0]));

async function cacheGuild(client, guild) {
  try {
    client.invites.set(guild.id, snapshot(await guild.invites.fetch()));
  } catch {
    /* нет права Manage Server */
  }
}

module.exports = [
  {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
      for (const g of client.guilds.cache.values()) await cacheGuild(client, g);
    },
  },
  { name: 'guildCreate', execute: (client, guild) => cacheGuild(client, guild) },
  {
    name: 'inviteCreate',
    execute: (client, inv) => client.invites.get(inv.guild?.id)?.set(inv.code, inv.uses ?? 0),
  },
  {
    name: 'inviteDelete',
    execute: (client, inv) => client.invites.get(inv.guild?.id)?.delete(inv.code),
  },
  {
    name: 'guildMemberAdd',
    async execute(client, member) {
      let used = null;
      try {
        const before = client.invites.get(member.guild.id);
        const now = await member.guild.invites.fetch();
        if (before) used = now.find((i) => (before.get(i.code) ?? 0) < (i.uses ?? 0)) ?? null;
        client.invites.set(member.guild.id, snapshot(now));
      } catch {}
      await InviteJoin.create({
        guildId: member.guild.id,
        userId: member.id,
        inviterId: used?.inviter?.id ?? null,
        code: used?.code ?? null,
      });
    },
  },
  {
    name: 'guildMemberRemove',
    async execute(client, member) {
      await InviteJoin.updateMany({ guildId: member.guild.id, userId: member.id, left: false }, { left: true });
    },
  },
];
