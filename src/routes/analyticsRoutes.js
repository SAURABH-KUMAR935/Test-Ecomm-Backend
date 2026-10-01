const express = require('express');
const { getOverview, getBasicAnalytics } = require('../controllers/analyticsController');
const { protect, admin } = require('../middleware/authMiddleware');

const router = express.Router();

// GET /api/analytics/overview?from=2026-01-01&to=2026-01-31
router.get('/overview', protect, admin, getOverview);

// GET /api/analytics - Basic analytics for admin dashboard
router.get('/', protect, admin, getBasicAnalytics);

module.exports = router;
