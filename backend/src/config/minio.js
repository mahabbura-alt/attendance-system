const Minio = require('minio');

let minioClient = null;
try {
  const ep = (process.env.MINIO_ENDPOINT && process.env.MINIO_ENDPOINT.trim()) || 'localhost';
  minioClient = new Minio.Client({
    endPoint: ep,
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
    secretKey: process.env.MINIO_SECRET_KEY || 'Absensi123!',
  });
} catch (e) {
  console.warn('[MinIO Init Warning] MinIO Client disabled:', e.message);
  minioClient = null;
}

const BUCKET = process.env.MINIO_BUCKET || 'absensi-foto';

async function pastikanBucketTersedia() {
  try {
    if (!minioClient || typeof minioClient.bucketExists !== 'function') return;
    const ada = await minioClient.bucketExists(BUCKET).catch(() => false);
    if (!ada) {
      await minioClient.makeBucket(BUCKET).catch(() => {});
      console.log(`Bucket MinIO "${BUCKET}" ready.`);
    }
  } catch (err) {
    console.warn(`[MinIO Fallback] MinIO not active: ${err.message}`);
  }
}

module.exports = { minioClient, BUCKET, pastikanBucketTersedia };
