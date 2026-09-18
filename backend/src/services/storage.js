const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const BUCKET = 'absensi-foto';
let supabase = null;
const DEFAULT_UPLOAD_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

function getSupabase() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib dikonfigurasi');
  }
  supabase = createClient(url, key);
  return supabase;
}

function extractObjectKey(value) {
  const raw = String(value || '');
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  if (raw.includes(marker)) return decodeURIComponent(raw.split(marker)[1]);
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:image/')) return null;
  return raw.replace(/^\/+/, '');
}

function isRetryableStorageError(error) {
  const status = Number(error?.statusCode || error?.status || 0);
  if (status === 408 || status === 409 || status === 425 || status === 429 || status >= 500) return true;
  return /timeout|timed out|network|fetch|socket|connection|econnreset|temporar/i.test(String(error?.message || error || ''));
}

async function uploadWithRetry(operation, {
  attempts = DEFAULT_UPLOAD_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation();
      if (result?.error || !result?.data) {
        throw result?.error || new Error('Respons penyimpanan kosong');
      }
      return result.data;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableStorageError(error)) break;
      await sleep(retryDelayMs * (2 ** (attempt - 1)));
    }
  }
  throw lastError || new Error('Upload penyimpanan gagal');
}

async function uploadFoto(buffer, { userId, jenis }) {
  if (!buffer || buffer.length === 0) return null;

  // Key dibuat sekali dan digunakan ulang pada setiap retry. Upsert membuat
  // respons yang hilang setelah upload tidak menghasilkan objek duplikat.
  const objectKey = `absensi/${userId}/${Date.now()}-${crypto.randomUUID()}-${jenis}.jpg`;
  const client = getSupabase();
  try {
    await uploadWithRetry(() => client.storage.from(BUCKET).upload(objectKey, buffer, {
      contentType: 'image/jpeg',
      upsert: true,
    }));
  } catch (cause) {
    // Best effort: bila server storage sebenarnya menerima upload tetapi
    // responsnya terputus, jangan biarkan objek tanpa record absensi.
    try {
      await client.storage.from(BUCKET).remove([objectKey]);
    } catch (_) {}
    const error = new Error('Penyimpanan foto sedang tidak tersedia. Periksa koneksi lalu coba kembali.');
    error.code = 'PHOTO_STORAGE_UPLOAD_FAILED';
    error.statusCode = 503;
    error.cause = cause;
    throw error;
  }

  return client.storage.from(BUCKET).getPublicUrl(objectKey).data.publicUrl;
}

async function getUrlFoto(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith('data:image/')) return value;
  return getSupabase().storage.from(BUCKET).getPublicUrl(extractObjectKey(value)).data.publicUrl;
}

async function streamFoto(value, res) {
  if (!value) return res.status(404).send('Foto tidak ditemukan');
  if (/^https?:\/\//i.test(value)) return res.redirect(value);

  // Kompatibilitas baca untuk record lama; upload baru selalu ke Supabase.
  if (value.startsWith('data:image/')) {
    const imgBuffer = Buffer.from(value.split(',')[1], 'base64');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(imgBuffer);
  }

  const { data, error } = await getSupabase().storage.from(BUCKET).download(extractObjectKey(value));
  if (error || !data) return res.status(404).send('Foto tidak ditemukan');
  const imgBuffer = Buffer.from(await data.arrayBuffer());
  res.setHeader('Content-Type', data.type || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(imgBuffer);
}

async function hapusFoto(value) {
  const objectKey = extractObjectKey(value);
  if (!objectKey) return;
  const { error } = await getSupabase().storage.from(BUCKET).remove([objectKey]);
  if (error) throw new Error(`Hapus foto Supabase gagal: ${error.message}`);
}

module.exports = {
  uploadFoto,
  getUrlFoto,
  hapusFoto,
  streamFoto,
  uploadWithRetry,
  isRetryableStorageError,
};
