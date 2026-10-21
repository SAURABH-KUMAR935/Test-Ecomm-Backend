const mongoose = require('mongoose');

const customFramePricingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    default: 'default',
  },
  prices: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('CustomFramePricing', customFramePricingSchema);
