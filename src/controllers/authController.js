const bcrypt = require('bcryptjs');
const User = require('../models/User');
const RegistrationOtp = require('../models/RegistrationOtp');
const generateToken = require('../utils/generateToken');
const sendEmail = require('../utils/sendEmail');

exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }
    
    const generatedOtp = Math.floor(100000 + Math.random() * 900000);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await RegistrationOtp.findOneAndUpdate({ email }, {
      otpHash: await bcrypt.hash(String(generatedOtp), 10),
      passwordHash: await bcrypt.hash(password, 10),
      expiresAt,
      username: username || email.split('@')[0],
      role: 'user',
    }, { upsert: true, new: true, runValidators: true });

    const message = `Your OTP for email verification is: ${generatedOtp}. This OTP will expire in 10 minutes.`;
    await sendEmail(email, 'Email Verification', message);

    const response = {
      message: "OTP sent to email",
      email,
    };
    if (process.env.NODE_ENV !== 'production') {
      response.otp = generatedOtp;
    }
    res.status(200).json(response);
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
    
    const storedData = await RegistrationOtp.findOne({ email });

    if (!storedData) {
      return res.status(400).json({ message: "OTP expired or not found. Please request a new OTP." });
    }

    if (storedData.expiresAt < new Date()) {
      await RegistrationOtp.deleteOne({ _id: storedData._id });
      return res.status(400).json({ message: "OTP expired. Please request a new OTP." });
    }

    if (!(await bcrypt.compare(String(otp), storedData.otpHash))) {
      return res.status(400).json({ message: "Invalid OTP. Please try again." });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      await RegistrationOtp.deleteOne({ _id: storedData._id });
      return res.status(400).json({ message: "User already exists" });
    }

    const user = await User.create({ 
      username: storedData.username, 
      email: email, 
      password: storedData.passwordHash,
      role: storedData.role || 'user'
    });

    await RegistrationOtp.deleteOne({ _id: storedData._id });
    
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
