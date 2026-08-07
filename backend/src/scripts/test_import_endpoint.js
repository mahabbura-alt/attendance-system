/**
 * Test POST /api/admin/payroll/import with real valid Excel workbook
 */
const axios = require('axios');
const FormData = require('form-data');
const xlsx = require('xlsx');

const BASE_URL = 'https://attendance-system-eta-opal.vercel.app';

async function testRealImport() {
  try {
    console.log('1️⃣ Logging in as admin...');
    const loginRes = await axios.post(`${BASE_URL}/api/auth/login`, {
      email: 'admin@perusahaan.com',
      password: 'admin123',
    });
    const token = loginRes.data.token;
    console.log('   ✅ Logged in successfully.');

    console.log('2️⃣ Creating valid Excel workbook buffer...');
    const wb = xlsx.utils.book_new();
    const wsData = [
      ['EMPLOYEE ID', 'Nama Karyawan', 'Date in', 'Site', 'Kota', 'JABATAN', 'GAJI POKOK', 'Tunjangan Kehadiran/Hari', 'Tunjangan Jabatan', 'Insentif HM / JAM'],
      ['EMP001', 'Budi SampelFoto', '2025-01-01', 'Site A', 'Jakarta', 'Operator', 5000000, 50000, 500000, 25000],
      ['EMP002', 'Sorreh', '2025-02-01', 'Site B', 'Bandung', 'Driver DT', 4500000, 45000, 400000, 20000],
    ];
    const ws = xlsx.utils.aoa_to_sheet(wsData);
    xlsx.utils.book_append_sheet(wb, ws, 'Data Base');
    const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    console.log('3️⃣ Uploading valid Excel file to Vercel Cloud endpoint...');
    const form = new FormData();
    form.append('excel', excelBuffer, { filename: 'DATABASE PAYROLL.xlsx' });

    const res = await axios.post(`${BASE_URL}/api/admin/payroll/import`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${token}`,
      },
    });

    console.log('🎉 Status Code:', res.status);
    console.log('🎉 Response:', res.data);
  } catch (err) {
    console.error('❌ Error:', err.response?.data || err.message);
  }
}

testRealImport();
