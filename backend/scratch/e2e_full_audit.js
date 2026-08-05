require('dotenv').config({ path: 'D:/OneDrive/Desktop/PROJECT/backend/.env' });
const { pool } = require('D:/OneDrive/Desktop/PROJECT/backend/src/config/db');
const { hitungSlip, generatePdfBuffer, encryptPdf } = require('D:/OneDrive/Desktop/PROJECT/backend/src/controllers/slipGajiController');
const { hitungKalkulasiPayroll } = require('D:/OneDrive/Desktop/PROJECT/backend/src/controllers/kalkulasiPayrollController');

async function runAuditTrial() {
  console.log('===========================================================');
  console.log('🧪 MEMULAI TRIAL INSPEKSI & END-TO-END AUDIT SISTEM');
  console.log('===========================================================\n');

  let passedTests = 0;
  let failedTests = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      if (details) console.log(`   └─ ${details}`);
      passedTests++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (details) console.error(`   └─ ERROR: ${details}`);
      failedTests++;
    }
  }

  const client = await pool.connect();
  try {
    // -------------------------------------------------------------
    // SETUP TEST DATA: Lokasi, Shift, Dummy Karyawan
    // -------------------------------------------------------------
    console.log('📌 1. MENYIAPKAN DATA DUMMY TEST...');
    
    // Get default lokasi & shift
    const lokRes = await client.query('SELECT id, latitude, longitude, radius_meter FROM lokasi_kantor LIMIT 1');
    const shiftRes = await client.query('SELECT id FROM shifts LIMIT 1');
    assert(lokRes.rows.length > 0, 'Menemukan titik lokasi kantor aktif');
    assert(shiftRes.rows.length > 0, 'Menemukan data shift aktif');

    const lokasiId = lokRes.rows[0].id;
    const shiftId = shiftRes.rows[0].id;
    const centerLat = parseFloat(lokRes.rows[0].latitude);
    const centerLng = parseFloat(lokRes.rows[0].longitude);

    // Clean up old dummy test accounts if exist
    await client.query("DELETE FROM audit_log WHERE alasan LIKE '%DUMMY_TEST%'");
    await client.query("DELETE FROM keterangan_presensi WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%dummy_test%')");
    await client.query("DELETE FROM absensi WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%dummy_test%')");
    await client.query("DELETE FROM payroll WHERE employee_id LIKE 'DUMMY-%'");
    await client.query("DELETE FROM users WHERE email LIKE '%dummy_test%'");

    // Create Dummy User 1: Karyawan Lama (Staff) - Gaji Pokok 13.000.000, TK Harian 50.000
    const user1Res = await client.query(`
      INSERT INTO users (employee_id, nama, email, password_hash, role, jabatan, departemen, shift_id, lokasi_kantor_id, is_active)
      VALUES ('DUMMY-001', 'Dummy Staff Lama', 'dummy_test_staff@test.com', 'hash123', 'karyawan', 'Staff HR', 'HRD', $1, $2, true)
      RETURNING id
    `, [shiftId, lokasiId]);
    const user1Id = user1Res.rows[0].id;

    await client.query(`
      INSERT INTO payroll (employee_id, nama_karyawan, date_in, site, kota, jabatan, gaji_pokok, tunjangan_kehadiran_per_hari, tunjangan_jabatan)
      VALUES ('DUMMY-001', 'Dummy Staff Lama', '2025-01-10', 'BEI Jambi', 'Jambi', 'Staff HR', 13000000, 50000, 1000000)
    `);

    // Create Dummy User 2: Operator HM (Operator Excavator) - Gaji Pokok 15.000.000
    const user2Res = await client.query(`
      INSERT INTO users (employee_id, nama, email, password_hash, role, jabatan, departemen, shift_id, lokasi_kantor_id, is_active)
      VALUES ('DUMMY-002', 'Dummy Operator HM', 'dummy_test_operator@test.com', 'hash123', 'karyawan', 'Operator Excavator', 'Produksi', $1, $2, true)
      RETURNING id
    `, [shiftId, lokasiId]);
    const user2Id = user2Res.rows[0].id;

    await client.query(`
      INSERT INTO payroll (employee_id, nama_karyawan, date_in, site, kota, jabatan, gaji_pokok, tunjangan_kehadiran_per_hari, insentif_hm_per_jam)
      VALUES ('DUMMY-002', 'Dummy Operator HM', '2025-01-10', 'BEI Jambi', 'Jambi', 'Operator Excavator', 15000000, 50000, 35000)
    `);

    // Create Dummy User 3: Karyawan Baru Prorate (Masa kerja < 1 bln, masuk 20 Juli 2026)
    const user3Res = await client.query(`
      INSERT INTO users (employee_id, nama, email, password_hash, role, jabatan, departemen, shift_id, lokasi_kantor_id, is_active)
      VALUES ('DUMMY-003', 'Dummy Karyawan Baru', 'dummy_test_baru@test.com', 'hash123', 'karyawan', 'Staff Engineering', 'Engineering', $1, $2, true)
      RETURNING id
    `, [shiftId, lokasiId]);
    const user3Id = user3Res.rows[0].id;

    await client.query(`
      INSERT INTO payroll (employee_id, nama_karyawan, date_in, site, kota, jabatan, gaji_pokok, tunjangan_kehadiran_per_hari)
      VALUES ('DUMMY-003', 'Dummy Karyawan Baru', '20-07-2026', 'BEI Jambi', 'Jambi', 'Staff Engineering', 26000000, 100000)
    `);

    console.log('   └─ Akun dummy test berhasil disiapkan.');

    // -------------------------------------------------------------
    // TEST CASE 1: Validasi Skema Deduksi (Alpa + Izin dipotong, Sakit/Cuti/Off bebas potongan)
    // -------------------------------------------------------------
    console.log('\n📌 2. TESTING ATURAN DEDUKSI PAYROLL (Pembagi 26 Hari)...');
    
    // User 1: Memiliki 1 Alpa, 1 Izin, 1 Sakit, 1 Cuti, 1 Off pada bulan Juli 2026 (periode cutoff 26 Juni - 25 Juli)
    await client.query(`
      INSERT INTO keterangan_presensi (user_id, tanggal, kategori, catatan) VALUES
      ($1, '2026-07-01', 'alpa', 'Mangkir tanpa keterangan'),
      ($1, '2026-07-02', 'izin', 'Izin urusan keluarga'),
      ($1, '2026-07-03', 'sakit', 'Sakit flu dengan surat dokter'),
      ($1, '2026-07-04', 'cuti', 'Hak Cuti tahunan'),
      ($1, '2026-07-05', 'off', 'Libur shift')
    `, [user1Id]);

    const slip1 = await hitungSlip(user1Id, 7, 2026);

    // Ekspektasi:
    // Total Hari Deduksi = 2 Hari (1 Alpa + 1 Izin). Sakit, Cuti, Off TIDAK dihitung deduksi!
    // Potongan Deduksi = (13.000.000 / 26) * 2 = 1.000.000
    assert(slip1.hari_alpa === 1, 'Total Hari Alpa terhitung 1');
    assert(slip1.hari_izin === 1, 'Total Hari Izin terhitung 1');
    assert(slip1.hari_sakit === 1, 'Total Hari Sakit terhitung 1');
    assert(slip1.total_hari_deduksi === 2, 'Total Hari Deduksi murni Alpa + Izin (2 Hari)', `Dapat: ${slip1.total_hari_deduksi}`);
    assert(slip1.potongan_deduksi === 1000000, 'Potongan Deduksi persis Rp 1.000.000 ((13jt / 26) * 2)', `Dapat: Rp ${slip1.potongan_deduksi}`);

    // -------------------------------------------------------------
    // TEST CASE 2: Validasi Prorate Karyawan Baru (Masa Kerja < 1 Bulan)
    // -------------------------------------------------------------
    console.log('\n📌 3. TESTING PRORATE KARYAWAN BARU (Join 20 Juli 2026)...');

    // User 3 (Gaji Pokok 26.000.000): Join 20 Juli 2026, Cutoff 25 Juli 2026 -> 6 Hari Masa Kerja
    // Tambahkan 1 Mangkir / Alpa di tanggal 22 Juli 2026
    await client.query(`
      INSERT INTO keterangan_presensi (user_id, tanggal, kategori, catatan) VALUES
      ($1, '2026-07-22', 'alpa', 'Mangkir tanggal 22 Juli')
    `, [user3Id]);

    const slip3 = await hitungSlip(user3Id, 7, 2026);

    // Ekspektasi:
    // is_prorate_masa_kerja = true
    // Gaji Pokok Prorate 6 Hari = (26.000.000 / 26) * 6 = 6.000.000
    // Potongan Absen 1 Hari = (26.000.000 / 26) * 1 = 1.000.000
    // Gaji Pokok Net = 6.000.000 - 1.000.000 = 5.000.000
    assert(slip3.is_prorate_masa_kerja === true, 'Sistem mendeteksi masa kerja < 1 bulan');
    assert(slip3.gp_final === 6000000, 'Gaji Pokok Prorate Masa Kerja (6 Hari) = Rp 6.000.000', `Dapat: Rp ${slip3.gp_final}`);
    assert(slip3.potongan_deduksi === 1000000, 'Potongan Deduksi Alpa (1 Hari) = Rp 1.000.000', `Dapat: Rp ${slip3.potongan_deduksi}`);

    // -------------------------------------------------------------
    // TEST CASE 3: Testing Insentif HM (Hours Meter) Operator & Driver
    // -------------------------------------------------------------
    console.log('\n📌 4. TESTING INSENTIF HM OPERATOR & DRIVER...');

    // User 2: Operator HM dengan Insentif HM Rp 35.000 / Jam
    // Catat log HM untuk user 2 di bulan Juli 2026: Total 100 Jam
    await client.query(`
      INSERT INTO database_hm (user_id, employee_id, nama_karyawan, tanggal, kode_unit, hm_awal, hm_akhir) VALUES
      ($1, 'DUMMY-002', 'Dummy Operator HM', '2026-07-10', 'EXCA-01', 1000.0, 1050.0),
      ($1, 'DUMMY-002', 'Dummy Operator HM', '2026-07-11', 'EXCA-01', 1050.0, 1100.0)
    `, [user2Id]);

    const slip2 = await hitungSlip(user2Id, 7, 2026);

    // Ekspektasi:
    // total_hm = 100.0 Jam
    // ins_hm_total = 100 * 35.000 = 3.500.000
    assert(slip2.is_opdrv === true, 'Mendeteksi jabatan Operator/Driver');
    assert(parseFloat(slip2.total_hm) === 100.0, 'Total HM terakumulasi 100 Jam', `Dapat: ${slip2.total_hm} Jam`);
    assert(slip2.ins_hm_total === 3500000, 'Insentif HM persis Rp 3.500.000 (100 Jam x 35.000)', `Dapat: Rp ${slip2.ins_hm_total}`);

    // -------------------------------------------------------------
    // TEST CASE 4: Validasi Pembuatan & Enkripsi PDF Slip Gaji
    // -------------------------------------------------------------
    console.log('\n📌 5. TESTING PERFORMA ENKRIPSI & GENERATOR PDF...');

    const rawPdfBuf = await generatePdfBuffer(slip1);
    assert(Buffer.isBuffer(rawPdfBuf) && rawPdfBuf.length > 1000, 'PDF Buffer mentah berhasil di-generate', `Ukuran: ${rawPdfBuf.length} bytes`);

    const encryptedPdfBuf = await encryptPdf(rawPdfBuf, 'password123');
    assert(Buffer.isBuffer(encryptedPdfBuf) && encryptedPdfBuf.length > 1000, 'PDF terenkripsi password berhasil dibuat', `Ukuran: ${encryptedPdfBuf.length} bytes`);

    // -------------------------------------------------------------
    // TEST CASE 5: Testing Audit Log Tracking System
    // -------------------------------------------------------------
    console.log('\n📌 6. TESTING TRACKING AUDIT LOG SYSTEM...');

    const logMessage = 'DUMMY_TEST - Memperbarui data karyawan dummy test';
    await client.query(`
      INSERT INTO audit_log (admin_id, absensi_id, alasan, data_sesudah)
      VALUES ($1, NULL, $2, $3)
    `, [user1Id, logMessage, JSON.stringify({ nama: 'Dummy Staff', status: 'Updated' })]);

    const auditCheck = await client.query("SELECT * FROM audit_log WHERE alasan LIKE '%DUMMY_TEST%'");
    assert(auditCheck.rows.length > 0, 'Audit log berhasil tercatat di database');

    // -------------------------------------------------------------
    // CLEANUP TEST DATA
    // -------------------------------------------------------------
    console.log('\n📌 7. PEMBERSIHAN DATA DUMMY TEST...');
    await client.query("DELETE FROM audit_log WHERE alasan LIKE '%DUMMY_TEST%'");
    await client.query("DELETE FROM keterangan_presensi WHERE user_id IN ($1, $2, $3)", [user1Id, user2Id, user3Id]);
    await client.query("DELETE FROM database_hm WHERE user_id = $1", [user2Id]);
    await client.query("DELETE FROM payroll WHERE employee_id LIKE 'DUMMY-%'");
    await client.query("DELETE FROM users WHERE email LIKE '%dummy_test%'");
    console.log('   └─ Seluruh data dummy test telah dibersihkan tanpa menyisakan sampah.');

  } catch (err) {
    console.error('Fatal Error during Audit Trial:', err);
    failedTests++;
  } finally {
    client.release();
  }

  console.log('\n===========================================================');
  console.log(`📊 HASIL EVALUASI AUDIT SISTEM:`);
  console.log(`   ✅ TOTAL TEST PASSED : ${passedTests}`);
  console.log(`   ❌ TOTAL TEST FAILED : ${failedTests}`);
  console.log('===========================================================');

  process.exit(failedTests > 0 ? 1 : 0);
}

runAuditTrial();
