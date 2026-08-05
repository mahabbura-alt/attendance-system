const { minioClient, BUCKET } = require('../config/minio');

/**
 * Upload buffer foto (hasil capture kamera) ke MinIO / Storage Fallback.
 * @returns {string} object key atau base64 data URL
 */
async function uploadFoto(buffer, { userId, jenis }) {
  if (!buffer || buffer.length === 0) return null;

  const objectKey = `absensi/${userId}/${Date.now()}-${jenis}.jpg`;

  try {
    if (minioClient && typeof minioClient.putObject === 'function') {
      await minioClient.putObject(BUCKET, objectKey, buffer, buffer.length, {
        'Content-Type': 'image/jpeg',
      });
      return objectKey;
    }
  } catch (err) {
    console.warn(`[MinIO Storage Fallback] MinIO not available (${err.message}). Using base64 encoding.`);
  }

  // Fallback untuk Vercel Cloud / Serverless tanpa MinIO container
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

/**
 * Mengembalikan URL foto (Proxy API URL atau Data URL)
 */
async function getUrlFoto(objectKey) {
  if (!objectKey) return null;
  if (objectKey.startsWith('data:image/') || objectKey.startsWith('http://') || objectKey.startsWith('https://')) {
    return objectKey;
  }
  return `/api/storage/view?key=${encodeURIComponent(objectKey)}`;
}

/**
 * Membaca stream foto dari MinIO / Data URL
 */
async function streamFoto(objectKey, res) {
  if (!objectKey) return res.status(404).send('Foto tidak ditemukan');

  if (objectKey.startsWith('data:image/')) {
    const base64Data = objectKey.split(',')[1];
    const imgBuffer = Buffer.from(base64Data, 'base64');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(imgBuffer);
  }

  try {
    const stream = await minioClient.getObject(BUCKET, objectKey);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    stream.pipe(res);
  } catch (err) {
    console.error(`[MinIO] Gagal stream foto ${objectKey}:`, err.message);
    res.status(404).send('Foto tidak ditemukan');
  }
}

async function hapusFoto(objectKey) {
  if (!objectKey || objectKey.startsWith('data:image/')) return;
  try {
    await minioClient.removeObject(BUCKET, objectKey);
  } catch (_) {}
}

module.exports = { uploadFoto, getUrlFoto, hapusFoto, streamFoto };
