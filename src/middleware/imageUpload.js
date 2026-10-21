const multer = require('multer');

const upload = multer({
  dest: '/tmp/',
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    const allowedExtension = /\.(jpe?g|png|webp)$/i.test(file.originalname || '');
    const allowedMimeType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    if (!allowedExtension || !allowedMimeType) {
      return callback(new Error('Only JPG, JPEG, PNG, and WEBP images are allowed.'));
    }
    return callback(null, true);
  },
});

module.exports = (fields) => (req, res, next) => {
  const parseUpload = typeof fields === 'string'
    ? upload.single(fields)
    : upload.fields(Object.entries(fields).map(([name, maxCount]) => ({ name, maxCount })));

  parseUpload(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'Image must be 5MB or smaller.' });
    }
    return res.status(400).json({ message: error.message });
  });
};
