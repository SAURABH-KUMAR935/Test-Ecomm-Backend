const mongoose = require('mongoose');

const revokedTokenSchema = new mongoose.Schema({
  jti: {
    type: String,
    required: true,
    unique: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
});

module.exports = mongoose.model('RevokedToken', revokedTokenSchema);
