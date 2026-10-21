const Product = require('../models/Product');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');
const path = require('path');
const isValidImageUpload = require('../utils/validateImageUpload');
const { markServiceError, sendServiceError } = require('../utils/serviceErrors');

const validateProductInput = (body, partial = false) => {
  const values = {};
  const textLimits = { name: 200, description: 10000, category: 100 };

  for (const [field, maxLength] of Object.entries(textLimits)) {
    if (partial && body[field] === undefined) continue;
    const value = body[field];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maxLength) {
      return { error: `${field} must be a non-empty string of at most ${maxLength} characters.` };
    }
    values[field] = value.trim();
  }

  for (const field of ['price', 'countInStock', 'shippingCharge']) {
    if (partial && body[field] === undefined) continue;
    const rawValue = body[field];
    if (
      (typeof rawValue !== 'number' && typeof rawValue !== 'string')
      || (typeof rawValue === 'string' && !rawValue.trim())
    ) {
      return { error: `${field} must be a valid non-negative number.` };
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value < 0 || (field === 'countInStock' && !Number.isInteger(value))) {
      return { error: `${field} must be a valid non-negative ${field === 'countInStock' ? 'integer' : 'number'}.` };
    }
    values[field] = value;
  }

  return { values };
};

// Helper function to delete local file
const deleteLocalFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    
    }
  } catch (error) {
    console.error('Failed to delete temporary image:', error);
  }
};

const getProductImageFiles = (req) => [
  ...(req.files?.image || (req.file ? [req.file] : [])),
  ...(req.files?.additionalImages || []),
];

const cleanupProductImageFiles = (req) => {
  getProductImageFiles(req).forEach((file) => deleteLocalFile(file.path));
};

const uploadProductImages = async (files) => {
  if (files.some((file) => !isValidImageUpload(file))) {
    return { error: 'The uploaded file must be a valid JPG, JPEG, PNG, or WEBP image.' };
  }

  let results;
  try {
    results = await Promise.all(files.map((file) => cloudinary.uploader.upload(file.path)));
  } catch (error) {
    throw markServiceError(error, 'image');
  }
  return { urls: results.map((result) => result.secure_url) };
};

// Helper function to clean up old unused images from uploads folder
const cleanupOldImages = async () => {
  try {
    const uploadsDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadsDir)) {
      
      return;
    }

    const files = fs.readdirSync(uploadsDir);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

    files.forEach(file => {
      const filePath = path.join(uploadsDir, file);
      const stats = fs.statSync(filePath);
      const fileAge = now - stats.mtimeMs;

      // Delete files older than 24 hours
      if (fileAge > maxAge) {
        try {
          fs.unlinkSync(filePath);
         
        } catch (error) {
          console.error('Failed to delete old uploaded file:', error);
        }
      }
    });

    
  } catch (error) {
    console.error('Failed to clean old uploaded files:', error);
  }
};

exports.getAllProducts = async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    sendServiceError(res, error, 'Unable to load products.');
  }
};

exports.createProduct = async (req, res) => {
  try {
    const mainImage = req.files?.image?.[0] || req.file;
    const additionalImages = req.files?.additionalImages || [];
    const imageFiles = [...(mainImage ? [mainImage] : []), ...additionalImages];
    const { values, error } = validateProductInput(req.body || {});
    if (error) {
      cleanupProductImageFiles(req);
      return res.status(400).json({ message: error });
    }

    const uploadedImages = await uploadProductImages(imageFiles);
    if (uploadedImages.error) {
      cleanupProductImageFiles(req);
      return res.status(400).json({ message: uploadedImages.error });
    }
    cleanupProductImageFiles(req);

    const product = await Product.create({
      ...values,
      imageUrl: mainImage ? uploadedImages.urls[0] : '',
      additionalImageUrls: uploadedImages.urls.slice(mainImage ? 1 : 0),
    });
    // Run cleanup after successful product creation
    cleanupOldImages();
    res.status(201).json(product);
  } catch (error) {
    console.error('Product creation failed:', error);
    // Clean up local file if product creation fails
    cleanupProductImageFiles(req);
    sendServiceError(res, error, 'Unable to add the product.');

  }
};

exports.getProductById = async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json(product);
  } catch (error) {
    sendServiceError(res, error, 'Unable to load this product.');
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const mainImage = req.files?.image?.[0] || req.file;
    const additionalImages = req.files?.additionalImages || [];
    const imageFiles = [...(mainImage ? [mainImage] : []), ...additionalImages];
    const { values, error } = validateProductInput(req.body || {}, true);
    if (error) {
      cleanupProductImageFiles(req);
      return res.status(400).json({ message: error });
    }
  
    const product = await Product.findById(req.params.id);
    if(product) {
      Object.assign(product, values);
      const uploadedImages = await uploadProductImages(imageFiles);
      if (uploadedImages.error) {
        cleanupProductImageFiles(req);
        return res.status(400).json({ message: uploadedImages.error });
      }
      if (mainImage) product.imageUrl = uploadedImages.urls[0];
      if (additionalImages.length) {
        product.additionalImageUrls = uploadedImages.urls.slice(mainImage ? 1 : 0);
      }
      cleanupProductImageFiles(req);
      const updatedProduct = await product.save();
      // Run cleanup after successful product update
      cleanupOldImages();
      res.json(updatedProduct);
    }else{
      cleanupProductImageFiles(req);
      res.status(404).json({ message: "Product not found" });
    }
  } catch (error) {
    console.error('Product update failed:', error);
    // Clean up local file if product update fails
    cleanupProductImageFiles(req);
    sendServiceError(res, error, 'Unable to update the product.');
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json({ message: "Product deleted successfully" });
  } catch (error) {
    sendServiceError(res, error, 'Unable to delete the product.');
  }
};
