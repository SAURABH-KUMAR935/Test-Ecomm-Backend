const { createHmac } = require('crypto');
const SignupRateLimit = require('../models/SignupRateLimit');
const { sendServiceError } = require('../utils/serviceErrors');

const WINDOW_15_MINUTES = 15 * 60 * 1000;

const getRateLimitSecret = () => process.env.JWT_SECRET || 'development-only-rate-limit-key';

const consumeSharedLimit = async (scope, value, max, windowMs) => {
  const now = Date.now();
  const window = Math.floor(now / windowMs);
  const id = createHmac('sha256', getRateLimitSecret())
    .update(`${scope}:${value}:${window}`)
    .digest('hex');

  try {
    const bucket = await SignupRateLimit.findOneAndUpdate(
      { _id: id, count: { $lt: max } },
      {
        $inc: { count: 1 },
        $setOnInsert: { expiresAt: new Date((window + 1) * windowMs + 60_000) },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return Boolean(bucket);
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
};

const createSharedRateLimiter = ({ scope, max, windowMs = WINDOW_15_MINUTES }) => async (req, res, next) => {
  try {
    const allowed = await consumeSharedLimit(scope, req.ip || 'unknown', max, windowMs);
    if (!allowed) {
      console.warn(JSON.stringify({ event: 'auth_rate_limited', scope }));
      return res.status(429).json({ message: 'Too many requests. Please try again later.' });
    }
    return next();
  } catch (error) {
    console.error('Shared authentication rate-limit check failed:', error);
    return sendServiceError(res, error, 'Authentication service is temporarily unavailable.');
  }
};

module.exports = {
  consumeSharedLimit,
  createSharedRateLimiter,
};
