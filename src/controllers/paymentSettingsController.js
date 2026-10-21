const fs = require('fs');
const cloudinary = require('../config/cloudinary');
const PaymentSettings = require('../models/PaymentSettings');
const isValidImageUpload = require('../utils/validateImageUpload');
const { markServiceError, sendServiceError } = require('../utils/serviceErrors');

const getPaymentSettings = async () => PaymentSettings.findOne({ key: 'default' });

exports.getPublicPaymentSettings = async (req, res) => {
  try {
    const settings = await getPaymentSettings();
    if (!settings) {
      return res.json({ configured: false });
    }

    return res.json({
      configured: Boolean(settings.qrImageUrl || settings.upiId),
      paymentMethod: settings.paymentMethod,
      qrImageUrl: settings.qrImageUrl || '',
      upiId: settings.upiId || '',
    });
  } catch (error) {
    console.error('Failed to load public payment settings:', error);
    return sendServiceError(res, error, 'Unable to load UPI payment details.');
  }
};

exports.getAdminPaymentSettings = async (req, res) => {
  try {
    const settings = await getPaymentSettings();
    return res.json({
      paymentMethod: settings?.paymentMethod || 'upiId',
      upiId: settings?.upiId || '',
      qrImageUrl: settings?.qrImageUrl || '',
    });
  } catch (error) {
    console.error('Failed to load admin payment settings:', error);
    return sendServiceError(res, error, 'Unable to load payment settings.');
  }
};

exports.updateAdminPaymentSettings = async (req, res) => {
  const uploadedFile = req.file;
  let uploadedQrPublicId = '';
  let temporaryFileRemoved = false;
  const removeTemporaryFile = () => {
    if (uploadedFile?.path && !temporaryFileRemoved && fs.existsSync(uploadedFile.path)) {
      fs.unlinkSync(uploadedFile.path);
      temporaryFileRemoved = true;
    }
  };

  try {
    const upiId = typeof req.body?.upiId === 'string' ? req.body.upiId.trim() : '';
    if (
      upiId
      && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}@[A-Za-z0-9][A-Za-z0-9.-]{1,63}$/.test(upiId)
    ) {
      return res.status(400).json({ message: 'Enter a valid UPI ID.' });
    }

    let settings = await getPaymentSettings();
    let qrImageUrl = settings?.qrImageUrl || '';
    let qrImagePublicId = settings?.qrImagePublicId || '';

    if (uploadedFile) {
      if (!isValidImageUpload(uploadedFile)) {
        removeTemporaryFile();
        return res.status(400).json({ message: 'Upload a valid JPG, PNG, or WEBP QR image.' });
      }

      let result;
      try {
        result = await cloudinary.uploader.upload(uploadedFile.path, {
          folder: 'zavique-art/payment-settings',
          resource_type: 'image',
        });
      } catch (error) {
        throw markServiceError(error, 'image');
      }
      uploadedQrPublicId = result.public_id;
      qrImageUrl = result.secure_url;
      qrImagePublicId = result.public_id;
    }
    removeTemporaryFile();

    if (!upiId && !qrImageUrl) {
      return res.status(400).json({ message: 'Configure at least a UPI ID or a QR code.' });
    }
    const paymentMethod = upiId && qrImageUrl ? 'both' : upiId ? 'upiId' : 'qr';

    settings = await PaymentSettings.findOneAndUpdate(
      { key: 'default' },
      {
        $set: { paymentMethod, upiId, qrImageUrl, qrImagePublicId },
        $setOnInsert: { key: 'default' },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    );

    return res.json({
      paymentMethod: settings.paymentMethod,
      upiId: settings.upiId,
      qrImageUrl: settings.qrImageUrl,
    });
  } catch (error) {
    removeTemporaryFile();
    if (uploadedQrPublicId) {
      try {
        await cloudinary.uploader.destroy(uploadedQrPublicId, { resource_type: 'image' });
      } catch (cleanupError) {
        console.error('Failed to remove an unsaved UPI QR image:', cleanupError);
      }
    }
    console.error('Failed to update admin payment settings:', error);
    return sendServiceError(res, error, 'Unable to save payment settings.');
  } finally {
    removeTemporaryFile();
  }
};
