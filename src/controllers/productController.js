const Product = require('../models/Product');
const multer = require('multer');
const cloudinary = require('../config/cloudinary');
const fs = require('fs');
const path = require('path');

// Helper function to delete local file
const deleteLocalFile = (filePath) => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    
    }
  } catch (error) {
   res.status(500).json({ message: "Failed to delete local file" });
  }
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
          res.status(500).json({ message: "Failed to delete old file" });
        }
      }
    });

    
  } catch (error) {
    res.status(500).json({ message: "Failed to cleanup old files" });
  }
};

exports.getAllProducts = async (req, res) => {
  try {
    const products = await Product.find();
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.createProduct = async (req, res) => {
  try {
    const { name, description, price, category, countInStock } = req.body;

    let imageUrl = '';
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path);
        imageUrl = result.secure_url;
        // Delete local file after successful Cloudinary upload
        deleteLocalFile(req.file.path);
      } catch (uploadError) {
        
        // Delete local file even if upload fails
        deleteLocalFile(req.file.path);
        return res.status(500).json({
          message: "Image upload failed",
          error: uploadError.message
        });
      }
    }
    const product = await Product.create({
      name,
      description,
      price,
      category,
      imageUrl,
      countInStock
    });
    // Run cleanup after successful product creation
    cleanupOldImages();
    res.status(201).json(product);
  } catch (error) {
    
    // Clean up local file if product creation fails
    if (req.file) {
      deleteLocalFile(req.file.path);
    }
    res.status(500).json({
    message: "Server error",
    error: error.message
  });

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
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const { name, description, price, category, countInStock } = req.body;
  
    const product = await Product.findById(req.params.id);
    if(product) {
      product.name = name || product.name;
      product.description = description || product.description;
      product.price = price || product.price;
      product.category = category || product.category;
      product.countInStock = countInStock || product.countInStock;
      if (req.file) {
        try {
          const result = await cloudinary.uploader.upload(req.file.path);
          product.imageUrl = result.secure_url;
          // Delete local file after successful Cloudinary upload
          deleteLocalFile(req.file.path);
        } catch (uploadError) {
        
          // Delete local file even if upload fails
          deleteLocalFile(req.file.path);
          return res.status(500).json({
            message: "Image upload failed",
            error: uploadError.message
          });
        }
      }
      const updatedProduct = await product.save();
      // Run cleanup after successful product update
      cleanupOldImages();
      res.json(updatedProduct);
    }else{
      res.status(404).json({ message: "Product not found" });
    }
  } catch (error) {
  
    // Clean up local file if product update fails
    if (req.file) {
      deleteLocalFile(req.file.path);
    }
    res.status(500).json({ message: "Server error" });
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
    res.status(500).json({ message: "Server error" });
  }
};
