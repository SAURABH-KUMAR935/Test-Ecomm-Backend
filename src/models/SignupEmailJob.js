const mongoose = require('mongoose');

const signupEmailJobSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    index: true,
  },
  emailType: {
    type: String,
    enum: ['registration', 'password-reset'],
    default: 'registration',
  },
  encryptedOtp: String,
  iv: String,
  authTag: String,
  suppress: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    enum: ['queued', 'processing'],
    default: 'queued',
  },
  attempts: {
    type: Number,
    default: 0,
  },
  nextAttemptAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
  lockedAt: Date,
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
}, { timestamps: true });

signupEmailJobSchema.index({ status: 1, nextAttemptAt: 1, createdAt: 1 });

module.exports = mongoose.model('SignupEmailJob', signupEmailJobSchema);
