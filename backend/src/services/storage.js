const { minioClient, BUCKET } = require('../config/minio');

const EXPIRY_DETIK = Number(process.env.MINIO_PRESIGNED_URL_EXPIRY || 900);

/**
 * Upload buffer foto (hasil capture kamera) ke MinIO.
 * @returns {string} object key yang disimpan di kolom foto_datang_url/foto_pulang_url
 *                   (BUKAN url publik — bucket private, lihat getUrlFoto)
 */
async function uploadFoto(buffer, { userId, jenis }) {
  const objectKey = `absensi/${userId}/${Date.now()}-${jenis}.jpg`;

  await minioClient.putObject(BUCKET, objectKey, buffer, buffer.length, {
    'Content-Type': 'image/jpeg',
  });

  return objectKey;
}

/**
 * Mengembalikan URL proxy internal agar kebal dari masalah perubahan IP MinIO.
 * (Tidak lagi menggunakan presigned URL yang rentan broken link saat migrasi server)
 */
async function getUrlFoto(objectKey) {
  if (!objectKey) return null;
  // Kembalikan path API proxy kita sendiri
  return `/api/storage/view?key=${encodeURIComponent(objectKey)}`;
}

/**
 * Membaca stream foto dari MinIO dan langsung menyalurkannya (pipe) ke response Express.
 */
async function streamFoto(objectKey, res) {
  try {
    const stream = await minioClient.getObject(BUCKET, objectKey);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache 1 hari di browser
    stream.pipe(res);
  } catch (err) {
    console.error(`[MinIO] Gagal stream foto ${objectKey}:`, err.message);
    res.status(404).send('Foto tidak ditemukan');
  }
}

async function hapusFoto(objectKey) {
  if (!objectKey) return;
  await minioClient.removeObject(BUCKET, objectKey);
}

module.exports = { uploadFoto, getUrlFoto, hapusFoto, streamFoto };
