const mongoose = require('mongoose');

const registrationOtpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
  },
  otpHash: {
    type: String,
    required: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    default: 'user',
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
});

module.exports = mongoose.model('RegistrationOtp', registrationOtpSchema);