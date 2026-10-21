const bcrypt = require('bcryptjs');
const { createHash, randomBytes, randomInt, timingSafeEqual } = require('crypto');
const User = require('../models/User');
const RegistrationOtp = require('../models/RegistrationOtp');
const PasswordResetOtp = require('../models/PasswordResetOtp');
const RevokedToken = require('../models/RevokedToken');
const generateToken = require('../utils/generateToken');
const { consumeSharedLimit } = require('../middleware/signupAbuseProtection');
const {
  enqueuePasswordResetEmail,
  processSignupEmailQueue,
} = require('../utils/signupEmailQueue');
const sendEmail = require('../utils/sendEmail');
const { markServiceError, sendServiceError } = require('../utils/serviceErrors');

const MAX_OTP_ATTEMPTS = 5;
const REGISTRATION_RESPONSE_MESSAGE = 'If this email can be registered, a verification code will be sent.';
const PASSWORD_RESET_RESPONSE_MESSAGE = 'If an account exists for this email, a password reset code will be sent.';
const validEmail = (email) => typeof email === 'string'
  && email.length <= 254
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const normalizePhone = (phone) => {
  if (typeof phone !== 'string') return null;
  const normalized = phone.trim().replace(/[()\s.-]/g, '');
  return /^\+?\d{10,15}$/.test(normalized) ? normalized : null;
};

const waitForRegistrationResponseFloor = async (startedAt) => {
  const remaining = 300 - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
};

const waitForPasswordResetResponseFloor = async (startedAt) => {
  const remaining = 300 - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
};

const isDisposableEmail = (email) => {
  const domain = email.split('@')[1];
  return (process.env.DISPOSABLE_EMAIL_DOMAINS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .some((blockedDomain) => domain === blockedDomain || domain.endsWith(`.${blockedDomain}`));
};

exports.register = async (req, res) => {
  const startedAt = Date.now();
  try {
    const { username, fullName, email, phone, password } = req.body || {};
    const normalizedPhone = normalizePhone(phone);
    if (
      !validEmail(email)
      || !normalizedPhone
      || typeof password !== 'string'
      || password.length < 8
      || password.length > 128
      || (username != null && (typeof username !== 'string' || username.length > 100))
    ) {
      return res.status(400).json({ message: 'Enter a valid email, phone number, and a password between 8 and 128 characters.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedFullName = typeof fullName === 'string' ? fullName.trim() : '';

    if (isDisposableEmail(normalizedEmail)) {
      return res.status(400).json({ message: 'Please use a permanent email address.' });
    }
    if (!normalizedFullName || normalizedFullName.length > 100) {
      return res.status(400).json({ message: 'Please provide your full name (up to 100 characters).' });
    }

    const emailLimit = await consumeSharedLimit('signup-email', normalizedEmail, 2, 15 * 60 * 1000);
    const globalLimit = emailLimit
      && await consumeSharedLimit('signup-global', 'all', 50, 60 * 60 * 1000);
    if (!emailLimit || !globalLimit) {
      console.warn(JSON.stringify({ event: 'signup_budget_limited', scope: !emailLimit ? 'email' : 'global' }));
      return res.status(429).json({ message: 'Too many registration requests. Please try again later.' });
    }

    const existingUser = await User.findOne({ email: normalizedEmail }).select('_id');
    if (existingUser) {
      console.info(JSON.stringify({ event: 'signup_existing_user' }));
      return res.status(409).json({
        message: 'An account with this email already exists. Please log in instead.',
      });
    }

    const generatedOtp = randomInt(100000, 1000000);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const [otpHash, passwordHash] = await Promise.all([
      bcrypt.hash(String(generatedOtp), 10),
      bcrypt.hash(password, 10),
    ]);

    await RegistrationOtp.findOneAndUpdate({ email: normalizedEmail }, {
      otpHash,
      passwordHash,
      expiresAt,
      attempts: 0,
      username: username?.trim() || normalizedEmail.split('@')[0],
      fullName: normalizedFullName,
      phone: normalizedPhone,
      role: 'user',
    }, { upsert: true, new: true, runValidators: true });
    try {
      const emailResult = await sendEmail(
        normalizedEmail,
        'Email Verification',
        `Your OTP for email verification is: ${generatedOtp}. This OTP will expire in 10 minutes.`
      );
      if (!emailResult) {
        return sendServiceError(
          res,
          markServiceError(new Error('Email service is not configured.'), 'email'),
          'Email service is not configured.',
        );
      }
      console.info(JSON.stringify({ event: 'signup_email_sent' }));
    } catch (error) {
      console.error('Signup email delivery failed:', {
        code: error.code,
        responseCode: error.responseCode,
      });
      return sendServiceError(
        res,
        markServiceError(error, 'email'),
        'Email delivery service is unavailable.',
      );
    }

    console.info(JSON.stringify({ event: 'signup_request_accepted' }));
    await waitForRegistrationResponseFloor(startedAt);
    return res.status(200).json({ message: REGISTRATION_RESPONSE_MESSAGE, email: normalizedEmail });
  } catch (error) {
    console.error('Registration request failed:', error);
    if (error.code === 11000) {
      await waitForRegistrationResponseFloor(startedAt);
      return res.status(200).json({ message: REGISTRATION_RESPONSE_MESSAGE });
    }
    return sendServiceError(res, error, 'Unable to process registration.');
  }
};

exports.verifyOtpAndRegister = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!validEmail(email) || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: 'Enter the 6-digit verification code.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    
    const storedData = await RegistrationOtp.findOne({ email: normalizedEmail });

    if (!storedData) {
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    if (storedData.expiresAt < new Date()) {
      await RegistrationOtp.deleteOne({ _id: storedData._id });
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    if (storedData.attempts >= MAX_OTP_ATTEMPTS) {
      await RegistrationOtp.deleteOne({ _id: storedData._id });
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    const attempt = await RegistrationOtp.findOneAndUpdate(
      { _id: storedData._id, attempts: { $lt: MAX_OTP_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { new: true }
    );
    if (!attempt) {
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    if (!(await bcrypt.compare(otp, attempt.otpHash))) {
      if (attempt.attempts >= MAX_OTP_ATTEMPTS) {
        await RegistrationOtp.deleteOne({ _id: attempt._id });
        return res.status(400).json({ message: 'Invalid or expired verification code.' });
      }
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    const consumedOtp = await RegistrationOtp.findOneAndDelete({
      _id: attempt._id,
      attempts: { $lte: MAX_OTP_ATTEMPTS },
    });
    if (!consumedOtp) {
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'Unable to complete verification. Please sign in or request a new code.' });
    }

    const user = await User.create({ 
      username: storedData.username, 
      fullName: storedData.fullName,
      phone: storedData.phone || '',
      email: normalizedEmail, 
      password: storedData.passwordHash,
      role: storedData.role || 'user',
      verified: true,
    });

    if(user) {
      res.status(201).json({
        _id: user._id,
        username: user.username,
        fullName: user.fullName || user.username,
        email: user.email,
        phone: user.phone || '',
        role: user.role,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: "Invalid user data" });
    }
  } catch (error) {
    console.error('Email verification failed:', error);
    sendServiceError(res, error, 'Unable to verify your email address.');
  }
};

exports.requestPasswordReset = async (req, res) => {
  const startedAt = Date.now();
  const email = req.body?.email;
  if (!validEmail(email)) {
    return res.status(400).json({ message: 'Enter a valid email address.' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  try {
    if (
      process.env.NODE_ENV !== 'production'
      && (!process.env.EMAIL_USER || !process.env.EMAIL_PASS)
    ) {
      await waitForPasswordResetResponseFloor(startedAt);
      return res.status(503).json({
        message: 'Password reset email is unavailable. Configure EMAIL_USER and EMAIL_PASS in Backend/.env.',
      });
    }

    const emailLimit = await consumeSharedLimit('password-reset-email', normalizedEmail, 3, 15 * 60 * 1000);
    const globalLimit = emailLimit
      && await consumeSharedLimit('password-reset-global', 'all', 50, 60 * 60 * 1000);
    if (!emailLimit || !globalLimit) {
      console.warn(JSON.stringify({
        event: 'password_reset_budget_limited',
        scope: !emailLimit ? 'email' : 'global',
      }));
      await waitForPasswordResetResponseFloor(startedAt);
      return res.status(429).json({ message: 'Too many password reset requests. Please try again later.' });
    }

    const user = await User.findOne({ email: normalizedEmail }).select('_id email');
    if (user) {
      const otp = randomInt(100000, 1000000).toString();
      const otpHash = await bcrypt.hash(otp, 10);
      await PasswordResetOtp.findOneAndUpdate(
        { email: normalizedEmail },
        {
          $set: {
            otpHash,
            attempts: 0,
            resetTokenHash: null,
            resetTokenExpiresAt: null,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
          },
        },
        { upsert: true, new: true, runValidators: true },
      );

      if (process.env.NODE_ENV === 'production') {
        await enqueuePasswordResetEmail({ email: normalizedEmail, otp });
      } else {
        try {
          const emailResult = await sendEmail(
            normalizedEmail,
            'Password Reset Verification',
            `Your password reset code is: ${otp}. This code will expire in 10 minutes.`,
          );
          if (!emailResult) {
            console.error('Password reset email could not be sent because email is not configured.');
          }
        } catch (emailError) {
          console.error('Password reset email delivery failed:', {
            code: emailError.code,
            responseCode: emailError.responseCode,
          });
        }
      }
    }

    await waitForPasswordResetResponseFloor(startedAt);
    return res.status(200).json({ message: PASSWORD_RESET_RESPONSE_MESSAGE });
  } catch (error) {
    console.error('Password reset request failed:', error);
    await waitForPasswordResetResponseFloor(startedAt);
    return sendServiceError(res, error, 'Unable to process the password reset request.');
  }
};

exports.verifyPasswordResetOtp = async (req, res) => {
  const { email, otp } = req.body || {};
  if (!validEmail(email) || typeof otp !== 'string' || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ message: 'Enter the email address and 6-digit verification code.' });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const storedReset = await PasswordResetOtp.findOne({ email: normalizedEmail });
    if (
      !storedReset
      || storedReset.expiresAt <= new Date()
      || storedReset.attempts >= MAX_OTP_ATTEMPTS
    ) {
      if (storedReset && storedReset.attempts >= MAX_OTP_ATTEMPTS) {
        await PasswordResetOtp.deleteOne({ _id: storedReset._id });
      }
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    const attempt = await PasswordResetOtp.findOneAndUpdate(
      { _id: storedReset._id, attempts: { $lt: MAX_OTP_ATTEMPTS }, expiresAt: { $gt: new Date() } },
      { $inc: { attempts: 1 } },
      { new: true },
    );
    if (!attempt || !(await bcrypt.compare(otp, attempt.otpHash))) {
      if (attempt?.attempts >= MAX_OTP_ATTEMPTS) {
        await PasswordResetOtp.deleteOne({ _id: attempt._id });
      }
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    const resetToken = randomBytes(32).toString('hex');
    const resetExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const verifiedReset = await PasswordResetOtp.findOneAndUpdate(
      { _id: attempt._id, expiresAt: { $gt: new Date() } },
      {
        $set: {
          resetTokenHash: createHash('sha256').update(resetToken).digest('hex'),
          resetTokenExpiresAt: resetExpiresAt,
          expiresAt: resetExpiresAt,
        },
      },
      { new: true },
    );
    if (!verifiedReset) {
      return res.status(400).json({ message: 'Invalid or expired verification code.' });
    }

    return res.json({ message: 'Code verified. You can now choose a new password.', resetToken });
  } catch (error) {
    console.error('Password reset code verification failed:', error);
    return sendServiceError(res, error, 'Unable to verify the password reset code.');
  }
};

exports.resetPassword = async (req, res) => {
  const { email, resetToken, password } = req.body || {};
  if (
    !validEmail(email)
    || typeof resetToken !== 'string'
    || !/^[a-f\d]{64}$/i.test(resetToken)
    || typeof password !== 'string'
    || password.length < 8
    || password.length > 128
  ) {
    return res.status(400).json({ message: 'Choose a password between 8 and 128 characters using a valid reset session.' });
  }

  try {
    const normalizedEmail = email.trim().toLowerCase();
    const resetTokenHash = createHash('sha256').update(resetToken).digest('hex');
    const reset = await PasswordResetOtp.findOneAndDelete({
      email: normalizedEmail,
      resetTokenHash,
      resetTokenExpiresAt: { $gt: new Date() },
      expiresAt: { $gt: new Date() },
    });
    if (!reset) {
      return res.status(400).json({ message: 'Invalid or expired password reset session. Request a new code.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.findOneAndUpdate(
      { email: normalizedEmail },
      { $set: { password: passwordHash, passwordChangedAt: new Date() } },
      { new: true },
    );
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired password reset session. Request a new code.' });
    }
    return res.json({ message: 'Your password has been reset. Please sign in with your new password.' });
  } catch (error) {
    console.error('Password reset failed:', error);
    return sendServiceError(res, error, 'Unable to reset your password.');
  }
};

exports.processSignupEmailQueue = async (req, res) => {
  const expectedToken = process.env.CRON_SECRET;
  const suppliedToken = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (
    !expectedToken
    || !suppliedToken
    || Buffer.byteLength(expectedToken) !== Buffer.byteLength(suppliedToken)
    || !timingSafeEqual(Buffer.from(expectedToken), Buffer.from(suppliedToken))
  ) {
    return res.status(401).json({ message: 'Unauthorized.' });
  }

  try {
    const result = await processSignupEmailQueue(10);
    return res.status(200).json(result);
  } catch (error) {
    console.error('Signup email queue processing failed:', error);
    return sendServiceError(res, error, 'Email queue processing failed.');
  }
};
exports.logout = async (req, res) => {
  try {
    await RevokedToken.create({
      jti: req.tokenJti,
      expiresAt: new Date(req.tokenExpiresAt * 1000),
    });
    return res.status(204).end();
  } catch (error) {
    if (error.code === 11000) {
      return res.status(204).end();
    }
    console.error('Session revocation failed:', error);
    return sendServiceError(res, error, 'Unable to log out securely.');
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!validEmail(email) || typeof password !== 'string' || password.length > 128) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    const user = await User.findOne({ email: email.trim().toLowerCase() });
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
      fullName: user.fullName || user.username,
      email: user.email,
      phone: user.phone || '',
      role: user.role,
      token,
    });
  } catch (error) {
    console.error('Login failed:', error);
    sendServiceError(res, error, 'Unable to sign in.');
  }
};

exports.getUsers = async (req, res) => {
  try {
    
    const users = await User.find().select('-password'); // Exclude password from the response
    res.json(users);
  } catch (error) {
    console.error('Failed to load users:', error);
    sendServiceError(res, error, 'Unable to load users.')
  }
};
//up to date
