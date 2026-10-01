const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');

// Only orders that have been successfully delivered should contribute to sales.
const salesStatuses = ['delivered'];

const getDateRange = (query) => {
  const range = {};

  if (query.from) {
    const from = new Date(query.from);
    if (Number.isNaN(from.getTime())) return null;
    range.$gte = from;
  }

  if (query.to) {
    const to = new Date(query.to);
    if (Number.isNaN(to.getTime())) return null;
    // A date-only `to` value includes the whole final day.
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
      to.setHours(23, 59, 59, 999);
    }
    range.$lte = to;
  }

  return Object.keys(range).length ? range : undefined;
};

exports.getOverview = async (req, res) => {
  const dateRange = getDateRange(req.query);

  if ((req.query.from || req.query.to) && !dateRange) {
    return res.status(400).json({ message: 'Use valid ISO dates for from and to.' });
  }

  if (dateRange?.$gte && dateRange?.$lte && dateRange.$gte > dateRange.$lte) {
    return res.status(400).json({ message: 'The from date must be before the to date.' });
  }

  try {
    const match = dateRange ? { createdAt: dateRange } : {};
    const [analytics] = await Order.aggregate([
      { $match: match },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalOrderValue: { $sum: '$totalAmount' },
                customers: { $addToSet: '$user' },
              },
            },
            {
              $project: {
                _id: 0,
                totalOrders: 1,
                totalOrderValue: 1,
                totalCustomers: { $size: '$customers' },
              },
            },
          ],
          sales: [
            { $match: { status: { $in: salesStatuses } } },
            {
              $group: {
                _id: null,
                totalSales: { $sum: '$totalAmount' },
                successfulOrders: { $sum: 1 },
                averageOrderValue: { $avg: '$totalAmount' },
              },
            },
            { $project: { _id: 0, totalSales: 1, successfulOrders: 1, averageOrderValue: 1 } },
          ],
          unitsSold: [
            { $match: { status: { $in: salesStatuses } } },
            { $unwind: '$items' },
            { $group: { _id: null, totalUnitsSold: { $sum: '$items.quantity' } } },
            { $project: { _id: 0, totalUnitsSold: 1 } },
          ],
          statusBreakdown: [
            {
              $group: {
                _id: '$status',
                orders: { $sum: 1 },
                orderValue: { $sum: '$totalAmount' },
              },
            },
            { $project: { _id: 0, status: '$_id', orders: 1, orderValue: 1 } },
            { $sort: { status: 1 } },
          ],
          salesByMonth: [
            { $match: { status: { $in: salesStatuses } } },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
                sales: { $sum: '$totalAmount' },
                orders: { $sum: 1 },
              },
            },
            { $project: { _id: 0, month: '$_id', sales: 1, orders: 1 } },
            { $sort: { month: 1 } },
          ],
          recentOrders: [
            { $sort: { createdAt: -1 } },
            { $limit: 5 },
            {
              $project: {
                _id: 1,
                totalAmount: 1,
                status: 1,
                createdAt: 1,
                itemCount: { $sum: '$items.quantity' },
              },
            },
          ],
        },
      },
    ]);

    const totals = analytics.totals[0] || {};
    const sales = analytics.sales[0] || {};
    const unitsSold = analytics.unitsSold[0] || {};

    res.json({
      period: { from: req.query.from || null, to: req.query.to || null },
      stats: {
        totalOrders: totals.totalOrders || 0,
        totalOrderValue: totals.totalOrderValue || 0,
        totalCustomers: totals.totalCustomers || 0,
        totalSales: sales.totalSales || 0,
        successfulOrders: sales.successfulOrders || 0,
        averageOrderValue: sales.averageOrderValue || 0,
        totalUnitsSold: unitsSold.totalUnitsSold || 0,
      },
      statusBreakdown: analytics.statusBreakdown,
      salesByMonth: analytics.salesByMonth,
      recentOrders: analytics.recentOrders,
    });
  } catch (error) {
  
    res.status(500).json({ message: 'Unable to load analytics.' });
  }
};

exports.getBasicAnalytics = async (req, res) => {
  try {
    

    const totalSales = await Order.aggregate([
      { $match: { status: { $in: salesStatuses } } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    const totalOrders = await Order.countDocuments();
    const totalProducts = await Product.countDocuments();
    const totalUsers = await User.countDocuments();

    const successfulOrders = await Order.countDocuments({ status: { $in: salesStatuses } });

    const deliveredOrders = await Order.countDocuments({ status: 'delivered' });

    const averageOrderValue = await Order.aggregate([
      { $match: { status: { $in: salesStatuses } } },
      { $group: { _id: null, avgValue: { $avg: '$totalAmount' } } }
    ]);

    const totalCustomers = await Order.aggregate([
      { $group: { _id: null, customers: { $addToSet: '$user' } } },
      { $project: { _id: 0, totalCustomers: { $size: '$customers' } } }
    ]);

    const totalUnitsSold = await Order.aggregate([
      { $match: { status: { $in: salesStatuses } } },
      { $unwind: '$items' },
      { $group: { _id: null, totalUnits: { $sum: '$items.quantity' } } }
    ]);

    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('user', 'username email');

    const topProducts = await Order.aggregate([
      { $match: { status: { $in: salesStatuses } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          sold: { $sum: '$items.quantity' },
          revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { sold: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'products',
          localField: '_id',
          foreignField: '_id',
          as: 'product'
        }
      },
      { $unwind: '$product' },
      {
        $project: {
          _id: '$product._id',
          name: '$product.name',
          category: '$product.category',
          sold: 1,
          revenue: 1
        }
      }
    ]);

    const analyticsData = {
      totalSales: totalSales[0]?.total || 0,
      totalOrders,
      totalProducts,
      totalUsers,
      successfulOrders,
      deliveredOrders,
      averageOrderValue: averageOrderValue[0]?.avgValue || 0,
      totalCustomers: totalCustomers[0]?.totalCustomers || 0,
      totalUnitsSold: totalUnitsSold[0]?.totalUnits || 0,
      recentOrders,
      topProducts
    };

    
    res.json(analyticsData);
  } catch (error) {
   
    res.status(500).json({ message: 'Unable to load analytics.' });
  }
};
