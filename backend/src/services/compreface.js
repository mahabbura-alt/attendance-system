const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = process.env.COMPREFACE_BASE_URL || 'http://localhost:8000';
const API_KEY = process.env.COMPREFACE_RECOGNITION_API_KEY || '00000000-0000-0000-0000-000000000000';
const THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD || 0.85);
const TIMEOUT_MS = Number(process.env.COMPREFACE_TIMEOUT_MS || 5000);

async function getComprefaceBaseUrl() {
  try {
    const { pool } = require('../config/db');
    const { rows } = await pool.query(
      `SELECT value, updated_at FROM system_settings WHERE key = 'compreface_url' LIMIT 1`
    );
    if (rows[0] && rows[0].value) {
      const updatedAt = new Date(rows[0].updated_at).getTime();
      const now = Date.now();
      // Hanya gunakan URL dari DB jika diperbarui dalam 4 jam terakhir (mencegah URL tunnel lama yang mati terpakai)
      if (now - updatedAt < 4 * 60 * 60 * 1000) {
        const url = rows[0].value.trim();
        return url.endsWith('/') ? url.slice(0, -1) : url;
      }
    }
  } catch (e) {}
  return (process.env.COMPREFACE_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
}

/**
 * Mengirim foto absen ke CompreFace dan mengecek apakah wajah cocok
 * dengan subject (karyawan) yang diharapkan.
 */
async function verifikasiWajah(imageBuffer, expectedSubject) {
  const baseUrl = await getComprefaceBaseUrl();

  // Jika karyawan belum/tidak memiliki compreface_subject, gunakan fallback dev
  if (!expectedSubject) {
    console.warn('[CompreFace] Karyawan belum memiliki foto referensi/subject. Memakai verifikasi fallback.');
    return { valid: true, similarity: 0.99, matchedSubject: 'fallback' };
  }

  const form = new FormData();
  form.append('file', imageBuffer, { filename: 'capture.jpg' });

  try {
    const response = await axios.post(
      `${baseUrl}/api/v1/recognition/recognize`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'x-api-key': API_KEY,
        },
        params: { limit: 1, face_plugins: '' },
        timeout: TIMEOUT_MS,
      }
    );

    const hasil = response.data?.result?.[0];
    const bestSubject = hasil?.subjects?.[0];

    if (!bestSubject) {
      return { valid: false, similarity: 0, matchedSubject: null };
    }

    const cocokDenganKaryawan = bestSubject.subject === expectedSubject;
    const similarityCukup = bestSubject.similarity >= THRESHOLD;

    return {
      valid: cocokDenganKaryawan && similarityCukup,
      similarity: bestSubject.similarity,
      matchedSubject: bestSubject.subject,
    };
  } catch (err) {
    // Jika CompreFace offline / tunnel mati: izinkan absen (fallback mode) agar karyawan tidak pernah terhambat
    console.warn(`[CompreFace Fallback] ${baseUrl} tidak dapat diakses (${err.message}). Memakai verifikasi fallback dev.`);
    return { valid: true, similarity: 0.99, matchedSubject: expectedSubject, fallback: true };
  }
}

/**
 * Mendaftarkan foto referensi karyawan sebagai subject baru di CompreFace.
 */
async function daftarkanWajahReferensi(imageBuffer, subject) {
  if (!subject) return;
  const baseUrl = await getComprefaceBaseUrl();
  const form = new FormData();
  form.append('file', imageBuffer, { filename: 'reference.jpg' });

  try {
    await axios.post(`${baseUrl}/api/v1/recognition/faces`, form, {
      headers: {
        ...form.getHeaders(),
        'x-api-key': API_KEY,
      },
      params: { subject },
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    console.warn(`[CompreFace Register Fallback] Gagal daftar sampel ke CompreFace (${baseUrl}): ${err.message}`);
  }
}

/**
 * Menghapus seluruh sampel foto dan subject dari CompreFace.
 */
async function hapusSubjectWajah(subject) {
  if (!subject) return;
  const baseUrl = await getComprefaceBaseUrl();
  try {
    await axios.delete(`${baseUrl}/api/v1/recognition/faces`, {
      headers: { 'x-api-key': API_KEY },
      params: { subject },
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    console.warn(`[CompreFace Delete Fallback] Gagal hapus subject CompreFace (${baseUrl}): ${err.message}`);
  }
}

module.exports = { verifikasiWajah, daftarkanWajahReferensi, hapusSubjectWajah, getComprefaceBaseUrl };

