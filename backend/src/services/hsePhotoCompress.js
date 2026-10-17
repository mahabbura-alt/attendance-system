'use strict';

const sharp = require('sharp');

const MAX_HSE_PHOTOS = 3;
const PHOTO_MAX_DIMENSION = 1200;
const PHOTO_TARGET_MAX_BYTES = 110 * 1024;
const PHOTO_QUALITY_LADDER = [72, 58, 45, 35];
const FALLBACK_JPEG_QUALITY_LADDER = [58, 35];

// Batas ukuran foto mentah yang diterima sebelum dikompresi (mencegah beban memori berlebih).
const PHOTO_MAX_INPUT_BYTES = 15 * 1024 * 1024;
// Format hasil kompresi: foto sekecil ini tidak dikompres ulang (hindari penurunan kualitas berulang).
const COMPRESSED_FORMATS = new Set(['webp', 'jpeg', 'jpg']);

function photoError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  return error;
}

/** Data URL gambar apa pun (png/jpeg/webp/heic/gif/avif/...) → { format, buffer }. Bukan data URL → null. */
function parseImageDataUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('data:')) return null;
  const match = /^data:image\/([\w.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(trimmed);
  if (!match) throw photoError('Lampiran foto harus berupa gambar (JPG, PNG, WebP, HEIC).');
  const buffer = Buffer.from(match[2].replace(/[\r\n]+/g, ''), 'base64');
  if (!buffer.length) throw photoError('File foto kosong atau rusak.');
  if (buffer.length > PHOTO_MAX_INPUT_BYTES) throw photoError('Ukuran foto terlalu besar (maks. 15 MB sebelum dikompresi).');
  return { format: match[1].toLowerCase(), buffer };
}

function toDataUrl(format, buffer) {
  const mime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/** Ukuran biner sebuah data URL (byte); 0 bila bukan data URL. */
function dataUrlBytes(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return 0;
  const i = value.indexOf(',');
  return i < 0 ? 0 : Math.floor((value.length - i - 1) * 3 / 4);
}

/**
 * Mesin kompresi foto HSE: semua foto yang masuk (dashboard & APK) diubah ke WebP/JPEG ≤ ±110 KB, sisi terpanjang ≤ 1200 px,
 * orientasi EXIF diterapkan (metadata/GPS dibuang). Foto WebP/JPEG yang sudah ≤ target dibiarkan.
 * URL biasa (bukan data URL) dibiarkan. Gambar yang gagal diproses dan masih besar ditolak (422), tidak disimpan mentah.
 */
async function compressPhotoDataUrl(value) {
  const parsed = parseImageDataUrl(value);
  if (!parsed) return value;
  const { format, buffer } = parsed;
  if (COMPRESSED_FORMATS.has(format) && buffer.length <= PHOTO_TARGET_MAX_BYTES) return value;
  try {
    const base = () => sharp(buffer)
      .rotate()
      .resize({
        width: PHOTO_MAX_DIMENSION,
        height: PHOTO_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      });

    for (const quality of PHOTO_QUALITY_LADDER) {
      const out = await base().webp({ quality }).toBuffer();
      if (out.length <= PHOTO_TARGET_MAX_BYTES) return toDataUrl('webp', out);
    }

    for (const quality of FALLBACK_JPEG_QUALITY_LADDER) {
      const out = await base().jpeg({ quality, progressive: true }).toBuffer();
      if (out.length <= PHOTO_TARGET_MAX_BYTES) return toDataUrl('jpeg', out);
    }

    const lastResort = await base().jpeg({ quality: 35, progressive: true }).toBuffer();
    return toDataUrl('jpeg', lastResort);
  } catch (_) {
    // Tidak bisa didekode (format tak didukung / rusak): simpan hanya bila sudah kecil, selain itu tolak.
    if (buffer.length <= PHOTO_TARGET_MAX_BYTES) return value;
    throw photoError(`Foto format ${format.toUpperCase()} tidak dapat diproses. Gunakan foto JPG atau PNG.`);
  }
}

async function compressHsePhotos(photos, { maxPhotos = MAX_HSE_PHOTOS } = {}) {
  const list = Array.isArray(photos) ? photos.filter(Boolean) : (photos ? [photos] : []);
  if (list.length === 0) return [];
  if (list.length > maxPhotos) {
    const error = new Error(`Maksimal ${maxPhotos} foto per input`);
    error.statusCode = 422;
    throw error;
  }
  const out = [];
  for (const item of list) {
    out.push(await compressPhotoDataUrl(item));
  }
  return out;
}

async function compressNewPhotos(currentPhotos, incomingPhotos, { maxPhotos = MAX_HSE_PHOTOS } = {}) {
  if (!Array.isArray(incomingPhotos)) return Array.isArray(currentPhotos) ? currentPhotos : [];
  const next = incomingPhotos.filter(Boolean);
  if (next.length > maxPhotos) {
    const error = new Error(`Maksimal ${maxPhotos} foto per input`);
    error.statusCode = 422;
    throw error;
  }
  const seen = new Set((Array.isArray(currentPhotos) ? currentPhotos : []).map(String));
  const out = [];
  for (const item of next) {
    // Foto lama tetap dipakai apa adanya kecuali masih besar (data lama sebelum ada kompresi) → ikut dikompres.
    const keep = seen.has(String(item)) && dataUrlBytes(item) <= PHOTO_TARGET_MAX_BYTES;
    out.push(keep ? item : await compressPhotoDataUrl(item));
  }
  return out;
}

module.exports = {
  MAX_HSE_PHOTOS,
  PHOTO_TARGET_MAX_BYTES,
  dataUrlBytes,
  compressPhotoDataUrl,
  compressHsePhotos,
  compressNewPhotos,
};
