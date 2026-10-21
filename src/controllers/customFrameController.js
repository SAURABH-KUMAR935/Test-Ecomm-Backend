const fs = require('fs');
const cloudinary = require('../config/cloudinary');
const Product = require('../models/Product');
const CustomFramePricing = require('../models/CustomFramePricing');
const isValidImageUpload = require('../utils/validateImageUpload');
const {
  DEFAULT_CUSTOM_FRAME_PRICES,
  calculateCustomFramePricing,
  validateCustomFramePrices,
  validateFrameOrientation,
} = require('../utils/customFramePricing');
const getCustomFramePrices = require('../utils/getCustomFramePrices');
const { markServiceError, sendServiceError } = require('../utils/serviceErrors');

exports.getCustomFramePricing = async (req, res) => {
  let prices;
  try {
    prices = await getCustomFramePrices();
  } catch (error) {
    console.error('Failed to load custom-frame pricing:', error);
    return sendServiceError(res, error, 'Unable to load custom-frame pricing.');
  }

  try {
    const { frameSize, frameColor, quantity, photoLayout } = req.body || {};
    return res.json(calculateCustomFramePricing({ frameSize, frameColor, quantity, photoLayout }, prices));
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
};

exports.getCustomFramePriceSettings = async (req, res) => {
  try {
    const prices = await getCustomFramePrices();
    return res.json({ prices });
  } catch (error) {
    console.error('Failed to load custom-frame price settings:', error);
    return sendServiceError(res, error, 'Unable to load custom-frame pricing.');
  }
};

exports.updateCustomFramePriceSettings = async (req, res) => {
  let prices;
  try {
    prices = validateCustomFramePrices(req.body?.prices);
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }

  try {
    const settings = await CustomFramePricing.findOneAndUpdate(
      { key: 'default' },
      { $set: { prices }, $setOnInsert: { key: 'default' } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return res.json({ prices: settings.prices });
  } catch (error) {
    console.error('Failed to update custom-frame price settings:', error);
    return sendServiceError(res, error, 'Unable to save custom-frame pricing.');
  }
};

exports.quoteCart = async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Add at least one item to your cart.' });
    }
    if (items.some((item) => !item || typeof item !== 'object')) {
      return res.status(400).json({ message: 'Cart contains an invalid item.' });
    }

    const standardProductIds = items
      .filter((item) => !item?.isCustomFrame)
      .map((item) => item?.product);

    if (standardProductIds.some((id) => !id || !/^[a-f\d]{24}$/i.test(id))) {
      return res.status(400).json({ message: 'Cart contains an invalid product.' });
    }

    const requestedQuantities = new Map();
    for (const item of items.filter((item) => !item.isCustomFrame)) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        return res.status(400).json({ message: 'Every cart item must have a valid quantity.' });
      }
      const productId = item.product.toLowerCase();
      requestedQuantities.set(
        productId,
        (requestedQuantities.get(productId) || 0) + item.quantity,
      );
    }

    const products = await Product.find({ _id: { $in: standardProductIds } });
    const productsById = new Map(products.map((product) => [product._id.toString(), product]));
    const customFramePrices = items.some((item) => item.isCustomFrame)
      ? await getCustomFramePrices()
      : DEFAULT_CUSTOM_FRAME_PRICES;

    for (const [productId, quantity] of requestedQuantities) {
      const product = productsById.get(productId);
      if (!product) {
        return res.status(404).json({ message: 'One or more products could not be found.' });
      }
      if (product.countInStock < quantity) {
        return res.status(409).json({
          message: `${product.name} has only ${product.countInStock} item${product.countInStock === 1 ? '' : 's'} available.`,
          product: product._id,
          availableStock: product.countInStock,
        });
      }
    }

    const appliedShippingProductIds = new Set();
    const quotedItems = items.map((item) => {
      if (!Number.isInteger(item.quantity) || item.quantity < 1) {
        const error = new Error('Every cart item must have a valid quantity.');
        error.statusCode = 400;
        throw error;
      }

      if (item.isCustomFrame) {
        const { frameSize, frameColor, orientation } = item;
        const photoLayout = item.photoLayout || 'single';
        let price;
        try {
          validateFrameOrientation(orientation);
          price = calculateCustomFramePricing({
            frameSize,
            frameColor,
            quantity: item.quantity,
            photoLayout,
          }, customFramePrices);
        } catch (error) {
          error.statusCode = 400;
          throw error;
        }
        return {
          isCustomFrame: true,
          quantity: price.quantity,
          unitPrice: price.unitPrice,
          lineTotal: price.totalPrice,
          currency: price.currency,
        };
      }

      const product = productsById.get(item.product.toLowerCase());
      if (!product) {
        const error = new Error('One or more products could not be found.');
        error.statusCode = 404;
        throw error;
      }
      const productKey = product._id.toString();
      const shippingCharge = appliedShippingProductIds.has(productKey)
        ? 0
        : product.shippingCharge || 0;
      appliedShippingProductIds.add(productKey);

      return {
        product: product._id,
        isCustomFrame: false,
        name: product.name,
        quantity: item.quantity,
        unitPrice: product.price,
        shippingCharge,
        lineTotal: product.price * item.quantity,
        currency: 'INR',
      };
    });
    const subtotal = quotedItems.reduce((total, item) => total + item.lineTotal, 0);
    const shippingCharge = quotedItems.reduce((total, item) => total + (item.shippingCharge || 0), 0);

    return res.json({
      items: quotedItems,
      subtotal,
      shippingCharge,
      totalAmount: subtotal + shippingCharge,
      currency: 'INR',
    });
  } catch (error) {
    if (error.statusCode && error.statusCode < 500) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Custom frame quote failed:', error);
    return sendServiceError(res, error, 'Unable to calculate cart pricing.');
  }
};

exports.uploadCustomFramePhoto = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Please upload a photo.' });
    }

    if (!isValidImageUpload(req.file)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'The uploaded file must be a valid JPG, JPEG, PNG, or WEBP image.' });
    }

    let result;
    try {
      result = await cloudinary.uploader.upload(req.file.path, {
        folder: `zavique-art/custom-frames/${req.user._id}`,
        resource_type: 'image',
      });
    } catch (error) {
      throw markServiceError(error, 'image');
    }

    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(201).json({
      url: result.secure_url,
      publicId: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format,
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error('Custom frame photo upload failed:', error);
    return sendServiceError(res, error, 'Photo upload failed.');
  }
};
