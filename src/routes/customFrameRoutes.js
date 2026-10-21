const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const imageUpload = require('../middleware/imageUpload');
const {
  getCustomFramePricing,
  getCustomFramePriceSettings,
  updateCustomFramePriceSettings,
  quoteCart,
  uploadCustomFramePhoto,
} = require('../controllers/customFrameController');

const router = express.Router();

router.post('/pricing', getCustomFramePricing);
router.get('/pricing-settings', protect, admin, getCustomFramePriceSettings);
router.put('/pricing-settings', protect, admin, updateCustomFramePriceSettings);
router.post('/quote-cart', protect, quoteCart);
router.post('/upload', protect, imageUpload('photo'), uploadCustomFramePhoto);

module.exports = router;
