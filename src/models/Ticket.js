const { Schema, model } = require('mongoose');

module.exports = model(
  'Ticket',
  new Schema(
    {
      guildId: { type: String, required: true, index: true },
      channelId: { type: String, required: true, index: true },
      userId: { type: String, required: true },
      number: { type: Number, required: true },
      status: { type: String, enum: ['open', 'closed'], default: 'open' },
      closedBy: String,
    },
    { timestamps: true }
  )
);
