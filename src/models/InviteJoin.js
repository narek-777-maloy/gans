const { Schema, model } = require('mongoose');

const schema = new Schema({
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  inviterId: { type: String, default: null, index: true },
  code: { type: String, default: null },
  left: { type: Boolean, default: false },
  joinedAt: { type: Date, default: Date.now },
});

module.exports = model('InviteJoin', schema);
