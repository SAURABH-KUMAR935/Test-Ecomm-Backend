const express = require('express');
const { getAllOrders, createOrder, updateOrderStatus, deleteOrder, getOrderById , myorders } = require('../controllers/orderController');
const { protect, admin } = require('../middleware/authMiddleware');

const router = express.Router();

router.route('/').get(protect, admin, getAllOrders).post(protect, createOrder);
router.route('/myorders').get(protect, myorders);
router.route('/:id').get(protect, getOrderById).delete(protect, admin, deleteOrder);

router.route('/:id/status').put(protect, admin, updateOrderStatus);

module.exports = router;