const multer = require('multer');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return callback(Object.assign(new Error('Foto harus berformat JPEG atau PNG'), { statusCode: 400 }));
    }
    callback(null, true);
  },
});

const multiImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 3 },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      return callback(Object.assign(new Error('Foto harus berformat JPEG atau PNG'), { statusCode: 400 }));
    }
    callback(null, true);
  },
});

function uploadErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Ukuran foto maksimal 5 MB'
      : 'Upload foto tidak valid';
    return res.status(400).json({ error: message });
  }
  next(err);
}

module.exports = { imageUpload, multiImageUpload, uploadErrorHandler };
