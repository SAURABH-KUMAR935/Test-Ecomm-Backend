const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
  } catch (error) {
    process.exit(1);
  }
};

module.exports = connectDB;
