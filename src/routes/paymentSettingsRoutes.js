const express = require('express');
const { protect, admin } = require('../middleware/authMiddleware');
const imageUpload = require('../middleware/imageUpload');
const {
  getPublicPaymentSettings,
  getAdminPaymentSettings,
  updateAdminPaymentSettings,
} = require('../controllers/paymentSettingsController');

const router = express.Router();

router.get('/', getPublicPaymentSettings);
router.get('/admin', protect, admin, getAdminPaymentSettings);
router.put('/admin', protect, admin, imageUpload('qrImage'), updateAdminPaymentSettings);

module.exports = router;
