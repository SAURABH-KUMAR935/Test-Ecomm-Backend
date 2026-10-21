const fs = require('fs');
const path = require('path');

const extensionFormats = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
};

const mimeFormats = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const detectImageFormat = (filePath) => {
  const descriptor = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(12);
  let bytesRead;
  try {
    bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }

  if (bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytesRead >= 8
    && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    bytesRead >= 12
    && header.toString('ascii', 0, 4) === 'RIFF'
    && header.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
};

module.exports = (file) => {
  if (!file || !file.path) return false;

  const extensionFormat = extensionFormats[path.extname(file.originalname || '').toLowerCase()];
  const mimeFormat = mimeFormats[file.mimetype];
  return Boolean(
    extensionFormat
    && extensionFormat === mimeFormat
    && extensionFormat === detectImageFormat(file.path)
  );
};
