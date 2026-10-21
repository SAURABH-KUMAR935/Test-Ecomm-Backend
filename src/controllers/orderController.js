const Order = require('../models/Order');
const Product = require('../models/Product');
const mongoose = require('mongoose');
const sendEmail = require('../utils/sendEmail');
const cloudinary = require('../config/cloudinary');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const {
  DEFAULT_CUSTOM_FRAME_PRICES,
  calculateCustomFramePricing,
  validateFrameOrientation,
} = require('../utils/customFramePricing');
const getCustomFramePrices = require('../utils/getCustomFramePrices');
const indianStates = require('../utils/indianStates');
const { markServiceError, sendServiceError } = require('../utils/serviceErrors');

exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find().populate('user', 'id name email');
    res.json(orders);
  } catch (error) {
    console.error('Failed to load orders:', error);
    sendServiceError(res, error, 'Unable to load orders.');
  }
}

exports.createOrder = async (req, res) => {
  const { items, address, paymentId } = req.body;
  if (!Array.isArray(items) || items.length === 0 || !address || !paymentId) {
    return res.status(400).json({ message: 'All fields are required' });
  }
  if (items.length > 50) {
    return res.status(400).json({ message: 'An order cannot contain more than 50 items.' });
  }
  if (paymentId !== 'UPI') {
    return res.status(400).json({ message: 'Unsupported payment method.' });
  }
  if (
    typeof address.fullName !== 'string' ||
    !address.fullName.trim() ||
    typeof address.street !== 'string' ||
    !address.street.trim() ||
    typeof address.city !== 'string' ||
    !address.city.trim() ||
    !indianStates.includes(address.state) ||
    typeof address.postalCode !== 'string' ||
    !address.postalCode.trim() ||
    (address.landmark != null && typeof address.landmark !== 'string')
  ) {
    return res.status(400).json({ message: 'Please provide a valid name and complete shipping address, including state.' });
  }
  if ((address.landmark || '').length > 120) {
    return res.status(400).json({ message: 'Landmark must be 120 characters or fewer.' });
  }

  const customFrameItems = [];
  let customFrameTotal = 0;
  const requestedQuantities = new Map();
  let customFramePrices = DEFAULT_CUSTOM_FRAME_PRICES;
  if (items.some((item) => item?.isCustomFrame)) {
    try {
      customFramePrices = await getCustomFramePrices();
    } catch (error) {
      console.error('Failed to load custom-frame pricing for order:', error);
      return sendServiceError(res, error, 'Unable to calculate custom-frame pricing.');
    }
  }

  for (const item of items) {
    if (!item || !Number.isInteger(item.quantity) || item.quantity < 1) {
      return res.status(400).json({ message: 'Each item must have a positive quantity.' });
    }

    if (item.isCustomFrame) {
      const expectedPhotoPrefix = `zavique-art/custom-frames/${req.user._id}/`;
      const submittedPhotos = Array.isArray(item.photos)
        ? item.photos
        : [{ photoPublicId: item.photoPublicId, photoFormat: item.photoFormat }];
      if (submittedPhotos.length < 1 || submittedPhotos.length > 5) {
        return res.status(400).json({ message: 'Custom frames must include between 1 and 5 photos.' });
      }
      const photos = [];
      for (const photo of submittedPhotos) {
        const photoPublicId = photo?.photoPublicId;
        if (
          typeof photoPublicId !== 'string'
          || !photoPublicId.startsWith(expectedPhotoPrefix)
          || !/^[a-zA-Z0-9_-]+$/.test(photoPublicId.slice(expectedPhotoPrefix.length))
        ) {
          return res.status(400).json({ message: 'Upload your photo before ordering a custom frame.' });
        }
        photos.push({
          photoPublicId,
          photoFormat: typeof photo.photoFormat === 'string' ? photo.photoFormat.toLowerCase() : '',
          imageUrl: cloudinary.url(photoPublicId, { secure: true, resource_type: 'image' }),
        });
      }
      const { photoPublicId, photoFormat, imageUrl } = photos[0];
      let referenceFrame = null;
      if (item.referenceFrame != null) {
        const referencePhotoPublicId = item.referenceFrame.photoPublicId;
        if (
          typeof referencePhotoPublicId !== 'string'
          || !referencePhotoPublicId.startsWith(expectedPhotoPrefix)
          || !/^[a-zA-Z0-9_-]+$/.test(referencePhotoPublicId.slice(expectedPhotoPrefix.length))
        ) {
          return res.status(400).json({ message: 'Upload a valid reference frame image before ordering.' });
        }
        referenceFrame = {
          photoPublicId: referencePhotoPublicId,
          photoFormat: typeof item.referenceFrame.photoFormat === 'string'
            ? item.referenceFrame.photoFormat.toLowerCase()
            : '',
          imageUrl: cloudinary.url(referencePhotoPublicId, { secure: true, resource_type: 'image' }),
        };
      }
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
        return res.status(400).json({ message: error.message });
      }
      const personalizedMessage = typeof item.personalizedMessage === 'string'
        ? item.personalizedMessage.trim()
        : '';
      if (personalizedMessage.length > 200) {
        return res.status(400).json({ message: 'Personalized messages must be 200 characters or fewer.' });
      }

      const customFrameDetails = {
        name: 'Custom Framed Photo',
        imageUrl,
        photoPublicId,
        photoFormat,
        photos,
        referenceFrame,
        frameSize: price.frameSize,
        frameColor: price.frameColor,
        photoLayout: price.photoLayout,
        orientation,
        personalizedMessage,
        quantity: price.quantity,
      };

      customFrameItems.push({
        name: customFrameDetails.name,
        quantity: price.quantity,
        price: price.unitPrice,
        isCustomFrame: true,
        customFrame: customFrameDetails,
      });
      customFrameTotal += price.totalPrice;
      continue;
    }

    if (!mongoose.Types.ObjectId.isValid(item.product)) {
      return res.status(400).json({ message: 'Each standard item must include a valid product id.' });
    }

    const productId = new mongoose.Types.ObjectId(item.product).toString();
    requestedQuantities.set(productId, (requestedQuantities.get(productId) || 0) + item.quantity);
  }

  let order;
  let session;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      const orderItems = [...customFrameItems];
      let computedTotalAmount = customFrameTotal;
      let shippingTotal = 0;
      const productIds = [...requestedQuantities.keys()];
      const products = await Product.find({ _id: { $in: productIds } }).session(session);
      const productsById = new Map(products.map((product) => [product._id.toString(), product]));

      if (productIds.length && productsById.size !== productIds.length) {
        const error = new Error('One or more products could not be found');
        error.statusCode = 404;
        throw error;
      }

      for (const [productId, quantity] of requestedQuantities) {
        const product = productsById.get(productId);
        const inventoryUpdate = await Product.updateOne(
          { _id: productId, countInStock: { $gte: quantity } },
          { $inc: { countInStock: -quantity } },
          { session }
        );

        if (inventoryUpdate.modifiedCount !== 1) {
          const error = new Error(`Not enough stock available for ${product.name}`);
          error.statusCode = 409;
          error.availableStock = product.countInStock;
          error.requestedQuantity = quantity;
          throw error;
        }

        orderItems.push({
          product: product._id,
          name: product.name,
          imageUrl: product.imageUrl || '',
          quantity,
          price: product.price,
          shippingCharge: product.shippingCharge || 0,
          isCustomFrame: false,
        });
        computedTotalAmount += product.price * quantity;
        shippingTotal += product.shippingCharge || 0;
      }

      [order] = await Order.create([{
        user: req.user._id,
        items: orderItems,
        totalAmount: computedTotalAmount + shippingTotal,
        address,
        paymentId,
        inventoryDeducted: true,
      }], { session });
    });

    try {
      const orderWithProducts = await Order.findById(order._id).populate('items.product');
      const itemsList = orderWithProducts?.items?.map((item, index) => {
        const productName = item.product?.name || item.name || 'Custom framed photo';
        return `- Item ${index + 1}: ${productName} (Quantity: ${item.quantity}, Price: ₹${item.price || 'N/A'}, Shipping: ₹${item.shippingCharge || 0})`;
      }).join('\n') || '';

      const message = `New order created by ${req.user.username} (${req.user.email})

Order ID: ${order._id.toString()}
Order Status: ${order.status}
Payment Method: ${paymentId}

Order Items:
${itemsList}

Total Amount: ₹${order.totalAmount}

Shipping Address:
Name: ${address.fullName}
Street: ${address.street}
Landmark: ${address.landmark || 'Not provided'}
City: ${address.city}
State: ${address.state}
Postal Code: ${address.postalCode}`;
      await sendEmail(req.user.email, 'Order Confirmation', message);
    } catch (emailError) {
      console.error('Order created but confirmation email failed:', emailError);
    }
    res.status(201).json(order);
  } catch (error) {
    if (error.statusCode && error.statusCode < 500) {
      return res.status(error.statusCode).json({
        message: error.availableStock !== undefined
          ? `${error.message}. Available: ${error.availableStock}; requested: ${error.requestedQuantity}.`
          : error.message,
        ...(error.availableStock !== undefined && {
          availableStock: error.availableStock,
          requestedQuantity: error.requestedQuantity,
        }),
      });
    }
    console.error('Order creation failed:', error);
    sendServiceError(res, error, 'Unable to place the order.');
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

exports.myorders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).populate('items.product');
    res.json(orders);
  } catch (error) {
    console.error('Failed to load user orders:', error);
    sendServiceError(res, error, 'Unable to load your orders.');
  }
}

exports.getOrderById = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order id.' });
    }

    const order = await Order.findById(req.params.id)
      .populate('user', 'username fullName email phone')
      .populate('items.product');
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const orderUserId = order.user?._id?.toString() || order.user?.toString();
    if (req.user.role !== 'admin' && orderUserId !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You are not authorized to view this order.' });
    }

    res.json(order);
  } catch (error) {
    console.error('Failed to load order:', error);
    sendServiceError(res, error, 'Unable to load this order.');
  }
}

exports.downloadCustomFramePhoto = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid order id.' });
    }

    const order = await Order.findById(req.params.id).select('items');
    if (!order) {
      return res.status(404).json({ message: 'Order not found.' });
    }

    const itemIndex = Number(req.params.itemIndex);
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= order.items.length) {
      return res.status(404).json({ message: 'Order item not found.' });
    }

    const customFrame = order.items[itemIndex]?.customFrame;
    if (!order.items[itemIndex]?.isCustomFrame) {
      return res.status(404).json({ message: 'No original customer photo is available for this item.' });
    }
    if (req.query.photoType === 'reference-frame') {
      const referenceFrame = customFrame?.referenceFrame;
      if (!referenceFrame?.photoPublicId) {
        return res.status(404).json({ message: 'No reference frame image is available for this item.' });
      }
      const originalPhotoUrl = cloudinary.url(referenceFrame.photoPublicId, {
        secure: true,
        resource_type: 'image',
        type: 'upload',
      });
      let photoResponse;
      try {
        photoResponse = await fetch(originalPhotoUrl);
      } catch (error) {
        throw markServiceError(error, 'image');
      }
      if (!photoResponse.ok || !photoResponse.body) {
        console.error('Cloudinary reference frame download failed:', photoResponse.status);
        return res.status(502).json({ message: 'Unable to retrieve the reference frame image from Cloudinary.' });
      }

      const extension = ['jpg', 'jpeg', 'png', 'webp'].includes(referenceFrame.photoFormat)
        ? referenceFrame.photoFormat
        : 'jpg';
      const filename = `custom-frame-reference-${order._id.toString().slice(-8)}-${itemIndex + 1}.${extension}`;
      res.setHeader('Content-Type', photoResponse.headers.get('content-type') || 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      const contentLength = photoResponse.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      await pipeline(Readable.fromWeb(photoResponse.body), res);
      return;
    }
    const photos = customFrame?.photos?.length
      ? customFrame.photos
      : [{ photoPublicId: customFrame?.photoPublicId, photoFormat: customFrame?.photoFormat }];
    const photoIndex = req.query.photoIndex == null ? 0 : Number(req.query.photoIndex);
    if (
      !Number.isInteger(photoIndex)
      || photoIndex < 0
      || photoIndex >= photos.length
      || !photos[photoIndex]?.photoPublicId
    ) {
      return res.status(404).json({ message: 'No original customer photo is available for this item.' });
    }
    const photo = photos[photoIndex];

    const originalPhotoUrl = cloudinary.url(photo.photoPublicId, {
      secure: true,
      resource_type: 'image',
      type: 'upload',
    });
    let photoResponse;
    try {
      photoResponse = await fetch(originalPhotoUrl);
    } catch (error) {
      throw markServiceError(error, 'image');
    }
    if (!photoResponse.ok || !photoResponse.body) {
      console.error('Cloudinary original photo download failed:', photoResponse.status);
      return res.status(502).json({ message: 'Unable to retrieve the original customer photo from Cloudinary.' });
    }

    const extension = ['jpg', 'jpeg', 'png', 'webp'].includes(photo.photoFormat)
      ? photo.photoFormat
      : 'jpg';
    const filename = `custom-frame-${order._id.toString().slice(-8)}-${itemIndex + 1}-${photoIndex + 1}.${extension}`;
    res.setHeader('Content-Type', photoResponse.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    const contentLength = photoResponse.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    await pipeline(Readable.fromWeb(photoResponse.body), res);
  } catch (error) {
    console.error('Original customer photo download failed:', error);
    if (!res.headersSent) {
      if (error?.service === 'image' || mongoose.connection.readyState !== 1) {
        return sendServiceError(res, error, 'Unable to download the original customer photo.');
      }
      return res.status(502).json({ message: 'Unable to download the original customer photo.' });
    }
    return res.end();
  }
};

exports.updateOrderStatus = async (req, res) => {
  const { status } = req.body;
  const allowedStatuses = ['pending', 'paid', 'confirmed', 'printing', 'framing', 'shipped', 'delivered', 'cancelled'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: 'Invalid order status.' });
  }

  let session;
  let order;
  let oldStatus;
  try {
    session = await mongoose.startSession();
    await session.withTransaction(async () => {
      order = await Order.findById(req.params.id).session(session);
      if (!order) {
        return;
      }

      oldStatus = order.status;
      order.status = status;

      if (status === 'cancelled' && order.inventoryDeducted && !order.inventoryRestocked) {
        for (const item of order.items) {
          await Product.updateOne(
            { _id: item.product },
            { $inc: { countInStock: item.quantity } },
            { session }
          );
        }
        order.inventoryRestocked = true;
      }

      await order.save({ session });
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    order = await Order.findById(order._id).populate('user', 'username email');
    if (order) {
      

      // Send email when order is delivered
      

      if (status === 'delivered' && oldStatus !== 'delivered') {
        try {
         
          const emailSubject = 'Order Delivered Successfully';
          const deliveryDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });

          // Fetch product details for the order items
          const orderWithProducts = await Order.findById(order._id).populate('items.product');

          let itemsList = '';
          if (orderWithProducts && orderWithProducts.items) {
            itemsList = orderWithProducts.items.map((item, index) => {
              const productName = item.product && item.product.name ? item.product.name : 'Unknown Product';
              return `- ${productName} (Qty: ${item.quantity}, Price: ₹${item.price || 'N/A'})`;
            }).join('\n');
          }

          const emailText = `Dear Customer,\n\nWe're pleased to inform you that your order has been successfully delivered.\n\nThank you for choosing us. We truly appreciate your trust and support.\n\nOrder Status: Delivered\nOrder Number: #${order._id.toString().slice(-8)}\nDelivery Date: ${deliveryDate}\n\nOrder Items:\n${itemsList}\n\nTotal Amount: ₹${order.totalAmount}\n\nWe hope you're satisfied with your purchase. If you have any questions or concerns regarding your order, please don't hesitate to contact our support team.\n\nThank you for shopping with us!\n\nBest regards,\nCustomer Support Team\nShopYet\nsupport@shopyet.com`;

          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 28px;">Order Delivered Successfully</h1>
              </div>
              <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <p style="color: #333; font-size: 16px; line-height: 1.6;">Dear Customer,</p>
                <p style="color: #333; font-size: 16px; line-height: 1.6;">We're pleased to inform you that your order has been <strong>successfully delivered</strong>.</p>
                <p style="color: #333; font-size: 16px; line-height: 1.6;">Thank you for choosing us. We truly appreciate your trust and support.</p>

                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
                  <p style="color: #333; margin: 5px 0; font-size: 14px;"><strong>Order Status:</strong> Delivered</p>
                  <p style="color: #333; margin: 5px 0; font-size: 14px;"><strong>Order Number:</strong> #${order._id.toString().slice(-8)}</p>
                  <p style="color: #333; margin: 5px 0; font-size: 14px;"><strong>Delivery Date:</strong> ${deliveryDate}</p>
                </div>

                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <h3 style="color: #667eea; margin: 0 0 15px 0; font-size: 16px;">Order Items</h3>
                  ${orderWithProducts && orderWithProducts.items ? orderWithProducts.items.map(item => {
                    const productName = item.product && item.product.name ? item.product.name : 'Unknown Product';
                    return `<p style="color: #333; margin: 5px 0; font-size: 14px;">- ${productName} (Qty: ${item.quantity}, Price: ₹${item.price || 'N/A'})</p>`;
                  }).join('') : '<p style="color: #666; font-size: 14px;">No items</p>'}
                </div>

                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
                  <p style="color: #333; margin: 5px 0; font-size: 14px;"><strong>Total Amount:</strong> ₹${order.totalAmount}</p>
                </div>

                <p style="color: #333; font-size: 16px; line-height: 1.6;">We hope you're satisfied with your purchase. If you have any questions or concerns regarding your order, please don't hesitate to contact our support team.</p>

                <p style="color: #333; font-size: 16px; line-height: 1.6;">Thank you for shopping with us!</p>

                <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                  <p style="color: #666; margin: 0; font-size: 14px;">Best regards,<br><strong>Customer Support Team</strong></p>
                  <p style="color: #666; margin: 10px 0 0 0; font-size: 14px;"><strong>ShopYet</strong></p>
                  <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">support@shopyet.com</p>
                </div>
              </div>
            </div>
          `;

            
          await sendEmail(order.user.email, emailSubject, emailText, emailHtml);
          
        } catch (emailError) {
         return res.status(500).json({ message: 'Failed to send delivery email' });
        }
      }

      // Send email when order is cancelled
      if (status === 'cancelled' && oldStatus !== 'cancelled') {
        try {
            
          const emailSubject = 'Order Cancelled';
          const cancellationDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });

          // Fetch product details for the order items
          const orderWithProducts = await Order.findById(order._id).populate('items.product');
            

          let itemsList = '';
          if (orderWithProducts && orderWithProducts.items) {
            itemsList = orderWithProducts.items.map((item, index) => {
              const productName = item.product && item.product.name ? item.product.name : 'Unknown Product';
              return `- ${productName} (Qty: ${item.quantity}, Price: ₹${item.price || 'N/A'})`;
            }).join('\n');
          }
          

          const emailText = `Dear Customer,\n\nWe regret to inform you that your order has been cancelled.\n\nOrder Status: Cancelled\nOrder Number: #${order._id.toString().slice(-8)}\nCancellation Date: ${cancellationDate}\n\nOrder Items:\n${itemsList}\n\nTotal Amount: ₹${order.totalAmount}\n\nIf you have already made a payment, a refund will be processed to your original payment method within 5-7 business days.\n\nIf you have any questions or concerns regarding this cancellation, please don't hesitate to contact our support team.\n\nWe apologize for any inconvenience this may have caused.\n\nBest regards,\nCustomer Support Team\nShopYet\nsupport@shopyet.com`;

          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 28px;">Order Cancelled</h1>
              </div>
              <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                <p style="color: #333; font-size: 16px; line-height: 1.6;">Dear Customer,</p>
                <p style="color: #333; font-size: 16px; line-height: 1.6;">We regret to inform you that your order has been <strong>cancelled</strong>.</p>

                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #e74c3c;">
                  <p style="color: #333; margin: 5px 0; font-size: 14px;"><strong>Order Status:</strong> Cancelled</p>
                  <p style="color: #333; margin: 5px 0; font-size: 14px;"><strong>Order Number:</strong> #${order._id.toString().slice(-8)}</p>
                  <p style="color: #333; margin: 5px 0; font-size: 14px;"><strong>Cancellation Date:</strong> ${cancellationDate}</p>
                </div>

                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                  <h3 style="color: #e74c3c; margin: 0 0 15px 0; font-size: 16px;">Order Items</h3>
                  ${orderWithProducts && orderWithProducts.items ? orderWithProducts.items.map(item => {
                    const productName = item.product && item.product.name ? item.product.name : 'Unknown Product';
                    return `<p style="color: #333; margin: 5px 0; font-size: 14px;">- ${productName} (Qty: ${item.quantity}, Price: ₹${item.price || 'N/A'})</p>`;
                  }).join('') : '<p style="color: #666; font-size: 14px;">No items</p>'}
                </div>

                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #e74c3c;">
                  <p style="color: #333; margin: 5px 0; font-size: 14px;"><strong>Total Amount:</strong> ₹${order.totalAmount}</p>
                </div>

                <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
                  <p style="color: #856404; margin: 0; font-size: 14px;"><strong>Refund Information:</strong> If you have already made a payment, a refund will be processed to your original payment method within 5-7 business days.</p>
                </div>

                <p style="color: #333; font-size: 16px; line-height: 1.6;">If you have any questions or concerns regarding this cancellation, please don't hesitate to contact our support team.</p>

                <p style="color: #333; font-size: 16px; line-height: 1.6;">We apologize for any inconvenience this may have caused.</p>

                <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd;">
                  <p style="color: #666; margin: 0; font-size: 14px;">Best regards,<br><strong>Customer Support Team</strong></p>
                  <p style="color: #666; margin: 10px 0 0 0; font-size: 14px;"><strong>ShopYet</strong></p>
                  <p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">support@shopyet.com</p>
                </div>
              </div>
            </div>
          `;

       
          await sendEmail(order.user.email, emailSubject, emailText, emailHtml);
    
        } catch (emailError) {
          console.error('Order cancelled but cancellation email failed:', emailError);
        }
      }

      res.json({ message: "order status updated successfully", order });
    } else {
      
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (error) {
    console.error('Failed to update order status:', error);
    sendServiceError(res, error, 'Unable to update the order status.');
  } finally {
    if (session) {
      await session.endSession();
    }
  }
}

exports.deleteOrder = async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json({ message: 'Order deleted successfully' });
  } catch (error) {
    console.error('Failed to delete order:', error);
    sendServiceError(res, error, 'Unable to delete the order.');
  }
}
