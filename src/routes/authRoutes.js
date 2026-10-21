const authController = require('../controllers/authController');
const express = require('express');
const authrouter = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { admin } = require('../middleware/authMiddleware');
const {
  createSharedRateLimiter,
} = require('../middleware/signupAbuseProtection');

authrouter.post(
  '/register',
  createSharedRateLimiter({ scope: 'register-ip', max: 5 }),
  authController.register
);
authrouter.post(
  '/verify-otp',
  createSharedRateLimiter({ scope: 'verify-otp-ip', max: 10 }),
  authController.verifyOtpAndRegister
);
authrouter.post(
  '/login',
  createSharedRateLimiter({ scope: 'login-ip', max: 10 }),
  authController.login
);
authrouter.post(
  '/forgot-password',
  createSharedRateLimiter({ scope: 'password-reset-request-ip', max: 10 }),
  authController.requestPasswordReset
);
authrouter.post(
  '/verify-password-reset-otp',
  createSharedRateLimiter({ scope: 'password-reset-verify-ip', max: 10 }),
  authController.verifyPasswordResetOtp
);
authrouter.post(
  '/reset-password',
  createSharedRateLimiter({ scope: 'password-reset-complete-ip', max: 5 }),
  authController.resetPassword
);
authrouter.get('/process-email-queue', authController.processSignupEmailQueue);
authrouter.post('/logout', protect, authController.logout);
authrouter.get('/users', protect, admin , authController.getUsers); 

module.exports = authrouter;