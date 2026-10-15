const { Schema, model } = require('mongoose');

const schema = new Schema({
  guildId: { type: String, required: true },
  userId: { type: String, required: true },
  lastActive: { type: Date, default: Date.now },
  hasAfk: { type: Boolean, default: false },
});
schema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = model('UserActivity', schema);
