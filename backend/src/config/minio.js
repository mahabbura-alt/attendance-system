const Minio = require('minio');

let minioClient;
try {
  minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: Number(process.env.MINIO_PORT || 9000),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'admin',
    secretKey: process.env.MINIO_SECRET_KEY || 'Absensi123!',
  });
} catch (e) {
  console.warn('[MinIO Init Warning]', e.message);
  minioClient = {
    bucketExists: async () => false,
    makeBucket: async () => {},
    putObject: async () => {},
    presignedGetObject: async () => '',
  };
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
