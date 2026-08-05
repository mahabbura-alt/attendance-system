/**
 * Comprehensive Vercel Cloud API Endpoint Audit Script
 */
const axios = require('axios');

const BASE_URL = 'https://attendance-system-eta-opal.vercel.app';

async function audit() {
  console.log(`🌐 [VERCEL AUDIT] Testing live endpoints at ${BASE_URL}...\n`);

  let token = null;

  // 1. Health
  try {
    const res = await axios.get(`${BASE_URL}/health`);
    console.log(`✅ [GET /health] Status: ${res.status} ->`, res.data);
  } catch (e) {
    console.error(`❌ [GET /health] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  // 2. Opsi Pendaftaran
  try {
    const res = await axios.get(`${BASE_URL}/api/auth/opsi-pendaftaran`);
    console.log(`✅ [GET /api/auth/opsi-pendaftaran] Status: ${res.status} -> Shifts: ${res.data.shifts?.length}`);
  } catch (e) {
    console.error(`❌ [GET /api/auth/opsi-pendaftaran] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  // 3. Login Admin
  try {
    const res = await axios.post(`${BASE_URL}/api/auth/login`, { email: 'admin@perusahaan.com', password: 'admin123' });
    token = res.data.token;
    console.log(`✅ [POST /api/auth/login] Status: ${res.status} -> Token: ${token.substring(0, 20)}...`);
  } catch (e) {
    console.error(`❌ [POST /api/auth/login] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  if (!token) return;

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  // 4. Admin Me
  try {
    const res = await axios.get(`${BASE_URL}/api/admin/me`, authHeaders);
    console.log(`✅ [GET /api/admin/me] Status: ${res.status} -> Admin: ${res.data.nama}`);
  } catch (e) {
    console.error(`❌ [GET /api/admin/me] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  // 5. Lokasi Kantor
  try {
    const res = await axios.get(`${BASE_URL}/api/absensi/lokasi-kantor`, authHeaders);
    console.log(`✅ [GET /api/absensi/lokasi-kantor] Status: ${res.status} -> Lokasi: ${res.data.lokasi?.nama_lokasi}`);
  } catch (e) {
    console.error(`❌ [GET /api/absensi/lokasi-kantor] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  // 6. Admin Absensi List
  try {
    const res = await axios.get(`${BASE_URL}/api/admin/absensi`, authHeaders);
    console.log(`✅ [GET /api/admin/absensi] Status: ${res.status} -> Data: ${res.data.data?.length || res.data.length} items`);
  } catch (e) {
    console.error(`❌ [GET /api/admin/absensi] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  // 7. Admin Karyawan List
  try {
    const res = await axios.get(`${BASE_URL}/api/admin/karyawan`, authHeaders);
    console.log(`✅ [GET /api/admin/karyawan] Status: ${res.status} -> Data: ${res.data.length} items`);
  } catch (e) {
    console.error(`❌ [GET /api/admin/karyawan] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  // 8. Admin Registrasi Pending List
  try {
    const res = await axios.get(`${BASE_URL}/api/admin/registrasi-pending`, authHeaders);
    console.log(`✅ [GET /api/admin/registrasi-pending] Status: ${res.status} -> Pending: ${res.data.length} items`);
  } catch (e) {
    console.error(`❌ [GET /api/admin/registrasi-pending] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  // 9. Admin Payroll List
  try {
    const res = await axios.get(`${BASE_URL}/api/admin/payroll`, authHeaders);
    console.log(`✅ [GET /api/admin/payroll] Status: ${res.status} -> Items: ${res.data.length}`);
  } catch (e) {
    console.error(`❌ [GET /api/admin/payroll] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  // 10. Admin HM List
  try {
    const res = await axios.get(`${BASE_URL}/api/admin/hm`, authHeaders);
    console.log(`✅ [GET /api/admin/hm] Status: ${res.status} -> Items: ${res.data.length}`);
  } catch (e) {
    console.error(`❌ [GET /api/admin/hm] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  // 11. Admin Rekap Performa
  try {
    const res = await axios.get(`${BASE_URL}/api/admin/rekap-performa?periode=bulanan`, authHeaders);
    console.log(`✅ [GET /api/admin/rekap-performa] Status: ${res.status} -> Data: ${res.data.data?.length || res.data.length} items`);
  } catch (e) {
    console.error(`❌ [GET /api/admin/rekap-performa] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  // 12. Admin Kalkulasi Payroll
  try {
    const res = await axios.get(`${BASE_URL}/api/admin/kalkulasi-payroll?bulan=8&tahun=2026`, authHeaders);
    console.log(`✅ [GET /api/admin/kalkulasi-payroll] Status: ${res.status} -> Total Karyawan: ${res.data.ringkasan?.total_karyawan}`);
  } catch (e) {
    console.error(`❌ [GET /api/admin/kalkulasi-payroll] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  // 13. Admin Sinkron Karyawan Payroll
  try {
    const res = await axios.post(`${BASE_URL}/api/admin/payroll/sinkron`, {}, authHeaders);
    console.log(`✅ [POST /api/admin/payroll/sinkron] Status: ${res.status} -> Inserted: ${res.data.inserted}, Updated: ${res.data.updated}`);
  } catch (e) {
    console.error(`❌ [POST /api/admin/payroll/sinkron] Failed: ${e.response?.status || e.message}`, e.response?.data || '');
  }

  console.log('\n🏁 [AUDIT COMPLETE]');
}

audit();
