const mongoose = require('mongoose');

const signupRateLimitSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true,
  },
  count: {
    type: Number,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
}, { versionKey: false });

module.exports = mongoose.model('SignupRateLimit', signupRateLimitSchema);
