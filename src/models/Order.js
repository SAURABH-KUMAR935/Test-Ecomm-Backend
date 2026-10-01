const moongose = require('mongoose');

const orderSchema = moongose.Schema(
  {
    user: {
      type: moongose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    // Add other fields for the order schema
    items: [{
      product: {
        type: moongose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true,
      },
      quantity: {
        type: Number,
        default: 1
      },
      price: {
        type: Number,
        required: true
      }
    }],
    totalAmount: {
      type: Number,
      required: true
    },
    address: {
      fullName: { type: String, required: true },
      street: { type: String, required: true },
      city: { type: String , required: true },
      postalCode: { type: String, required: true },
    },
    paymentId: {
      type: String,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'shipped', 'delivered', 'cancelled'],
      default: 'pending'
    }
      
  },{ timestamps: true}
);

module.exports = moongose.model('Order', orderSchema);