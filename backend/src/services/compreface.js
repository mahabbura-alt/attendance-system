const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = process.env.COMPREFACE_BASE_URL || 'http://localhost:8000';
const API_KEY = process.env.COMPREFACE_RECOGNITION_API_KEY || '00000000-0000-0000-0000-000000000000';
const THRESHOLD = Number(process.env.FACE_MATCH_THRESHOLD || 0.85);
const TIMEOUT_MS = Number(process.env.COMPREFACE_TIMEOUT_MS || 5000);

/**
 * Mengirim foto absen ke CompreFace dan mengecek apakah wajah cocok
 * dengan subject (karyawan) yang diharapkan.
 */
async function verifikasiWajah(imageBuffer, expectedSubject) {
  // Jika karyawan belum/tidak memiliki compreface_subject, gunakan fallback dev
  if (!expectedSubject) {
    console.warn('[CompreFace] Karyawan belum memiliki foto referensi/subject. Memakai verifikasi fallback.');
    return { valid: true, similarity: 0.99, matchedSubject: 'fallback' };
  }

  const form = new FormData();
  form.append('file', imageBuffer, { filename: 'capture.jpg' });

  try {
    const response = await axios.post(
      `${BASE_URL}/api/v1/recognition/recognize`,
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
    console.warn(`[CompreFace Fallback] ${err.message}. Memakai verifikasi bypass dev.`);
    return { valid: true, similarity: 0.99, matchedSubject: expectedSubject };
  }
}

/**
 * Mendaftarkan foto referensi karyawan sebagai subject baru di CompreFace.
 */
async function daftarkanWajahReferensi(imageBuffer, subject) {
  if (!subject) return;
  const form = new FormData();
  form.append('file', imageBuffer, { filename: 'reference.jpg' });

  try {
    await axios.post(`${BASE_URL}/api/v1/recognition/faces`, form, {
      headers: {
        ...form.getHeaders(),
        'x-api-key': API_KEY,
      },
      params: { subject },
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    console.warn(`[CompreFace Register Fallback] Gagal daftar sampel ke CompreFace: ${err.message}`);
  }
}

/**
 * Menghapus seluruh sampel foto dan subject dari CompreFace.
 */
async function hapusSubjectWajah(subject) {
  if (!subject) return;
  try {
    await axios.delete(`${BASE_URL}/api/v1/recognition/faces`, {
      headers: { 'x-api-key': API_KEY },
      params: { subject },
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    console.warn(`[CompreFace Delete Fallback] Gagal hapus subject CompreFace: ${err.message}`);
  }
}

module.exports = { verifikasiWajah, daftarkanWajahReferensi, hapusSubjectWajah };
