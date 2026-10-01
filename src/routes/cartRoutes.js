const express = require('express');
const {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  clearCart
} = require('../controllers/cartController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

// All cart routes require authentication
router.use(protect);

// Get user's cart
router.route('/').get(getCart);

// Add item to cart
router.route('/add').post(addToCart);

// Update item quantity in cart
router.route('/update').put(updateCartItem);

// Remove item from cart
router.route('/remove/:productId').delete(removeFromCart);

// Clear entire cart
router.route('/clear').delete(clearCart);

module.exports = router;
