const Minio = require('minio');

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT,
  port: Number(process.env.MINIO_PORT || 9000),
  useSSL: process.env.MINIO_USE_SSL === 'true',
  accessKey: process.env.MINIO_ACCESS_KEY,
  secretKey: process.env.MINIO_SECRET_KEY,
});

const BUCKET = process.env.MINIO_BUCKET || 'absensi-foto';

/**
 * Pastikan bucket ada saat server start. Bucket dibuat private (bukan
 * public-read) karena berisi foto wajah karyawan — akses hanya lewat
 * presigned URL yang di-generate backend, bukan URL publik permanen.
 */
async function pastikanBucketTersedia() {
  try {
    const ada = await minioClient.bucketExists(BUCKET).catch(() => false);
    if (!ada) {
      await minioClient.makeBucket(BUCKET);
      console.log(`Bucket MinIO "${BUCKET}" berhasil dibuat.`);
    }
  } catch (err) {
    console.warn(`[MinIO Fallback] MinIO belum aktif (${err.message}).`);
  }
}

module.exports = { minioClient, BUCKET, pastikanBucketTersedia };
