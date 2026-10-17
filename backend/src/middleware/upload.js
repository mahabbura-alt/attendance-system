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
    const isDoc = /\/people\//.test(req.originalUrl || '');
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? (isDoc ? 'Ukuran file maksimal 5 MB' : 'Ukuran foto maksimal 5 MB')
      : (isDoc ? 'Upload file tidak valid' : 'Upload foto tidak valid');
    return res.status(400).json({ error: message });
  }
  next(err);
}

module.exports = { imageUpload, multiImageUpload, uploadErrorHandler };

// Dokumen karyawan: PDF ≤5 MB (isi file dicek lagi di layanan: harus diawali %PDF-).
const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    const okType = ['application/pdf', 'application/x-pdf', 'application/octet-stream'].includes(file.mimetype);
    if (!okType || !/\.pdf$/i.test(file.originalname || '')) {
      return callback(Object.assign(new Error('File harus berformat PDF'), { statusCode: 400 }));
    }
    callback(null, true);
  },
});

// Import karyawan: .xlsx ≤5 MB.
const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!/\.xlsx$/i.test(file.originalname || '')) {
      return callback(Object.assign(new Error('File harus berformat Excel .xlsx'), { statusCode: 400 }));
    }
    callback(null, true);
  },
});

// Bukti Fuel: foto/PDF ≤15 MB mentah. Tipe asli dicek dari magic bytes dan foto
// besar dikompres ulang di services/fuelEvidence (batas simpan 2 MB foto, 5 MB PDF).
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 20 },
});

module.exports.pdfUpload = pdfUpload;
module.exports.evidenceUpload = evidenceUpload;
module.exports.xlsxUpload = xlsxUpload;
