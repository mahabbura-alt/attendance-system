const { pool } = require('../config/db');
const { hitungKehadiranPayroll } = require('../services/presensiPayroll');
const { getHmPayrollSummary } = require('../services/hmWorklog');

/**
 * Helper menghitung jumlah hari dalam suatu bulan
 */
function getDaysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/**
 * Helper format Date ke 'YYYY-MM-DD'
 */
function formatDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateIn(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  const str = String(dateStr).trim();
  if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(str)) {
    const parts = str.split(/[-/]/);
    return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
  }
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(str)) {
    const parts = str.split(/[-/]/);
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * GET /api/admin/kalkulasi-payroll
 * Query: bulan (1-12), tahun (YYYY)
 */
async function hitungKalkulasiPayroll(req, res, next) {
  try {
    const now = new Date();
    const bulan = parseInt(req.query.bulan || (now.getMonth() + 1), 10);
    const tahun = parseInt(req.query.tahun || now.getFullYear(), 10);

    const periodKey = `${tahun}-${String(bulan).padStart(2, '0')}`;

    // Tanggal Cutoff (Tgl 26 bulan sebelumnya s/d tgl 25 bulan berjalan)
    const prevMonthDate = new Date(tahun, bulan - 2, 26);
    const currMonthDate = new Date(tahun, bulan - 1, 25);

    const tglMulai = formatDateStr(prevMonthDate);
    const tglAkhir = formatDateStr(currMonthDate);
    const totalHariBulan = getDaysInMonth(tahun, bulan - 1);

    // Ambil/setup payroll_config
    const { rows: configRows } = await pool.query(
      `SELECT * FROM payroll_config WHERE periode_key = $1`,
      [periodKey]
    );

    let config = configRows[0];
    if (!config) {
      config = {
        periode_key: periodKey,
        hari_libur_reguler: 'minggu',
        hari_libur_nasional: '',
      };
    }

    // Parse list hari libur nasional
    const liburNasionalArray = (config.hari_libur_nasional || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Query data karyawan & payroll master
    const { rows: karyawanList } = await pool.query(
      `SELECT
         u.id AS user_id,
         COALESCE(u.employee_id, p.employee_id) AS employee_id,
         u.nama AS nama_karyawan,
         u.jabatan,
         u.created_at AS user_created_at,
         p.id AS payroll_id,
         p.date_in,
         p.site,
         p.kota,
         COALESCE(p.gaji_pokok, 0) AS gaji_pokok_master,
         COALESCE(p.tunjangan_kehadiran_per_hari, 0) AS tunj_kehadiran_per_hari,
         COALESCE(p.tunjangan_jabatan, 0) AS tunj_jabatan_master,
         COALESCE(p.insentif_hm_per_jam, 0) AS insentif_hm_per_jam
       FROM users u
       LEFT JOIN LATERAL (
         SELECT payroll_row.*
         FROM payroll payroll_row
         WHERE (
           u.employee_id IS NOT NULL
           AND LOWER(TRIM(payroll_row.employee_id)) = LOWER(TRIM(u.employee_id))
         ) OR LOWER(TRIM(payroll_row.nama_karyawan)) = LOWER(TRIM(u.nama))
         ORDER BY
           CASE WHEN u.employee_id IS NOT NULL
             AND LOWER(TRIM(payroll_row.employee_id)) = LOWER(TRIM(u.employee_id))
             THEN 0 ELSE 1 END,
           payroll_row.updated_at DESC NULLS LAST
         LIMIT 1
       ) p ON TRUE
       WHERE u.role = 'karyawan' AND u.is_active = TRUE
       ORDER BY u.nama ASC`
    );

    // Iterasi perhitungan per karyawan
    const hasilKalkulasi = await Promise.all(
      karyawanList.map(async (k) => {
        // ------------------------------------------------------------------
        // DATA KEHADIRAN (alpa/izin/sakit/hadir) kini diambil dari komputasi yang
        // IDENTIK dengan tab "Rekap Performa" — berbasis roster S/M + kehadiran
        // kamera + status manual + tanggal pendaftaran akun.
        //
        // SEBELUMNYA payroll hanya membaca baris MANUAL keterangan_presensi yang
        // berkategori alpa/izin sehingga hampir selalu 0 dan karyawan yang tidak
        // masuk beberapa hari tidak pernah kena potongan gaji.
        // ------------------------------------------------------------------
        const kehadiran = await hitungKehadiranPayroll({
          userId: k.user_id,
          mulai: tglMulai,
          akhir: tglAkhir,
          accountCreated: k.user_created_at,
          hariLiburReguler: config.hari_libur_reguler,
          hariLiburNasional: liburNasionalArray,
          tunjKehadiranPerHari: Number(k.tunj_kehadiran_per_hari || 0),
        });

        const hariIzin = kehadiran.hari_izin;
        const hariSakit = kehadiran.hari_sakit;
        const hariAlpa = kehadiran.hari_alpa;
        const hariKerjaActual = kehadiran.hari_kerja_actual;
        const hariKerjaBiasa = kehadiran.hari_kerja_biasa;
        const hariKerjaLibur = kehadiran.hari_kerja_libur;
        const tunjKehadiranTotal = kehadiran.tunj_kehadiran_total;
        const tunjKehadiranPerHari = Number(k.tunj_kehadiran_per_hari || 0);

        // Sakit TIDAK memotong gaji (hanya Alpa + Izin)
        const totalHariDeduksi = hariIzin + hariAlpa;

        // 3. Tentukan Prorate / Deduksi Gaji Pokok (Pembagi baku 26 hari)
        const dateInParsed = parseDateIn(k.date_in || k.user_created_at);
        const tglMulaiDate = parseDateIn(tglMulai);
        const isMasaKerjaBaru = dateInParsed ? (dateInParsed > tglMulaiDate) : false;
        const dateInStr = k.date_in
          || (k.user_created_at ? new Date(k.user_created_at).toISOString().split('T')[0] : tglMulai);

        const gajiPokokMaster = Number(k.gaji_pokok_master || 0);
        const pembagiBaku = 26;

        // Potongan gaji pokok akibat ALPA & IZIN (masing-masing 1/26 gaji pokok)
        let potonganDeduksi = 0;
        if (totalHariDeduksi > 0) {
          potonganDeduksi = Math.round((gajiPokokMaster / pembagiBaku) * totalHariDeduksi);
        }

        let gajiPokokSebelumPotonganAbsen = gajiPokokMaster;
        if (isMasaKerjaBaru && dateInParsed) {
          const dEnd = parseDateIn(tglAkhir);
          const diffTime = dEnd.getTime() - dateInParsed.getTime();
          const totalHariMasaKerja = Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1);
          gajiPokokSebelumPotonganAbsen = Math.round((gajiPokokMaster / pembagiBaku) * totalHariMasaKerja);
        }

        // Gaji pokok yang BENAR-BENAR diberikan = sudah dipotong ALPA/IZIN (tidak < 0)
        const gajiPokokFinal = Math.max(0, gajiPokokSebelumPotonganAbsen - potonganDeduksi);

        // 4. Tunjangan Jabatan
        const tunjJabatan = Number(k.tunj_jabatan_master || 0);

        // 5. Insentif HM (Khusus Operator & Driver)
        const jabatanLower = (k.jabatan || '').toLowerCase();
        const isOperatorDriver =
          jabatanLower.includes('operator') ||
          jabatanLower.includes('driver');

        let totalHm = 0;
        let totalHmSumber = 0;
        let insentifHmTotal = 0;

        if (isOperatorDriver) {
          const hm = await getHmPayrollSummary(pool, k.user_id, tglMulai, tglAkhir);
          totalHm = hm.payable_hm;
          totalHmSumber = hm.source_hm;
          const tarifHm = Number(k.insentif_hm_per_jam || 0);
          insentifHmTotal = Math.round(totalHm * tarifHm);
        }

        // 6. Total Take Home Pay — potongan absen sudah tercermin di gajiPokokFinal
        const takeHomePay = gajiPokokFinal + tunjKehadiranTotal + tunjJabatan + insentifHmTotal;

        return {
          user_id: k.user_id,
          employee_id: k.employee_id || '-',
          nama_karyawan: k.nama_karyawan,
          jabatan: k.jabatan || '-',
          date_in: dateInStr,
          is_prorate: isMasaKerjaBaru || totalHariDeduksi > 0,
          is_prorate_masa_kerja: isMasaKerjaBaru,
          tanggal_buat_akun: kehadiran.tanggal_buat_akun,
          total_hari_kerja_eff_rekap: kehadiran.total_hari_kerja_eff,
          hari_kerja_actual: hariKerjaActual,
          hari_kerja_biasa: hariKerjaBiasa,
          hari_kerja_libur: hariKerjaLibur,
          hari_izin: hariIzin,
          hari_sakit: hariSakit,
          hari_alpa: hariAlpa,
          total_hari_deduksi: totalHariDeduksi,
          potongan_deduksi: potonganDeduksi,
          gaji_pokok_master: gajiPokokMaster,
          gaji_pokok_final: gajiPokokFinal,
          tunj_kehadiran_per_hari: tunjKehadiranPerHari,
          tunj_kehadiran_total: tunjKehadiranTotal,
          tunj_jabatan: tunjJabatan,
          is_operator_driver: isOperatorDriver,
          total_hm_sumber: isOperatorDriver ? Number(totalHmSumber.toFixed(2)) : null,
          total_hm: isOperatorDriver ? Number(totalHm.toFixed(2)) : null,
          insentif_hm_per_jam: isOperatorDriver ? Number(k.insentif_hm_per_jam || 0) : null,
          insentif_hm_total: isOperatorDriver ? insentifHmTotal : null,
          take_home_pay: takeHomePay,
        };
      })
    );

    res.json({
      periode_key: periodKey,
      bulan,
      tahun,
      cutoff_mulai: tglMulai,
      cutoff_akhir: tglAkhir,
      total_hari_bulan: totalHariBulan,
      config,
      ringkasan: {
        total_karyawan: hasilKalkulasi.length,
        sum_gaji_pokok: hasilKalkulasi.reduce((acc, x) => acc + x.gaji_pokok_final, 0),
        sum_tunj_kehadiran: hasilKalkulasi.reduce((acc, x) => acc + x.tunj_kehadiran_total, 0),
        sum_tunj_jabatan: hasilKalkulasi.reduce((acc, x) => acc + x.tunj_jabatan, 0),
        sum_insentif_hm: hasilKalkulasi.reduce((acc, x) => acc + (x.insentif_hm_total || 0), 0),
        total_take_home_pay: hasilKalkulasi.reduce((acc, x) => acc + x.take_home_pay, 0),
      },
      karyawan: hasilKalkulasi,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/admin/kalkulasi-payroll/config
 * body: { periode_key, hari_libur_reguler, hari_libur_nasional, catatan }
 */
async function simpanConfigPayroll(req, res, next) {
  try {
    const { periode_key, hari_libur_reguler, hari_libur_nasional, catatan } = req.body;
    if (!periode_key) return res.status(400).json({ error: 'periode_key wajib diisi (contoh: 2026-08)' });

    const { rows } = await pool.query(
      `INSERT INTO payroll_config (periode_key, hari_libur_reguler, hari_libur_nasional, catatan, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (periode_key)
       DO UPDATE SET
         hari_libur_reguler = EXCLUDED.hari_libur_reguler,
         hari_libur_nasional = EXCLUDED.hari_libur_nasional,
         catatan = EXCLUDED.catatan,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [periode_key, hari_libur_reguler || 'minggu', hari_libur_nasional || '', catatan || null]
    );

    res.json({ message: 'Pengaturan skema payroll berhasil disimpan', config: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { hitungKalkulasiPayroll, simpanConfigPayroll };
