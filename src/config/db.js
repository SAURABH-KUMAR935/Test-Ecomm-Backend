const mongoose = require("mongoose");
const dotenv = require("dotenv");
const RegistrationOtp = require("../models/RegistrationOtp");
const SignupRateLimit = require("../models/SignupRateLimit");
const SignupEmailJob = require("../models/SignupEmailJob");
const CustomFramePricing = require("../models/CustomFramePricing");
const PasswordResetOtp = require("../models/PasswordResetOtp");
const PaymentSettings = require("../models/PaymentSettings");

dotenv.config();

let isConnected = false;

const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is not configured");
  }

  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all([
    RegistrationOtp.init(),
    SignupRateLimit.init(),
    SignupEmailJob.init(),
    CustomFramePricing.init(),
    PasswordResetOtp.init(),
    PaymentSettings.init(),
  ]);

  isConnected = true;
  console.log("MongoDB connected");
};

module.exports = connectDB;