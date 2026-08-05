const { createClient } = require('@supabase/supabase-js');
const { minioClient, BUCKET } = require('../config/minio');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://lpezydpyzvfydbhwimqq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Upload buffer foto ke Supabase Storage Bucket "absensi-foto".
 * @returns {string} Direct Public Image URL (Bisa langsung diklik dan dilihat gambarnya di Supabase / Browser / App)
 */
async function uploadFoto(buffer, { userId, jenis }) {
  if (!buffer || buffer.length === 0) return null;

  const objectKey = `absensi/${userId}/${Date.now()}-${jenis}.jpg`;

  // 1. Primary: Upload ke Supabase Storage (Visual Cloud Bucket)
  try {
    const { data, error } = await supabase.storage
      .from('absensi-foto')
      .upload(objectKey, buffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (!error && data) {
      const { data: publicUrlData } = supabase.storage
        .from('absensi-foto')
        .getPublicUrl(objectKey);

      return publicUrlData.publicUrl;
    }
  } catch (supaErr) {
    console.warn(`[Supabase Storage Fallback] ${supaErr.message}`);
  }

  // 2. Secondary: Fallback ke MinIO (Local Container)
  try {
    if (minioClient && typeof minioClient.putObject === 'function') {
      await minioClient.putObject(BUCKET, objectKey, buffer, buffer.length, {
        'Content-Type': 'image/jpeg',
      });
      return objectKey;
    }
  } catch (minioErr) {
    console.warn(`[MinIO Storage Fallback] ${minioErr.message}`);
  }

  // 3. Tertiary: Fallback ke Data URI Base64
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

/**
 * Mengembalikan Public Image URL atau Proxy URL
 */
async function getUrlFoto(objectKey) {
  if (!objectKey) return null;
  if (objectKey.startsWith('http://') || objectKey.startsWith('https://') || objectKey.startsWith('data:image/')) {
    return objectKey;
  }
  return `/api/storage/view?key=${encodeURIComponent(objectKey)}`;
}

/**
 * Membaca stream / redirect foto
 */
async function streamFoto(objectKey, res) {
  if (!objectKey) return res.status(404).send('Foto tidak ditemukan');

  if (objectKey.startsWith('http://') || objectKey.startsWith('https://')) {
    return res.redirect(objectKey);
  }

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
  if (!objectKey) return;
  if (objectKey.includes('/storage/v1/object/public/absensi-foto/')) {
    const relativeKey = objectKey.split('/storage/v1/object/public/absensi-foto/')[1];
    if (relativeKey) await supabase.storage.from('absensi-foto').remove([relativeKey]).catch(() => {});
  }
}

module.exports = { uploadFoto, getUrlFoto, hapusFoto, streamFoto };
