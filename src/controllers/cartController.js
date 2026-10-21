const Cart = require('../models/Cart');
const Product = require('../models/Product');
const { sendServiceError } = require('../utils/serviceErrors');

// Get user's cart
exports.getCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
    
    if (!cart) {
      return res.json({ items: [] });
    }
    
    res.json(cart);
  } catch (error) {
    console.error('Failed to get cart:', error);
    sendServiceError(res, error, 'Unable to load your cart.');
  }
};

// Add item to cart
exports.addToCart = async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    if (
      typeof productId !== 'string'
      || !/^[a-f\d]{24}$/i.test(productId)
      || !Number.isInteger(quantity)
      || quantity < 1
      || quantity > 100
    ) {
      return res.status(400).json({ message: 'Provide a valid product and quantity.' });
    }
    
    // Check if product exists and has enough stock
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    if (product.countInStock < quantity) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }
    
    // Find or create cart for user
    let cart = await Cart.findOne({ user: req.user._id });
    
    if (!cart) {
      cart = new Cart({
        user: req.user._id,
        items: []
      });
    }
    
    // Check if item already exists in cart
    const existingItemIndex = cart.items.findIndex(
      item => item.product.toString() === productId
    );
    
    if (existingItemIndex > -1) {
      // Update quantity if item exists
      const newQuantity = cart.items[existingItemIndex].quantity + quantity;
      if (newQuantity > product.countInStock) {
        return res.status(400).json({ message: 'Insufficient stock' });
      }
      cart.items[existingItemIndex].quantity = newQuantity;
    } else {
      // Add new item
      cart.items.push({
        product: productId,
        quantity: quantity
      });
    }
    
    await cart.save();
    await cart.populate('items.product');
    
    res.json(cart);
  } catch (error) {
    console.error('Failed to update cart:', error);
    sendServiceError(res, error, 'Unable to update your cart.');
  }
};

// Update item quantity in cart
exports.updateCartItem = async (req, res) => {
  try {
    const { productId, quantity } = req.body;
    if (
      typeof productId !== 'string'
      || !/^[a-f\d]{24}$/i.test(productId)
      || !Number.isInteger(quantity)
      || quantity < 0
      || quantity > 100
    ) {
      return res.status(400).json({ message: 'Provide a valid product and quantity.' });
    }
    
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }
    
    const itemIndex = cart.items.findIndex(
      item => item.product.toString() === productId
    );
    
    if (itemIndex === -1) {
      return res.status(404).json({ message: 'Item not found in cart' });
    }
    
    // Check stock
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    if (quantity > product.countInStock) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }
    
    if (quantity <= 0) {
      cart.items.splice(itemIndex, 1);
    } else {
      cart.items[itemIndex].quantity = quantity;
    }
    
    await cart.save();
    await cart.populate('items.product');
    
    res.json(cart);
  } catch (error) {
    console.error('Failed to update cart item:', error);
    sendServiceError(res, error, 'Unable to update the cart item.');
  }
};

// Remove item from cart
exports.removeFromCart = async (req, res) => {
  try {
    const { productId } = req.params;
    
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }
    
    cart.items = cart.items.filter(
      item => item.product.toString() !== productId
    );
    
    await cart.save();
    await cart.populate('items.product');
    
    res.json(cart);
  } catch (error) {
    console.error('Failed to remove cart item:', error);
    sendServiceError(res, error, 'Unable to remove the cart item.');
  }
};

// Clear cart
exports.clearCart = async (req, res) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) {
      return res.status(404).json({ message: 'Cart not found' });
    }
    
    cart.items = [];
    await cart.save();
    
    res.json({ message: 'Cart cleared successfully', cart });
  } catch (error) {
    console.error('Failed to clear cart:', error);
    sendServiceError(res, error, 'Unable to clear your cart.');
  }
};
