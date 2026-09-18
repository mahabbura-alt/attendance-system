const path = require('path');
const fs = require('fs');
const { pool } = require('../config/db');
const { hitungKehadiranPayroll } = require('../services/presensiPayroll');
const { getHmPayableSum } = require('../services/hmWorklog');
const PDFDocument = require('pdfkit');
const { PDFDocument: LibPDFDoc } = require('pdf-lib');

const LOGO_PATH = path.join(__dirname, '../assets/logo_perusahaan.jpg');
const BULAN_NAMA = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function getDaysInMonth(year, m0) { return new Date(year, m0 + 1, 0).getDate(); }
function fmtD(d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function formatRp(n) { return 'Rp ' + Math.round(n||0).toLocaleString('id-ID'); }

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

async function hitungSlip(userId, bulan, tahun) {
  const periodKey = `${tahun}-${String(bulan).padStart(2, "0")}`;
  const tglMulai = fmtD(new Date(tahun, bulan-2, 26));
  const tglAkhir = fmtD(new Date(tahun, bulan-1, 25));
  const totalHariBulan = getDaysInMonth(tahun, bulan-1);

  // Ambil config periode utk hari libur reguler & nasional
  const { rows: cfgRows } = await pool.query(
    'SELECT * FROM payroll_config WHERE periode_key = $1', [periodKey]
  );
  const config = cfgRows[0] || { hari_libur_reguler: 'minggu', hari_libur_nasional: '' };
  const liburNasionalArray = (config.hari_libur_nasional || '').split(',').map(s=>String(s).trim()).filter(Boolean);

  const { rows: kRows } = await pool.query(
    "SELECT u.id user_id, u.employee_id, u.nama nama_karyawan, u.jabatan, u.created_at," +
    " p.date_in, p.site, p.kota," +
    " COALESCE(p.gaji_pokok,0) gp_master," +
    " COALESCE(p.tunjangan_kehadiran_per_hari,0) tk_harian," +
    " COALESCE(p.tunjangan_jabatan,0) tj," +
    " COALESCE(p.insentif_hm_per_jam,0) ins_hm_pj" +
    " FROM users u LEFT JOIN LATERAL (" +
    "   SELECT r.* FROM payroll r WHERE (u.employee_id IS NOT NULL AND LOWER(TRIM(r.employee_id))=LOWER(TRIM(u.employee_id))) OR LOWER(TRIM(r.nama_karyawan))=LOWER(TRIM(u.nama))" +
    "   ORDER BY CASE WHEN u.employee_id IS NOT NULL AND LOWER(TRIM(r.employee_id))=LOWER(TRIM(u.employee_id)) THEN 0 ELSE 1 END, r.updated_at DESC NULLS LAST" +
    "   LIMIT 1) p ON TRUE" +
    " WHERE u.id=$1", [userId]
  );
  if (!kRows.length) { const e=new Error('Data karyawan tidak ditemukan'); e.statusCode=404; throw e; }
  const k = kRows[0];

  // ------------------------------------------------------------------
  // Data kehadiran (hadir/alpa/izin/sakit) dihitung SAMA persis dgn tab
  // "Rekap Performa" (roster S/M + kamera + status manual + tanggal akun),
  // dipakai bersama Kalkulasi Payroll agar angka konsisten.
  // ------------------------------------------------------------------
  const kehadiran = await hitungKehadiranPayroll({
    userId,
    mulai: tglMulai,
    akhir: tglAkhir,
    accountCreated: k.created_at,
    hariLiburReguler: config.hari_libur_reguler,
    hariLiburNasional: liburNasionalArray,
    tunjKehadiranPerHari: Number(k.tk_harian || 0),
  });

  const hkActual = kehadiran.hari_kerja_actual;
  const hkBiasa  = kehadiran.hari_kerja_biasa;
  const hkLibur  = kehadiran.hari_kerja_libur;
  const tkTotal  = kehadiran.tunj_kehadiran_total;
  const hIzin    = kehadiran.hari_izin;
  const hSakit   = kehadiran.hari_sakit;
  const hAlpa    = kehadiran.hari_alpa;
  const tkHarian = Number(k.tk_harian || 0);

  // Sakit TIDAK memotong gaji (hanya Alpa + Izin)
  const totalDeduksi = hIzin + hAlpa;

  const dateInParsed = parseDateIn(k.date_in || k.created_at);
  const tglMulaiDate = parseDateIn(tglMulai);
  const isMasaKerjaBaru = dateInParsed ? (dateInParsed > tglMulaiDate) : false;
  const dateInStr = k.date_in || (k.created_at ? new Date(k.created_at).toISOString().split('T')[0] : tglMulai);

  const gpMaster = Number(k.gp_master || 0);
  const pembagiBaku = 26;

  let potonganDeduksi = 0;
  if (totalDeduksi > 0) {
    potonganDeduksi = Math.round((gpMaster / pembagiBaku) * totalDeduksi);
  }

  let gpSebelumPotonganAbsen = gpMaster;
  if (isMasaKerjaBaru && dateInParsed) {
    const dEnd = parseDateIn(tglAkhir);
    const diffTime = dEnd.getTime() - dateInParsed.getTime();
    const totalHariMasaKerja = Math.max(1, Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1);
    gpSebelumPotonganAbsen = Math.round((gpMaster / pembagiBaku) * totalHariMasaKerja);
  }

  // Gaji pokok yang dipakai sbg baris pendapatan (semua potongan ALPA/IZIN
  // ditampilkan terpisah di bagian 'Mangkir / Potongan Absen').
  const gpFinal = gpSebelumPotonganAbsen;

  const tj = Number(k.tj || 0);
  const jabLow = String(k.jabatan || '').toLowerCase();
  const isOpDrv = jabLow.includes('operator') || jabLow.includes('driver');
  let totalHm = 0, insHmTotal = 0, insHmPj = 0;
  if (isOpDrv) {
    totalHm = await getHmPayableSum(pool, userId, tglMulai, tglAkhir);
    insHmPj    = Number(k.ins_hm_pj || 0);
    insHmTotal = Math.round(totalHm * insHmPj);
  }

  return {
    employee_id:k.employee_id||'-', nama_karyawan:k.nama_karyawan, jabatan:k.jabatan||'-',
    site:k.site||'BEI Jambi', date_in:dateInStr, bulan, tahun,
    cutoff_mulai:tglMulai, cutoff_akhir:tglAkhir, total_hari_bulan:totalHariBulan,
    is_prorate: isMasaKerjaBaru || totalDeduksi > 0,
    is_prorate_masa_kerja: isMasaKerjaBaru,
    tanggal_buat_akun: kehadiran.tanggal_buat_akun || null,
    total_hari_kerja_eff_rekap: kehadiran.total_hari_kerja_eff,
    hari_kerja_actual:hkActual, hari_kerja_biasa:hkBiasa, hari_kerja_libur:hkLibur,
    hari_izin:hIzin, hari_sakit:hSakit, hari_alpa:hAlpa, total_hari_deduksi:totalDeduksi, potongan_deduksi:potonganDeduksi,
    gp_master:gpMaster, gp_final:gpFinal,
    tk_harian:tkHarian, tk_total:tkTotal, tj,
    is_opdrv:isOpDrv,
    total_hm:isOpDrv?Number(totalHm.toFixed(2)):null,
    ins_hm_pj:isOpDrv?insHmPj:null,
    ins_hm_total:isOpDrv?insHmTotal:null,
    thp:Math.max(0, gpFinal - potonganDeduksi) + tkTotal + tj + insHmTotal,
  };
}
function generatePdfBuffer(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      autoFirstPage: true,
      bufferPages: true,
      info: { Title: `Slip Gaji ${BULAN_NAMA[data.bulan-1]} ${data.tahun}`, Author: 'PT. Prima Indojaya Mandiri' }
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;       // 595.28
    const L = 36;                  // Left margin
    const R = W - 36;              // Right boundary (559.28)

    function fmtNum(n) {
      return Math.round(n || 0).toLocaleString('id-ID');
    }

    let y = 36;

    // ── 1. HEADER (Top Left: Company, Top Center: Title, Top Right: Boxed Employee Info) ──
    // Left: Company Info
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000')
      .text('PT Prima Indojaya Mandiri', L, y);
    doc.font('Helvetica').fontSize(8.5)
      .text('Kelapa Gading Square', L, y + 14)
      .text('French Walk, Blok F-20, Jakarta', L, y + 26);

    // Center: SLIP GAJI Title
    doc.font('Helvetica-Bold').fontSize(13)
      .text('S L I P   G A J I', 200, y, { align: 'center', width: 150 });
    doc.font('Helvetica').fontSize(9)
      .text(`Bulan : ${BULAN_NAMA[data.bulan - 1]} ${data.tahun}`, 200, y + 18, { align: 'center', width: 150 });

    // Right: Employee Info Box
    const boxX = 350;
    const boxW = R - boxX; // 209.28
    doc.rect(boxX, y, boxW, 58).lineWidth(1).stroke('#000000');

    const iX = boxX + 8;
    const vX = boxX + 68;
    doc.font('Helvetica').fontSize(8.5);
    doc.text('Nama',       iX, y + 6).text(': ' + data.nama_karyawan,               vX, y + 6);
    doc.text('NRP',        iX, y + 18).text(': ' + data.employee_id,                 vX, y + 18);
    doc.text('Gol',        iX, y + 30).text(': ' + (data.jabatan || '-'),           vX, y + 30);
    doc.text('Lok. Kerja', iX, y + 42).text(': ' + (data.site || 'BEI Jambi'),      vX, y + 42);

    // ── 2. PENDAPATAN (TABEL ATAS) ──────────────────────────────────────────
    y = 115;
    const colRpX = 380;
    const colValRight = R;

    const gpVal = data.is_prorate_masa_kerja ? data.gp_final : data.gp_master;
    const tkTjVal = data.tk_total + data.tj;
    const insHmVal = data.ins_hm_total || 0;

    const totalPendapatan = gpVal + tkTjVal + insHmVal;

    const pendapatanItems = [
      { label: 'Gaji Pokok', val: gpVal },
      { label: `Hari Kerja : (${data.hari_kerja_actual} Hari)`, val: 0 },
      { label: 'Lembur :', val: 0 },
      { label: 'Tunjangan (Kehadiran & Jabatan)', val: tkTjVal },
    ];

    if (data.is_opdrv && insHmVal > 0) {
      pendapatanItems.push({ label: `Incentive (HM: ${Number(data.total_hm).toFixed(2)} Jam)`, val: insHmVal });
    } else {
      pendapatanItems.push({ label: 'Incentive', val: 0 });
    }

    pendapatanItems.push({ label: 'Rapel', val: 0 });
    pendapatanItems.push({ label: 'Lain-lain', val: 0 });

    doc.font('Helvetica').fontSize(9).fillColor('#000000');
    pendapatanItems.forEach((item) => {
      doc.text(item.label, L + 20, y);
      doc.text('Rp.', colRpX, y);
      doc.text(fmtNum(item.val), colRpX + 30, y, { align: 'right', width: colValRight - (colRpX + 30) });
      y += 18;
    });

    // Divider Line Pendapatan
    y += 4;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(1).stroke('#000000');
    y += 8;

    // Total Pendapatan Row
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Total Pendapatan', L + 20, y);
    doc.text('Rp.', colRpX, y);
    doc.text(fmtNum(totalPendapatan), colRpX + 30, y, { align: 'right', width: colValRight - (colRpX + 30) });

    // ── 3. POTONGAN / PENGURANGAN (TABEL BAWAH) ──────────────────────────────
    y += 28;

    const potonganAbsenVal = data.potongan_deduksi || 0;
    const totalPotongan = potonganAbsenVal;

    const potonganItems = [
      { label: 'BPJS Ketenagakerjaan', val: 0 },
      { label: 'BPJS Pensiun', val: 0 },
      { label: `Mangkir / Potongan Absen (${data.total_hari_deduksi || 0} Hari)`, val: potonganAbsenVal },
      { label: 'Lain-lain', val: 0 },
      { label: 'Rapel', val: 0 },
    ];

    doc.font('Helvetica').fontSize(9);
    potonganItems.forEach((item) => {
      doc.text(item.label, L + 20, y);
      doc.text('Rp.', colRpX, y);
      doc.text(fmtNum(item.val), colRpX + 30, y, { align: 'right', width: colValRight - (colRpX + 30) });
      y += 18;
    });

    // Divider Line Potongan
    y += 4;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(1).stroke('#000000');
    y += 8;

    // Total Potongan Row
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Total Potongan', L + 20, y);
    doc.text('Rp.', colRpX, y);
    doc.text(fmtNum(totalPotongan), colRpX + 30, y, { align: 'right', width: colValRight - (colRpX + 30) });

    // ── 4. TOTAL PENERIMAAN (GAJI BERSIH) ────────────────────────────────────
    y += 26;
    const totalPenerimaan = totalPendapatan - totalPotongan;

    doc.font('Helvetica-Bold').fontSize(11);
    doc.text('Total Penerimaan', L + 20, y);
    doc.text('Rp.', colRpX, y);
    doc.text(fmtNum(totalPenerimaan), colRpX + 30, y, { align: 'right', width: colValRight - (colRpX + 30) });

    // ── 5. FOOTER DISCLAIMER (Bottom of page) ────────────────────────────────
    const footerY = 740;
    doc.moveTo(L, footerY).lineTo(R, footerY).lineWidth(1).stroke('#000000');
    doc.font('Helvetica').fontSize(8.5).fillColor('#333333')
      .text('Slip gaji ini dicetak oleh sistem komputerisasi dan berlaku sah walaupun tidak ditandatangani', L, footerY + 8, { align: 'center', width: R - L });

    doc.end();
  });
}

async function encryptPdf(buf, pw) {
  const pd = await LibPDFDoc.load(buf);
  const enc = await pd.save({
    userPassword: pw,
    ownerPassword: 'PRIMA_OWNER_' + pw + '_2026',
    permissions: {
      printing:'highResolution', modifying:false, copying:false,
      annotating:false, fillingForms:false, contentAccessibility:true, documentAssembly:false
    }
  });
  return Buffer.from(enc);
}

/**
 * GET /api/absensi/slip-gaji?bulan=&tahun=
 * Header X-Password: <password_login_karyawan>
 */
async function getSlipGajiPdf(req, res, next) {
  try {
    const userId = req.user.id;
    const now    = new Date();
    const bulan  = parseInt(req.query.bulan  || (now.getMonth()+1), 10);
    const tahun  = parseInt(req.query.tahun  || now.getFullYear(),  10);
    const pw     = req.headers['x-password'];
    if (!pw || !pw.trim()) return res.status(400).json({ error: 'Header X-Password wajib diisi' });
    const data   = await hitungSlip(userId, bulan, tahun);
    const rawPdf = await generatePdfBuffer(data);
    const encPdf = await encryptPdf(rawPdf, pw.trim());
    const fname  = 'SlipGaji_'+BULAN_NAMA[bulan-1]+'_'+tahun+'_'+(data.employee_id||'karyawan').replace(/[^a-zA-Z0-9]/g,'')+'.pdf';
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','attachment; filename="'+fname+'"');
    res.setHeader('Content-Length', encPdf.length);
    res.end(encPdf);
  } catch(err) { next(err); }
}

/**
 * GET /api/admin/kalkulasi-payroll/slip-pdf?user_id=&bulan=&tahun=
 * Admin only — no password encryption
 */
async function cetakSlipGajiPdfAdmin(req, res, next) {
  try {
    const userId = req.query.user_id;
    const now    = new Date();
    const bulan  = parseInt(req.query.bulan || (now.getMonth()+1), 10);
    const tahun  = parseInt(req.query.tahun || now.getFullYear(),  10);
    if (!userId) return res.status(400).json({ error: 'user_id wajib diisi' });
    const data   = await hitungSlip(userId, bulan, tahun);
    const rawPdf = await generatePdfBuffer(data);
    const fname  = 'SlipGaji_Admin_'+BULAN_NAMA[bulan-1]+'_'+tahun+'_'+(data.employee_id||'karyawan').replace(/[^a-zA-Z0-9]/g,'')+'.pdf';
    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Content-Disposition','inline; filename="'+fname+'"');
    res.setHeader('Content-Length', rawPdf.length);
    res.end(rawPdf);
  } catch(err) { next(err); }
}

module.exports = { getSlipGajiPdf, cetakSlipGajiPdfAdmin, hitungSlip, generatePdfBuffer, encryptPdf };
