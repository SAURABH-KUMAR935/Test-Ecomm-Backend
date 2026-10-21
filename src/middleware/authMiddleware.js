const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RevokedToken = require('../models/RevokedToken');
const { sendServiceError } = require('../utils/serviceErrors');

exports.protect = async (req, res, next) => {
  const authorization = req.headers.authorization;
  const match = typeof authorization === 'string'
    ? authorization.match(/^Bearer\s+(\S+)$/i)
    : null;
  if (!match) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }

  let decoded;
  try {
    decoded = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (error) {
    const message = error.name === 'TokenExpiredError'
      ? 'Session expired. Please log in again.'
      : 'Not authorized, token failed';
    return res.status(401).json({ message });
  }

  if (!decoded || typeof decoded !== 'object' || !decoded.id || !decoded.jti || !decoded.exp) {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }

  try {
    const [revokedToken, user] = await Promise.all([
      RevokedToken.exists({ jti: decoded.jti }),
      User.findById(decoded.id).select('-password'),
    ]);
    if (
      revokedToken
      || !user
      || (user.passwordChangedAt && decoded.iat < Math.floor(user.passwordChangedAt.getTime() / 1000))
    ) {
      return res.status(401).json({ message: 'Session is no longer valid. Please log in again.' });
    }

    req.user = user;
    req.tokenJti = decoded.jti;
    req.tokenExpiresAt = decoded.exp;
    return next();
  } catch (error) {
    console.error('Authentication lookup failed:', error);
    return sendServiceError(res, error, 'Unable to authenticate request.');
  }
};

exports.admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: "Not authorized, admin required" });
  }
};
