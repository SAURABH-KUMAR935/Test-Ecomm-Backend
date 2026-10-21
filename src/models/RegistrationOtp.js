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
  attempts: {
    type: Number,
    default: 0,
    min: 0,
  },
  username: {
    type: String,
    required: true,
  },
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  phone: {
    type: String,
    default: '',
    trim: true,
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