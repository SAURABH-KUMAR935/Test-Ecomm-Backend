const moongose = require('mongoose');
const indianStates = require('../utils/indianStates');

const orderItemSchema = new moongose.Schema({
  product: {
    type: moongose.Schema.Types.ObjectId,
    ref: 'Product',
    default: null,
  },
  name: { type: String, default: 'Product' },
  imageUrl: { type: String, default: '' },
  quantity: {
    type: Number,
    default: 1,
  },
  price: {
    type: Number,
    required: true,
  },
  shippingCharge: {
    type: Number,
    default: 0,
    min: 0,
  },
  isCustomFrame: {
    type: Boolean,
    default: false,
  },
  customFrame: {
    type: Object,
    default: null,
  },
}, { _id: false });

const orderSchema = moongose.Schema(
  {
    user: {
      type: moongose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    items: [orderItemSchema],
    totalAmount: {
      type: Number,
      required: true
    },
    address: {
      fullName: { type: String, required: true },
      street: { type: String, required: true },
      landmark: { type: String, default: '' },
      city: { type: String , required: true },
      state: { type: String, required: true, enum: indianStates },
      postalCode: { type: String, required: true },
    },
    paymentId: {
      type: String,
      required: true
    },
    paymentReference: {
      type: String,
      default: '',
      trim: true,
      maxlength: 128,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'confirmed', 'printing', 'framing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending'
    },
    inventoryDeducted: {
      type: Boolean,
      default: false
    },
    inventoryRestocked: {
      type: Boolean,
      default: false
    }
      
  },{ timestamps: true}
);

module.exports = moongose.model('Order', orderSchema);