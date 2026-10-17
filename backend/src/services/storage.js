const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const BUCKET = 'absensi-foto';
// Dokumen karyawan (CV, sertifikat kompetensi, ...) — bucket privat terpisah,
// tidak pernah dilayani lewat /api/storage/view (publik).
const DOC_BUCKET = 'people-dokumen';
const DOC_KEY_PREFIX = 'people/';
let supabase = null;
const DEFAULT_UPLOAD_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

function storageProvider() {
  return String(process.env.STORAGE_PROVIDER || 'supabase').trim().toLowerCase();
}

function localBucketRoot(bucket = BUCKET) {
  return path.resolve(process.env.STORAGE_LOCAL_ROOT || '/data/storage', bucket);
}

function localObjectPath(objectKey, bucket = BUCKET) {
  const root = localBucketRoot(bucket);
  const resolved = path.resolve(root, String(objectKey || '').replace(/^[/\\]+/, ''));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error('Object key storage tidak valid');
    error.statusCode = 400;
    throw error;
  }
  return resolved;
}

function localPublicUrl(objectKey) {
  const baseUrl = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return `${baseUrl}/api/storage/view?key=${encodeURIComponent(objectKey)}`;
}

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
  if (storageProvider() === 'local') {
    const filePath = localObjectPath(objectKey);
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.writeFile(tempPath, buffer, { flag: 'wx' });
      await fs.rename(tempPath, filePath);
    } catch (cause) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      const error = new Error('Penyimpanan foto sedang tidak tersedia. Periksa koneksi lalu coba kembali.');
      error.code = 'PHOTO_STORAGE_UPLOAD_FAILED';
      error.statusCode = 503;
      error.cause = cause;
      throw error;
    }
    return objectKey;
  }

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
  if (value.startsWith('data:image/')) return value;
  const objectKey = extractObjectKey(value);
  if (storageProvider() === 'local' && objectKey) return localPublicUrl(objectKey);
  if (/^https?:\/\//i.test(value)) return value;
  return getSupabase().storage.from(BUCKET).getPublicUrl(objectKey).data.publicUrl;
}

function isDocumentKey(value) {
  return String(value || '').replace(/^[/\\]+/, '').startsWith(DOC_KEY_PREFIX);
}

async function streamFoto(value, res) {
  if (!value) return res.status(404).send('Foto tidak ditemukan');
  // Dokumen karyawan hanya boleh dibaca lewat endpoint dokumen yang terautentikasi.
  if (isDocumentKey(value)) return res.status(404).send('Foto tidak ditemukan');
  const objectKey = extractObjectKey(value);
  if (storageProvider() === 'local' && objectKey) {
    const filePath = localObjectPath(objectKey);
    try {
      await fs.access(filePath);
    } catch (_) {
      return res.status(404).send('Foto tidak ditemukan');
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.sendFile(filePath);
  }
  if (/^https?:\/\//i.test(value)) return res.redirect(value);

  // Kompatibilitas baca untuk record lama; upload baru selalu ke Supabase.
  if (value.startsWith('data:image/')) {
    const imgBuffer = Buffer.from(value.split(',')[1], 'base64');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(imgBuffer);
  }

  const { data, error } = await getSupabase().storage.from(BUCKET).download(objectKey);
  if (error || !data) return res.status(404).send('Foto tidak ditemukan');
  const imgBuffer = Buffer.from(await data.arrayBuffer());
  res.setHeader('Content-Type', data.type || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(imgBuffer);
}

async function hapusFoto(value) {
  const objectKey = extractObjectKey(value);
  if (!objectKey) return;
  if (storageProvider() === 'local') {
    await fs.rm(localObjectPath(objectKey), { force: true });
    return;
  }
  const { error } = await getSupabase().storage.from(BUCKET).remove([objectKey]);
  if (error) throw new Error(`Hapus foto Supabase gagal: ${error.message}`);
}

function storageUnavailable(cause) {
  const error = new Error('Penyimpanan dokumen sedang tidak tersedia. Coba kembali beberapa saat lagi.');
  error.code = 'DOCUMENT_STORAGE_FAILED';
  error.statusCode = 503;
  error.cause = cause;
  return error;
}

/** Simpan PDF dokumen karyawan; mengembalikan object key (bukan URL publik). */
async function uploadDocument(buffer, { profileId, docType }) {
  if (!buffer || buffer.length === 0) throw Object.assign(new Error('File kosong'), { statusCode: 400 });
  const safeType = String(docType || 'OTHER').replace(/[^A-Z_]/g, '') || 'OTHER';
  const objectKey = `${DOC_KEY_PREFIX}${profileId}/${Date.now()}-${crypto.randomUUID()}-${safeType.toLowerCase()}.pdf`;
  if (storageProvider() === 'local') {
    const filePath = localObjectPath(objectKey, DOC_BUCKET);
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.writeFile(tempPath, buffer, { flag: 'wx' });
      await fs.rename(tempPath, filePath);
    } catch (cause) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw storageUnavailable(cause);
    }
    return objectKey;
  }
  const client = getSupabase();
  try {
    await uploadWithRetry(() => client.storage.from(DOC_BUCKET).upload(objectKey, buffer, {
      contentType: 'application/pdf', upsert: true,
    }));
  } catch (cause) {
    try { await client.storage.from(DOC_BUCKET).remove([objectKey]); } catch (_) {}
    throw storageUnavailable(cause);
  }
  return objectKey;
}

/** Baca dokumen sebagai Buffer (null bila tidak ada). */
async function readDocument(objectKey) {
  if (!isDocumentKey(objectKey)) return null;
  const key = String(objectKey).replace(/^[/\\]+/, '');
  if (storageProvider() === 'local') {
    try { return await fs.readFile(localObjectPath(key, DOC_BUCKET)); } catch (_) { return null; }
  }
  const { data, error } = await getSupabase().storage.from(DOC_BUCKET).download(key);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function removeDocument(objectKey) {
  if (!isDocumentKey(objectKey)) return;
  const key = String(objectKey).replace(/^[/\\]+/, '');
  if (storageProvider() === 'local') {
    await fs.rm(localObjectPath(key, DOC_BUCKET), { force: true });
    return;
  }
  await getSupabase().storage.from(DOC_BUCKET).remove([key]);
}

// Bukti Fuel (foto meter, DO, segel, ...) — bucket privat terpisah. Root lokalnya
// berbeda dari absensi-foto sehingga tidak terjangkau /api/storage/view (publik);
// dibaca hanya lewat endpoint fuel-evidence yang terautentikasi.
const EVIDENCE_BUCKET = 'fuel-bukti';
const EVIDENCE_KEY_PREFIX = 'fuel/';

function evidenceKey(objectKey) {
  const key = String(objectKey || '').replace(/^[/\\]+/, '');
  if (!key.startsWith(EVIDENCE_KEY_PREFIX)) {
    throw Object.assign(new Error('Object key bukti Fuel tidak valid'), { statusCode: 400 });
  }
  return key;
}

/** Simpan objek bukti; key ditentukan pemanggil (deterministik → retry aman). */
async function putEvidenceObject(objectKey, buffer, contentType) {
  const key = evidenceKey(objectKey);
  if (!buffer || buffer.length === 0) throw Object.assign(new Error('File kosong'), { statusCode: 400 });
  if (storageProvider() === 'local') {
    const filePath = localObjectPath(key, EVIDENCE_BUCKET);
    const tempPath = `${filePath}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    try {
      await fs.writeFile(tempPath, buffer, { flag: 'wx' });
      await fs.rename(tempPath, filePath);
    } catch (cause) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw storageUnavailable(cause);
    }
    return key;
  }
  const client = getSupabase();
  try {
    await uploadWithRetry(() => client.storage.from(EVIDENCE_BUCKET).upload(key, buffer, { contentType, upsert: true }));
  } catch (cause) {
    throw storageUnavailable(cause);
  }
  return key;
}

/** Baca objek bukti sebagai Buffer (null bila tidak ada). */
async function readEvidenceObject(objectKey) {
  const key = evidenceKey(objectKey);
  if (storageProvider() === 'local') {
    try { return await fs.readFile(localObjectPath(key, EVIDENCE_BUCKET)); } catch (_) { return null; }
  }
  const { data, error } = await getSupabase().storage.from(EVIDENCE_BUCKET).download(key);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Path lokal objek bukti (hanya provider local; untuk skrip rekonsiliasi). */
function localEvidencePath(objectKey) {
  return localObjectPath(evidenceKey(objectKey), EVIDENCE_BUCKET);
}

module.exports = {
  EVIDENCE_BUCKET,
  EVIDENCE_KEY_PREFIX,
  putEvidenceObject,
  readEvidenceObject,
  localEvidencePath,
  localBucketRoot,
  storageProvider,
  uploadDocument,
  readDocument,
  removeDocument,
  isDocumentKey,
  uploadFoto,
  getUrlFoto,
  hapusFoto,
  streamFoto,
  uploadWithRetry,
  isRetryableStorageError,
};
