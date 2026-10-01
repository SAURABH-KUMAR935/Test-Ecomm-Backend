const bcrypt = require('bcryptjs');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/sendEmail');

const generateToken = (id) =>{
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

// Simple in-memory OTP storage (in production, use Redis or database)
const otpStorage = new Map();

// Clean up expired OTPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [email, data] of otpStorage.entries()) {
    if (data.expiresAt < now) {
      otpStorage.delete(email);
    }
  }
}, 5 * 60 * 1000);

exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }
    
    // Generate 6-digit OTP
    const generatedOtp = Math.floor(100000 + Math.random() * 900000);
    

    // Store OTP with 10-minute expiration
    otpStorage.set(email, {
      otp: generatedOtp,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      username: username || email.split('@')[0],
      password: password,
      role: 'user' // Default to user role
    });
    
    // Send OTP to email
    const Message = `Your OTP for email verification is: ${generatedOtp}. This OTP will expire in 10 minutes.`;
    await sendEmail(email, "Email Verification", Message);
    
    // For development/testing, return the OTP in response
    // Remove this in production!
    res.status(200).json({ 
      message: "OTP sent to email",
      otp: generatedOtp, // Remove this in production!
      email 
    });
  } catch (error) {
    
    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern || {})[0] || 'field';
      return res.status(409).json({ message: `${duplicateField} already exists` });
    }
    res.status(500).json({ message: "Server error" });
  }
};

exports.verifyOtpAndRegister = async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    // Check if OTP exists in storage
    const storedData = otpStorage.get(email);
    
    if (!storedData) {
      return res.status(400).json({ message: "OTP expired or not found. Please request a new OTP." });
    }
    
    // Check if OTP has expired
    if (storedData.expiresAt < Date.now()) {
      otpStorage.delete(email);
      return res.status(400).json({ message: "OTP expired. Please request a new OTP." });
    }
    
    // Verify OTP matches (convert both to string for comparison)
    if (String(storedData.otp) !== String(otp)) {
   
      return res.status(400).json({ message: "Invalid OTP. Please try again." });
    }
    
    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      otpStorage.delete(email);
      return res.status(400).json({ message: "User already exists" });
    }
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(storedData.password, salt);
    
    // Create user
    const user = await User.create({ 
      username: storedData.username, 
      email: email, 
      password: hashedPassword,
      role: storedData.role || 'user'
    });
    
    // Delete OTP from storage after successful registration
    otpStorage.delete(email);
    
    if(user) {
      res.status(201).json({
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: "Invalid user data" });
    }
  } catch (error) {

    res.status(500).json({ message: "Server error" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }
    const token = generateToken(user._id);
    res.json({
      _id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      token,
    });
  } catch (error) {
  
    res.status(500).json({ message: "Server error" });
  }
};

exports.getUsers = async (req, res) => {
  try {
    
    const users = await User.find().select('-password'); // Exclude password from the response
    res.json(users);
  } catch (error) {

    res.status(500).json({ message: "Server error" });
  }
};
