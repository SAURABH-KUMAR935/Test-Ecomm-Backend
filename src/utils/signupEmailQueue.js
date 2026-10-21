const { createDecipheriv, randomBytes, createCipheriv, createHash } = require('crypto');
const bcrypt = require('bcryptjs');
const SignupEmailJob = require('../models/SignupEmailJob');
const RegistrationOtp = require('../models/RegistrationOtp');
const PasswordResetOtp = require('../models/PasswordResetOtp');
const sendEmail = require('./sendEmail');

const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 10 * 60_000];
const STALE_LOCK_MS = 5 * 60_000;

const getEncryptionKey = () => {
  const configuredKey = process.env.EMAIL_QUEUE_ENCRYPTION_KEY;
  if (!configuredKey && process.env.NODE_ENV !== 'production') {
    return createHash('sha256').update('local-development-only-email-queue-key').digest();
  }
  const key = Buffer.from(configuredKey || '', 'base64');
  if (key.length !== 32) throw new Error('EMAIL_QUEUE_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
};

const encryptOtp = (otp) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encryptedOtp = Buffer.concat([cipher.update(String(otp), 'utf8'), cipher.final()]);
  return {
    encryptedOtp: encryptedOtp.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
};

const decryptOtp = (job) => {
  const decipher = createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(job.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(job.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(job.encryptedOtp, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

const enqueueEmail = async ({ email, otp, emailType, suppress = false }) => {
  const encrypted = suppress ? {} : encryptOtp(otp);
  await SignupEmailJob.create({
    email,
    emailType,
    ...encrypted,
    suppress,
    expiresAt: new Date(Date.now() + JOB_TTL_MS),
  });
};

const enqueueSignupEmail = async ({ email, otp, suppress = false }) => enqueueEmail({
  email,
  otp,
  suppress,
  emailType: 'registration',
});

const enqueuePasswordResetEmail = async ({ email, otp }) => enqueueEmail({
  email,
  otp,
  emailType: 'password-reset',
});

const claimNextJob = async () => {
  const now = new Date();
  return SignupEmailJob.findOneAndUpdate(
    {
      expiresAt: { $gt: now },
      $or: [
        { status: 'queued', nextAttemptAt: { $lte: now } },
        { status: 'processing', lockedAt: { $lt: new Date(now.getTime() - STALE_LOCK_MS) } },
      ],
    },
    { $set: { status: 'processing', lockedAt: now } },
    { sort: { createdAt: 1 }, new: true }
  );
};

const processSignupEmailQueue = async (batchSize = 10) => {
  let sent = 0;
  for (let i = 0; i < batchSize; i += 1) {
    const job = await claimNextJob();
    if (!job) break;
    if (job.suppress) {
      await SignupEmailJob.deleteOne({ _id: job._id });
      continue;
    }

    try {
      const otp = decryptOtp(job);
      const isPasswordReset = job.emailType === 'password-reset';
      const OtpModel = isPasswordReset ? PasswordResetOtp : RegistrationOtp;
      const activeOtp = await OtpModel.findOne({ email: job.email }).select('otpHash expiresAt');
      if (
        !activeOtp
        || activeOtp.expiresAt <= new Date()
        || !(await bcrypt.compare(otp, activeOtp.otpHash))
      ) {
        await SignupEmailJob.deleteOne({ _id: job._id });
        continue;
      }
      const result = await sendEmail(
        job.email,
        isPasswordReset ? 'Password Reset Verification' : 'Email Verification',
        isPasswordReset
          ? `Your password reset code is: ${otp}. This code will expire in 10 minutes.`
          : `Your OTP for email verification is: ${otp}. This OTP will expire in 10 minutes.`
      );
      if (!result) throw new Error('Email provider is not configured.');
      await SignupEmailJob.deleteOne({ _id: job._id });
      sent += 1;
      console.info(JSON.stringify({ event: 'signup_email_sent' }));
    } catch (error) {
      const attempts = job.attempts + 1;
      if (attempts >= MAX_ATTEMPTS || job.expiresAt <= new Date()) {
        await SignupEmailJob.deleteOne({ _id: job._id });
        console.error('Signup verification email permanently failed:', {
          code: error.code,
          responseCode: error.responseCode,
        });
        continue;
      }
      const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
      await SignupEmailJob.updateOne(
        { _id: job._id },
        {
          $set: {
            status: 'queued',
            attempts,
            nextAttemptAt: new Date(Date.now() + delay),
          },
          $unset: { lockedAt: 1 },
        }
      );
      console.error('Signup verification email delivery failed; retry scheduled:', {
        code: error.code,
        responseCode: error.responseCode,
      });
    }
  }
  const pending = await SignupEmailJob.countDocuments({
    status: 'queued',
    expiresAt: { $gt: new Date() },
  });
  if (pending >= 20) {
    console.warn(JSON.stringify({ event: 'signup_email_queue_backlog', pending }));
  }
  return { sent, pending };
};

module.exports = { enqueueSignupEmail, enqueuePasswordResetEmail, processSignupEmailQueue };
