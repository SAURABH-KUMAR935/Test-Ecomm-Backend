const mongoose = require('mongoose');

const paymentSettingsSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    default: 'default',
  },
  paymentMethod: {
    type: String,
    enum: ['upiId', 'qr', 'both'],
    default: 'upiId',
  },
  upiId: {
    type: String,
    default: '',
  },
  qrImageUrl: {
    type: String,
    default: '',
  },
  qrImagePublicId: {
    type: String,
    default: '',
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('PaymentSettings', paymentSettingsSchema);
