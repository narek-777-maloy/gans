const { Schema, model } = require('mongoose');

module.exports = model(
  'Backup',
  new Schema(
    {
      guildId: { type: String, required: true, index: true },
      name: { type: String, default: 'backup' },
      data: { type: Schema.Types.Mixed, required: true },
    },
    { timestamps: true }
  )
);
