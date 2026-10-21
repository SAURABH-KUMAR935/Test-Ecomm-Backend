const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const connectDB = require("./config/db");
const { sendServiceError } = require("./utils/serviceErrors");

const app = express();

const trustProxyHops = process.env.TRUST_PROXY_HOPS;
if (trustProxyHops !== undefined) {
  const parsedTrustProxyHops = Number(trustProxyHops);
  if (!Number.isInteger(parsedTrustProxyHops) || parsedTrustProxyHops < 0 || parsedTrustProxyHops > 5) {
    throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5.');
  }
  app.set('trust proxy', parsedTrustProxyHops);
}

if (
  process.env.NODE_ENV === 'production'
  && (typeof process.env.JWT_SECRET !== 'string' || process.env.JWT_SECRET.length < 32)
) {
  throw new Error('Configure JWT_SECRET with a random value of at least 32 characters.');
}
if (
  process.env.NODE_ENV === 'production'
  && (
    !process.env.TURNSTILE_SECRET_KEY
    || !(process.env.TURNSTILE_ALLOWED_HOSTNAMES || '').split(',').some((hostname) => hostname.trim())
    || typeof process.env.CRON_SECRET !== 'string'
    || process.env.CRON_SECRET.length < 32
    || Buffer.from(process.env.EMAIL_QUEUE_ENCRYPTION_KEY || '', 'base64').length !== 32
    || !process.env.EMAIL_USER
    || !process.env.EMAIL_PASS
    || trustProxyHops === undefined
    || Number(trustProxyHops) < 1
  )
) {
  throw new Error('Configure Turnstile hostnames and secret, email queue, SMTP, and trusted proxy settings before production startup.');
}

const configuredOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = configuredOrigins.length
  ? configuredOrigins
  : process.env.NODE_ENV === 'production'
    ? []
    : ['http://localhost:5173'];

if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
  throw new Error('Configure CORS_ORIGINS with the production frontend origin.');
}

app.use(helmet());
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)),
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true }));

// Connect to MongoDB before handling requests
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error("Database connection failed:", error.message);
    sendServiceError(res, error, 'Database connection failed.');
  }
});

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/products", require("./routes/productRoutes"));
app.use("/api/custom-frames", require("./routes/customFrameRoutes"));
app.use("/api/cart", require("./routes/cartRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/payment-settings", require("./routes/paymentSettingsRoutes"));
app.use("/api/analytics", require("./routes/analyticsRoutes"));

app.get("/", (req, res) => {
  res.json({ message: "E-commerce API is running" });
});

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found.' });
});

app.use((error, req, res, next) => {
  console.error('Unhandled API error:', error);
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  if (status === 500) {
    return sendServiceError(res, error, 'Server error.');
  }
  return res.status(status).json({
    message: 'Invalid request.',
  });
});

// Required for Vercel
module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}