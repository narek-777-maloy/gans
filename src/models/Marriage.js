const { Schema, model } = require('mongoose');

module.exports = model(
  'Marriage',
  new Schema({
    guildId: { type: String, required: true, index: true },
    user1: { type: String, required: true },
    user2: { type: String, required: true },
    marriedAt: { type: Date, default: Date.now },
  })
);
