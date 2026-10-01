const authController = require('../controllers/authController');
const express = require('express');
const authrouter = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { admin } = require('../middleware/authMiddleware');

authrouter.post('/register', authController.register);
authrouter.post('/verify-otp', authController.verifyOtpAndRegister);
authrouter.post('/login', authController.login);
authrouter.get('/users', protect, admin , authController.getUsers); 

module.exports = authrouter;