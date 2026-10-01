const Order = require('../models/Order');
const Product = require('../models/Product');
const sendEmail = require('../utils/sendEmail');

exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find().populate('user', 'id name email');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

exports.createOrder = async (req, res) => {
  const { items, totalAmount, address, paymentId } = req.body;
  try {
    if(!items || items.length === 0 || !totalAmount || !address || !paymentId) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const order = await Order.create({
      user: req.user._id,
      items,
      totalAmount,
      address,
      paymentId
    });
    
    // Fetch product details for the order items
    const orderWithProducts = await Order.findById(order._id).populate('items.product');
    
    // Create detailed order message with product names
    let itemsList = '';
    if (orderWithProducts && orderWithProducts.items) {
      itemsList = orderWithProducts.items.map((item, index) => {
        const productName = item.product && item.product.name ? item.product.name : 'Unknown Product';
        return `- Item ${index + 1}: ${productName} (Quantity: ${item.quantity}, Price: ₹${item.price || 'N/A'})`;
      }).join('\n');
    }
    
    const message = `New order created by ${req.user.username} (${req.user.email})

Order ID: ${order._id.toString()}
Order Status: ${order.status}
Payment ID: ${paymentId}

Order Items:
${itemsList}

Total Amount: ₹${totalAmount}

Shipping Address:
Name: ${address.fullName}
Street: ${address.street}
City: ${address.city}
Postal Code: ${address.postalCode}`;
   
    await sendEmail(req.user.email, 'Order Confirmation', message);
    res.status(201).json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

exports.myorders = async (req, res) => {
  try {
    const orders = await Order.find({ user: req.user._id }).populate('items.product');
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

exports.getOrderById = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('user', 'username email').populate('items.product');
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    res.json(order);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
}

exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
  
    const order = await Order.findById(req.params.id).populate('user', 'username email');
    if (order) {
      const oldStatus = order.status;
      order.status = status;
      await order.save();
      

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
          res.status(500).json({ message: 'Failed to send cancellation email' });
        }
      }

      res.json({ message: "order status updated successfully", order });
    } else {
      
      res.status(404).json({ message: 'Order not found' });
    }
  } catch (error) {
    
    res.status(500).json({ message: error.message });
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
    res.status(500).json({ message: error.message });
  }
}

