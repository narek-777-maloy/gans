const { Schema, model } = require('mongoose');

const schema = new Schema(
  {
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    messageId: String,
    answers: [{ _id: false, question: String, answer: String }],
    status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    reviewerId: String,
    reason: String,
    reviewedAt: Date,
  },
  { timestamps: true }
);

module.exports = model('Application', schema);
