const express = require('express');

const { getAllProducts, createProduct, updateProduct, deleteProduct , getProductById } = require('../controllers/productController');
const { protect, admin } = require('../middleware/authMiddleware');
const imageUpload = require('../middleware/imageUpload');

const router = express.Router();


router.route('/').get(getAllProducts).post(protect, admin, imageUpload({ image: 1, additionalImages: 2 }), createProduct);
router.route('/:id').get(getProductById).put(protect, admin, imageUpload({ image: 1, additionalImages: 2 }), updateProduct).delete(protect, admin, deleteProduct);


module.exports = router;