const express = require('express');

const { getAllProducts, createProduct, updateProduct, deleteProduct , getProductById } = require('../controllers/productController');
const { protect, admin } = require('../middleware/authMiddleware');

const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: '/tmp/' });


router.route('/').get(getAllProducts).post(protect, admin, upload.single('image'), createProduct);
router.route('/:id').get(getProductById).put(protect, admin, upload.single('image'), updateProduct).delete(protect, admin, deleteProduct);


module.exports = router;