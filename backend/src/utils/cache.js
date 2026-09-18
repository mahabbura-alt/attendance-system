/**
 * Cache utilitas sederhana (in-memory, TTL-based) untuk data yang jarang
 * berubah seperti daftar lokasi kantor, shift, dan URL CompreFace.
 *
 * Pada server berkelanjutan (Render/Railway/VPS) cache ini hidup di memori
 * proses dan efektif. Design sengaja dibuat minimal & tanpa dependency
 * eksternal agar tidak menambah beban.
 */

const DEFAULT_TTL_MS = 60 * 1000; // 60 detik

const store = new Map();

/**
 * Ambil nilai dari cache.
 * @returns {*} nilai cache, atau undefined jika tidak ada / kedaluwarsa
 */
function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }

  return entry.value;
}

/**
 * Simpan nilai ke cache dengan TTL (ms).
 */
function cacheSet(key, value, ttlMs = DEFAULT_TTL_MS) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Hapus satu key (untuk invalidasi saat data berubah).
 */
function cacheDel(key) {
  store.delete(key);
}

/**
 * Seragamkan pattern key untuk daftar lokasi agar mudah di-invalidate.
 */
const LOCATIONS_KEY = 'locations:all';

module.exports = { cacheGet, cacheSet, cacheDel, LOCATIONS_KEY };
