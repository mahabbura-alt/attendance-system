'use strict';

/**
 * OMOS People — import karyawan dari Excel.
 *
 * Alur: unduh template (dropdown dari master) → unggah → simulasi (cek per
 * baris, tidak ada yang tersimpan) → petakan nilai yang tidak dikenal ke
 * master (opsional "ingat padanan") → simpan → bisa di-Void per batch.
 *
 * Prinsip anti salah input:
 *   1. Template berisi dropdown dari master saat ini (+ versi master).
 *   2. Nilai harus sama persis dengan master (abaikan besar-kecil/spasi).
 *   3. Padanan (alias) hanya dari konfirmasi admin — tidak pernah ditebak.
 *   4. Nilai yang tidak dikenal dikelompokkan dengan saran terdekat.
 *   Excel tidak pernah membuat departemen/jabatan/lokasi baru.
 */

const crypto = require('crypto');
const ExcelJS = require('exceljs');
const Org = require('./peopleOrg');
const People = require('./peopleEmployees');
const Workforce = require('./workforce');

const { httpError, nameKey, cleanName } = Org;
const TEMPLATE_VERSION = 'people-import-v1';
const MAX_ROWS = 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const SEP = ' · ';

// kunci internal → header di template (yang bertanda * wajib)
const COLUMNS = [
  { key: 'nama', header: 'Nama lengkap *', width: 28, note: 'Sesuai KTP.' },
  { key: 'email', header: 'Email login *', width: 28, note: 'Dipakai untuk masuk aplikasi; harus unik.' },
  { key: 'posisi', header: 'Departemen · Jabatan *', width: 36, note: 'Pilih dari daftar. Tidak bisa diketik bebas.' },
  { key: 'hire_date', header: 'Tanggal masuk *', width: 15, note: 'Format tanggal, mis. 2026-10-19.' },
  { key: 'employment_type', header: 'Status kerja *', width: 14, note: 'PKWT, PKWTT, atau Harian.' },
  { key: 'contract_end_date', header: 'Akhir kontrak', width: 15, note: 'Wajib bila PKWT.' },
  { key: 'lokasi1', header: 'Lokasi absen 1 *', width: 22, note: 'Lokasi utama.' },
  { key: 'lokasi2', header: 'Lokasi absen 2', width: 22 },
  { key: 'lokasi3', header: 'Lokasi absen 3', width: 22 },
  { key: 'nrp', header: 'NRP', width: 16, note: 'Kosongkan agar dibuat otomatis.' },
  { key: 'nik', header: 'NIK KTP', width: 20, note: '16 digit. Kolom berformat Teks.' },
  { key: 'phone', header: 'No. HP', width: 16, note: 'Kolom berformat Teks agar angka 0 di depan tidak hilang.' },
  { key: 'birth_date', header: 'Tanggal lahir', width: 15 },
  { key: 'gender', header: 'Jenis kelamin', width: 13, note: 'L atau P.' },
  { key: 'site', header: 'Site', width: 16, note: 'Teks bebas, mis. Pit 3.' },
  { key: 'marital_status', header: 'Status nikah', width: 14, note: 'Lajang, Menikah, Cerai hidup, Cerai mati.' },
];

const HEADER_ALIASES = {
  nama: ['nama lengkap', 'nama', 'nama karyawan'],
  email: ['email login', 'email', 'e-mail'],
  posisi: ['departemen · jabatan', 'departemen - jabatan', 'departemen / jabatan', 'posisi'],
  department: ['departemen', 'department', 'dept'],
  position: ['jabatan', 'position'],
  hire_date: ['tanggal masuk', 'tgl masuk', 'tanggal bergabung', 'join date'],
  employment_type: ['status kerja', 'status karyawan', 'jenis kontrak', 'tipe kontrak'],
  contract_end_date: ['akhir kontrak', 'kontrak berakhir', 'tanggal akhir kontrak'],
  lokasi1: ['lokasi absen 1', 'lokasi 1', 'lokasi absen', 'lokasi'],
  lokasi2: ['lokasi absen 2', 'lokasi 2'],
  lokasi3: ['lokasi absen 3', 'lokasi 3'],
  nrp: ['nrp', 'nomor induk', 'no induk'],
  nik: ['nik ktp', 'nik', 'no ktp'],
  phone: ['no. hp', 'no hp', 'nomor hp', 'hp', 'telepon', 'no. telepon'],
  birth_date: ['tanggal lahir', 'tgl lahir'],
  gender: ['jenis kelamin', 'gender'],
  site: ['site'],
  marital_status: ['status nikah', 'status pernikahan', 'status perkawinan'],
};

const MARITAL_MAP = {
  lajang: 'SINGLE', 'belum menikah': 'SINGLE', single: 'SINGLE', tk: 'SINGLE',
  menikah: 'MARRIED', kawin: 'MARRIED', married: 'MARRIED', k: 'MARRIED',
  'cerai hidup': 'DIVORCED', cerai: 'DIVORCED', divorced: 'DIVORCED',
  'cerai mati': 'WIDOWED', 'janda': 'WIDOWED', 'duda': 'WIDOWED', widowed: 'WIDOWED',
};

// ---------------------------------------------------------------------------
// Helper murni
// ---------------------------------------------------------------------------
function headerKey(text) {
  return String(text || '').replace(/\*/g, '').replace(/\(.*?\)/g, '').replace(/[•·]/g, '·')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function mapHeaders(headerCells) {
  const map = {};
  headerCells.forEach((text, idx) => {
    const k = headerKey(text);
    if (!k) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field] === undefined && aliases.includes(k)) { map[field] = idx; return; }
    }
  });
  return map;
}

/** Nilai sel exceljs → teks/tanggal/angka polos. */
function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if (v.text !== undefined) return cellValue(v.text);
    if (v.result !== undefined) return cellValue(v.result);
    if (v.error) return null;
    return String(v);
  }
  return v;
}

function text(v) {
  const c = cellValue(v);
  if (c == null) return null;
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  const s = String(c).replace(/\s+/g, ' ').trim();
  return s || null;
}

function excelSerialToIso(n) {
  const ms = Math.round((n - 25569) * 864e5);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Tanggal dari Excel: Date, nomor seri, 2026-10-19, 19/10/2026, 19-10-2026, 19.10.2026. */
function parseDate(v) {
  const c = cellValue(v);
  if (c == null || c === '') return { value: null };
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return { error: 'tanggal tidak valid' };
    return { value: c.toISOString().slice(0, 10) };
  }
  if (typeof c === 'number') {
    if (c < 1 || c > 80000) return { error: 'tanggal tidak valid' };
    return { value: excelSerialToIso(c) };
  }
  const s = String(c).trim();
  let y; let m; let d;
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) [, y, m, d] = match;
  else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, m, y] = match;
  else return { error: `format tanggal "${s}" tidak dikenali (pakai 2026-10-19 atau 19/10/2026)` };
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) return { error: `tanggal "${s}" tidak ada di kalender` };
  return { value: iso };
}

/** NIK/No. HP yang terbaca sebagai angka oleh Excel. */
function digitsCell(v, { phone = false } = {}) {
  const c = cellValue(v);
  if (c == null || c === '') return { value: null };
  if (typeof c === 'number') {
    // Excel hanya menyimpan 15 digit signifikan: angka ≥16 digit (NIK) pasti sudah berubah.
    if (!Number.isSafeInteger(c) || String(Math.abs(c)).length > 15) return { error: 'terbaca sebagai angka & digit terakhir berubah — format kolom sebagai Teks lalu ketik ulang' };
    const s = String(c);
    return { value: phone && !s.startsWith('0') && !s.startsWith('62') ? `0${s}` : s };
  }
  return { value: String(c).replace(/\s+/g, '').trim() || null };
}

function positionLabel(deptName, posName) {
  return `${deptName}${SEP}${posName}`;
}

/** Pecah "Produksi · Operator DT" (juga '-', '/', '|') menjadi [dept, jabatan]. */
function splitPosisi(raw) {
  const s = cleanName(raw);
  for (const sep of ['·', '•', ' | ', ' / ', ' - ', ' – ']) {
    const i = s.indexOf(sep);
    if (i > 0) return [s.slice(0, i).trim(), s.slice(i + sep.length).trim()];
  }
  return [null, s];
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Skor kemiripan 0..1 — gabungan edit distance, awalan kata, dan singkatan (DT = Dump Truck). */
function similarity(rawText, targetText) {
  const a = nameKey(rawText).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const b = nameKey(targetText).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!a || !b) return 0;
  if (a === b) return 1;
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const at = a.split(' ');
  const bt = b.split(' ');
  let hit = 0;
  for (const t of at) {
    if (bt.some(x => x.startsWith(t) || t.startsWith(x))) { hit += 1; continue; }
    // singkatan: huruf awal kata berurutan di target
    const isAbbr = t.length >= 2 && bt.some((_, i) => bt.slice(i, i + t.length).map(x => x[0]).join('') === t);
    if (isAbbr) hit += 1;
  }
  const token = hit / at.length;
  return Math.max(lev, token * 0.9);
}

function suggest(rawText, candidates, limit = 3) {
  return candidates
    .map(c => ({ id: c.id, label: c.label, score: Math.round(similarity(rawText, c.label) * 100) / 100 }))
    .filter(c => c.score >= 0.45)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Master
// ---------------------------------------------------------------------------
async function loadMaster(db, scope) {
  const [positions, locations, aliases, version] = await Promise.all([
    db.query(`SELECT p.id, p.name, p.is_active, d.id AS department_id, d.name AS department_name, d.is_active AS department_active
      FROM workforce_positions p JOIN workforce_departments d ON d.id = p.department_id
      WHERE p.tenant_key = $1 AND p.project_key = $2 ORDER BY lower(d.name), lower(p.name)`, [scope.tenantKey, scope.projectKey]),
    db.query(`SELECT id, nama_lokasi FROM lokasi_kantor ORDER BY lower(nama_lokasi)`),
    db.query(`SELECT kind, alias_key, target_id, department_id FROM master_aliases
      WHERE tenant_key = $1 AND project_key = $2`, [scope.tenantKey, scope.projectKey]),
    Org.getMasterVersion(db, scope.tenantKey),
  ]);
  const pos = positions.rows.map(p => ({
    id: p.id, label: positionLabel(p.department_name, p.name), name: p.name, department_id: p.department_id,
    department_name: p.department_name, active: p.is_active && p.department_active !== false,
  }));
  const loc = locations.rows.map(l => ({ id: l.id, label: l.nama_lokasi }));
  return {
    version,
    positions: pos,
    locations: loc,
    posByKey: new Map(pos.map(p => [nameKey(p.label), p])),
    posById: new Map(pos.map(p => [p.id, p])),
    locByKey: new Map(loc.map(l => [nameKey(l.label), l])),
    locById: new Map(loc.map(l => [l.id, l])),
    aliases: new Map(aliases.rows.map(a => [`${a.kind}:${a.alias_key}`, a.target_id])),
  };
}

/** Cocokkan "Departemen · Jabatan" ke master: persis → alias admin. Tidak menebak. */
function matchPosition(raw, master, mappings = {}) {
  const key = nameKey(raw);
  if (mappings[key]) return master.posById.get(mappings[key]) || null;
  const exact = master.posByKey.get(key);
  if (exact) return exact;
  const [dept, pos] = splitPosisi(raw);
  if (dept) {
    const normalized = master.posByKey.get(nameKey(positionLabel(dept, pos)));
    if (normalized) return normalized;
  }
  const aliased = master.aliases.get(`POSITION:${key}`);
  return aliased ? master.posById.get(aliased) || null : null;
}

function matchLocation(raw, master, mappings = {}) {
  const key = nameKey(raw);
  if (mappings[key]) return master.locById.get(mappings[key]) || null;
  const exact = master.locByKey.get(key);
  if (exact) return exact;
  const aliased = master.aliases.get(`LOCATION:${key}`);
  return aliased ? master.locById.get(aliased) || null : null;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------
async function buildTemplate(db, scope) {
  const master = await loadMaster(db, scope);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OMOS People';
  wb.created = new Date();

  const ws = wb.addWorksheet('Karyawan', { views: [{ state: 'frozen', ySplit: 1, xSplit: 1 }] });
  ws.columns = COLUMNS.map(c => ({ header: c.header, key: c.key, width: c.width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.height = 30;
  head.alignment = { vertical: 'middle', wrapText: true };
  COLUMNS.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.header.endsWith('*') ? 'FF1F3A5F' : 'FF5B6B7F' } };
    if (c.note) cell.note = c.note;
  });

  const ms = wb.addWorksheet('Master');
  ms.columns = [
    { header: 'Departemen · Jabatan', key: 'posisi', width: 40 },
    { header: 'Lokasi absen', key: 'lokasi', width: 28 },
    { header: 'Status kerja', key: 'type', width: 14 },
    { header: 'Jenis kelamin', key: 'gender', width: 14 },
    { header: 'Status nikah', key: 'marital', width: 14 },
  ];
  ms.getRow(1).font = { bold: true };
  const activePos = master.positions.filter(p => p.active).map(p => p.label);
  const lists = [activePos, master.locations.map(l => l.label), ['PKWT', 'PKWTT', 'Harian'], ['L', 'P'],
    ['Lajang', 'Menikah', 'Cerai hidup', 'Cerai mati']];
  const longest = Math.max(...lists.map(l => l.length));
  for (let i = 0; i < longest; i += 1) ms.addRow(lists.map(l => l[i] ?? null));
  ms.state = 'veryHidden';
  const ref = (col, n) => `Master!$${col}$2:$${col}$${Math.max(2, n + 1)}`;

  const meta = wb.addWorksheet('_meta');
  meta.addRow(['template_version', TEMPLATE_VERSION]);
  meta.addRow(['master_version', master.version]);
  meta.addRow(['generated_at', new Date().toISOString()]);
  meta.state = 'veryHidden';

  const idx = Object.fromEntries(COLUMNS.map((c, i) => [c.key, i + 1]));
  const list = (formula, title) => ({
    type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true,
    errorStyle: 'stop', errorTitle: title, error: 'Pilih dari daftar. Bila belum ada, tambahkan dulu di Setup master OMOS.',
  });
  const dateRule = { type: 'date', operator: 'between', allowBlank: true, formulae: [new Date('1950-01-01'), new Date('2100-12-31')],
    showErrorMessage: true, errorTitle: 'Tanggal', error: 'Isi dengan tanggal, mis. 2026-10-19.' };
  for (let r = 2; r <= MAX_ROWS + 1; r += 1) {
    const row = ws.getRow(r);
    row.getCell(idx.posisi).dataValidation = list(ref('A', activePos.length), 'Departemen · Jabatan');
    ['lokasi1', 'lokasi2', 'lokasi3'].forEach(k => { row.getCell(idx[k]).dataValidation = list(ref('B', master.locations.length), 'Lokasi absen'); });
    row.getCell(idx.employment_type).dataValidation = list(ref('C', 3), 'Status kerja');
    row.getCell(idx.gender).dataValidation = list(ref('D', 2), 'Jenis kelamin');
    row.getCell(idx.marital_status).dataValidation = list(ref('E', 4), 'Status nikah');
    ['hire_date', 'contract_end_date', 'birth_date'].forEach(k => {
      const cell = row.getCell(idx[k]);
      cell.dataValidation = dateRule;
      cell.numFmt = 'yyyy-mm-dd';
    });
    ['nik', 'phone', 'nrp'].forEach(k => { row.getCell(idx[k]).numFmt = '@'; });
  }

  const help = wb.addWorksheet('Petunjuk');
  help.getColumn(1).width = 110;
  [
    'PETUNJUK IMPORT KARYAWAN — OMOS People',
    '',
    `Template ini dibuat dari master versi ${master.version}. Bila master berubah, unduh template baru.`,
    'Kolom bertanda * wajib. Kolom lain boleh dikosongkan dan dilengkapi nanti di profil karyawan.',
    'Departemen · Jabatan dan Lokasi absen WAJIB dipilih dari dropdown. Import tidak pernah membuat jabatan/lokasi baru.',
    'Lokasi absen 1 = lokasi utama. Isi Lokasi 2/3 bila karyawan boleh absen di lebih dari satu lokasi.',
    'NRP kosong = dibuat otomatis sesuai pola NRP. NIK dan No. HP diketik sebagai teks (jangan diubah ke angka).',
    'Akhir kontrak wajib untuk PKWT. Probation dihitung otomatis dari tanggal masuk.',
    'Email/NIK/NRP yang sudah terdaftar akan ditolak per baris; baris lain tetap bisa disimpan.',
    'Setelah diunggah, OMOS menampilkan simulasi dulu. Tidak ada data yang tersimpan sebelum Anda menekan Simpan.',
    'Data keluarga, dokumen (CV/kompetensi), dan foto wajah dilengkapi per karyawan setelah import.',
    'Batas: 1.000 baris per file, ukuran file maksimal 5 MB.',
  ].forEach((line, i) => {
    const row = help.addRow([line]);
    if (i === 0) row.font = { bold: true, size: 13 };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Baca file
// ---------------------------------------------------------------------------
async function readWorkbook(buffer) {
  if (!buffer || !buffer.length) throw httpError('Pilih file Excel (.xlsx).');
  if (buffer.length > MAX_BYTES) throw httpError('Ukuran file maksimal 5 MB.', 413);
  if (buffer.subarray(0, 2).toString('latin1') !== 'PK') throw httpError('File harus berformat Excel .xlsx (bukan .xls/.csv).', 415);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch (_) {
    throw httpError('File Excel tidak bisa dibaca. Simpan ulang sebagai .xlsx lalu unggah kembali.', 415);
  }
  const ws = wb.getWorksheet('Karyawan') || wb.worksheets.find(s => s.state === 'visible') || wb.worksheets[0];
  if (!ws) throw httpError('Sheet Karyawan tidak ditemukan.');
  const meta = {};
  const metaSheet = wb.getWorksheet('_meta');
  if (metaSheet) metaSheet.eachRow(r => { meta[text(r.getCell(1).value)] = text(r.getCell(2).value); });

  const headerCells = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => { headerCells[col - 1] = text(cell.value); });
  const map = mapHeaders(headerCells);
  const hasPosisi = map.posisi !== undefined || (map.department !== undefined && map.position !== undefined);
  const missing = [];
  if (map.nama === undefined) missing.push('Nama lengkap');
  if (map.email === undefined) missing.push('Email login');
  if (!hasPosisi) missing.push('Departemen · Jabatan');
  if (map.hire_date === undefined) missing.push('Tanggal masuk');
  if (map.employment_type === undefined) missing.push('Status kerja');
  if (map.lokasi1 === undefined) missing.push('Lokasi absen 1');
  if (missing.length) throw httpError(`Kolom wajib tidak ditemukan: ${missing.join(', ')}. Gunakan template terbaru.`);

  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
    if (rowNo === 1) return;
    const raw = {};
    for (const [field, idx] of Object.entries(map)) raw[field] = cellValue(row.getCell(idx + 1).value);
    const hasData = Object.values(raw).some(v => v != null && String(v).trim() !== '');
    if (hasData) rows.push({ row_no: rowNo, raw });
  });
  if (!rows.length) throw httpError('Tidak ada baris data di sheet Karyawan.');
  if (rows.length > MAX_ROWS) throw httpError(`Maksimal ${MAX_ROWS} baris per file (file berisi ${rows.length}).`);
  return { meta, rows };
}

function jsonSafe(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) out[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
  return out;
}

// ---------------------------------------------------------------------------
// Validasi baris
// ---------------------------------------------------------------------------
async function existingKeys(db, scope, emails, niks, nrps) {
  const [e, n, r] = await Promise.all([
    db.query(`SELECT lower(email) AS k FROM users WHERE lower(email) = ANY($1)`, [emails]),
    db.query(`SELECT nik AS k FROM workforce_employee_personal WHERE tenant_key = $1 AND nik = ANY($2)`, [scope.tenantKey, niks]),
    db.query(`SELECT lower(employee_id) AS k FROM users WHERE lower(employee_id) = ANY($1)`, [nrps]),
  ]);
  return { emails: new Set(e.rows.map(x => x.k)), niks: new Set(n.rows.map(x => x.k)), nrps: new Set(r.rows.map(x => x.k)) };
}

function validateRows(rows, master, existing, { today, mappings = {} }) {
  const seen = { email: new Map(), nik: new Map(), nrp: new Map() };
  const unknown = { positions: new Map(), locations: new Map() };
  const addUnknown = (bucket, raw, rowNo, candidates) => {
    const key = nameKey(raw);
    if (!bucket.has(key)) bucket.set(key, { raw: cleanName(raw), key, rows: [], suggestions: suggest(raw, candidates) });
    bucket.get(key).rows.push(rowNo);
  };
  const activePositions = master.positions.filter(p => p.active);

  const results = rows.map(({ row_no: rowNo, raw }) => {
    const errors = [];
    const warnings = [];
    const n = {};
    const r = { ...raw };
    if (r.posisi == null && (r.department != null || r.position != null)) {
      r.posisi = r.department != null ? `${text(r.department) || ''}${SEP}${text(r.position) || ''}` : r.position;
    }

    n.nama = text(r.nama);
    if (!n.nama || n.nama.length < 2) errors.push('Nama lengkap wajib diisi.');
    n.email = text(r.email) ? text(r.email).toLowerCase() : null;
    if (!n.email) errors.push('Email login wajib diisi.');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n.email)) errors.push(`Email "${n.email}" tidak valid.`);
    else if (existing.emails.has(n.email)) errors.push(`Email ${n.email} sudah terdaftar.`);

    const posRaw = text(r.posisi);
    if (!posRaw) errors.push('Departemen · Jabatan wajib dipilih.');
    else {
      const pos = matchPosition(posRaw, master, mappings.positions);
      if (!pos) {
        errors.push(`"${posRaw}" tidak ada di master jabatan.`);
        addUnknown(unknown.positions, posRaw, rowNo, activePositions);
      } else if (!pos.active) errors.push(`Jabatan "${pos.label}" sedang nonaktif.`);
      else {
        n.position_id = pos.id;
        n.posisi = pos.label;
        if (nameKey(pos.label) !== nameKey(posRaw)) warnings.push(`"${posRaw}" dibaca sebagai ${pos.label}.`);
      }
    }

    const hire = parseDate(r.hire_date);
    if (hire.error) errors.push(`Tanggal masuk: ${hire.error}.`);
    else if (!hire.value) errors.push('Tanggal masuk wajib diisi.');
    else {
      n.hire_date = hire.value;
      const ahead = (Date.parse(hire.value) - Date.parse(today)) / 864e5;
      if (ahead > 60) warnings.push('Tanggal masuk lebih dari 60 hari ke depan.');
    }

    const typeText = text(r.employment_type);
    try {
      n.employment_type = Workforce.normalizeEmploymentType(typeText, { required: true });
    } catch (_) {
      errors.push(typeText ? `Status kerja "${typeText}" tidak dikenal (PKWT, PKWTT, Harian).` : 'Status kerja wajib diisi.');
    }
    const end = parseDate(r.contract_end_date);
    if (end.error) errors.push(`Akhir kontrak: ${end.error}.`);
    else n.contract_end_date = end.value;
    if (n.employment_type === 'PKWT' && !n.contract_end_date) errors.push('Akhir kontrak wajib untuk PKWT.');
    if (n.contract_end_date && n.hire_date && n.contract_end_date < n.hire_date) errors.push('Akhir kontrak sebelum tanggal masuk.');

    n.lokasi_ids = [];
    n.lokasi = [];
    ['lokasi1', 'lokasi2', 'lokasi3'].forEach((k, i) => {
      const v = text(r[k]);
      if (!v) { if (i === 0) errors.push('Lokasi absen 1 wajib dipilih.'); return; }
      const loc = matchLocation(v, master, mappings.locations);
      if (!loc) {
        errors.push(`Lokasi "${v}" tidak ada di master lokasi.`);
        addUnknown(unknown.locations, v, rowNo, master.locations);
      } else if (!n.lokasi_ids.includes(loc.id)) {
        n.lokasi_ids.push(loc.id);
        n.lokasi.push(loc.label);
      }
    });

    n.nrp = text(r.nrp);
    if (n.nrp && existing.nrps.has(n.nrp.toLowerCase())) errors.push(`NRP ${n.nrp} sudah dipakai.`);
    const nik = digitsCell(r.nik);
    if (nik.error) errors.push(`NIK ${nik.error}.`);
    else if (nik.value) {
      const digits = nik.value.replace(/[.-]/g, '');
      if (!/^[0-9]{16}$/.test(digits)) errors.push('NIK harus 16 digit angka.');
      else if (existing.niks.has(digits)) errors.push('NIK sudah terdaftar pada karyawan lain.');
      else n.nik = digits;
    }
    const phone = digitsCell(r.phone, { phone: true });
    if (phone.error) errors.push(`No. HP ${phone.error}.`);
    else if (phone.value) {
      if (!/^[0-9+() -]{6,20}$/.test(phone.value)) errors.push('No. HP tidak valid.');
      else n.phone = phone.value;
    }
    const birth = parseDate(r.birth_date);
    if (birth.error) errors.push(`Tanggal lahir: ${birth.error}.`);
    else if (birth.value) {
      n.birth_date = birth.value;
      const age = (Date.parse(today) - Date.parse(birth.value)) / (365.25 * 864e5);
      if (age < 18) warnings.push('Usia di bawah 18 tahun — periksa tanggal lahir.');
      if (age > 70) warnings.push('Usia di atas 70 tahun — periksa tanggal lahir.');
    }
    const g = text(r.gender);
    if (g) {
      const up = g.toUpperCase();
      if (up.startsWith('L') || up === 'M') n.gender = 'M';
      else if (up.startsWith('P') || up === 'F' || up === 'W') n.gender = 'F';
      else errors.push(`Jenis kelamin "${g}" tidak dikenal (L/P).`);
    }
    n.site = text(r.site);
    const mar = text(r.marital_status);
    if (mar) {
      n.marital_status = MARITAL_MAP[nameKey(mar)] || null;
      if (!n.marital_status) errors.push(`Status nikah "${mar}" tidak dikenal.`);
    }

    for (const [field, value] of [['email', n.email], ['nik', n.nik], ['nrp', n.nrp && n.nrp.toLowerCase()]]) {
      if (!value) continue;
      if (seen[field].has(value)) errors.push(`${field.toUpperCase()} sama dengan baris ${seen[field].get(value)}.`);
      else seen[field].set(value, rowNo);
    }

    const status = errors.length ? 'ERROR' : warnings.length ? 'WARNING' : 'VALID';
    return { row_no: rowNo, raw: jsonSafe(raw), normalized: n, status,
      messages: [...errors.map(m => ({ level: 'error', text: m })), ...warnings.map(m => ({ level: 'warning', text: m }))] };
  });

  return {
    rows: results,
    unknown: {
      positions: [...unknown.positions.values()].sort((a, b) => b.rows.length - a.rows.length),
      locations: [...unknown.locations.values()].sort((a, b) => b.rows.length - a.rows.length),
    },
  };
}

function summarize(rows) {
  const count = s => rows.filter(r => r.status === s).length;
  return { total: rows.length, valid: count('VALID'), warning: count('WARNING'), error: count('ERROR') };
}

async function runValidation(db, scope, rawRows, opts) {
  const master = await loadMaster(db, scope);
  const emails = rawRows.map(r => (text(r.raw.email) || '').toLowerCase()).filter(Boolean);
  const niks = rawRows.map(r => (digitsCell(r.raw.nik).value || '').replace(/[.-]/g, '')).filter(Boolean);
  const nrps = rawRows.map(r => (text(r.raw.nrp) || '').toLowerCase()).filter(Boolean);
  const existing = await existingKeys(db, scope, emails, niks, nrps);
  const result = validateRows(rawRows, master, existing, opts);
  return { master, ...result };
}

async function saveRows(client, batchId, rows) {
  await client.query(`DELETE FROM employee_import_rows WHERE batch_id = $1`, [batchId]);
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const params = [];
    const values = chunk.map((r, j) => {
      params.push(batchId, r.row_no, JSON.stringify(r.raw), JSON.stringify(r.normalized), r.status, JSON.stringify(r.messages));
      const b = j * 6;
      return `($${b + 1}, $${b + 2}, $${b + 3}::jsonb, $${b + 4}::jsonb, $${b + 5}, $${b + 6}::jsonb)`;
    });
    await client.query(`INSERT INTO employee_import_rows (batch_id, row_no, raw, normalized, status, messages)
      VALUES ${values.join(', ')}`, params);
  }
}

function previewPayload(batch, rows, unknown, master, meta = {}) {
  const notices = [];
  if (meta.template_version && meta.template_version !== TEMPLATE_VERSION) {
    notices.push(`Template versi ${meta.template_version}; versi terbaru ${TEMPLATE_VERSION}.`);
  }
  if (batch.master_version != null && Number(batch.master_version) !== Number(master.version)) {
    notices.push(`Template dibuat dari master versi ${batch.master_version}, sekarang versi ${master.version}. Dropdown di file mungkin sudah usang.`);
  }
  return {
    batch: { ...batch, summary: summarize(rows) },
    notices,
    unknown,
    rows: rows.map(r => ({ row_no: r.row_no, status: r.status, messages: r.messages,
      nama: r.normalized.nama || text(r.raw.nama), email: r.normalized.email || text(r.raw.email),
      posisi: r.normalized.posisi || text(r.raw.posisi) || null, lokasi: r.normalized.lokasi || [],
      hire_date: r.normalized.hire_date || null, employment_type: r.normalized.employment_type || null,
      nrp: r.normalized.nrp || null })),
    master: {
      positions: master.positions.filter(p => p.active).map(p => ({ id: p.id, label: p.label })),
      locations: master.locations,
    },
  };
}

/** Unggah & simulasi. Tidak ada karyawan yang dibuat. */
async function previewImport(db, scope, user, file, opts = {}) {
  const today = opts.today || Workforce.todayWib();
  const { meta, rows: rawRows } = await readWorkbook(file && file.buffer);
  const { master, rows, unknown } = await runValidation(db, scope, rawRows, { today });
  const sum = summarize(rows);
  const sha = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const metaVersion = meta.master_version != null && /^\d+$/.test(String(meta.master_version)) ? Number(meta.master_version) : null;
  const batch = await Org.withTransaction(db, async (client) => {
    const { rows: b } = await client.query(`INSERT INTO employee_import_batches
      (tenant_key, project_key, file_name, file_sha256, template_version, master_version,
       total_rows, valid_rows, warning_rows, error_rows, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, file_name, status, master_version, created_at`,
    [scope.tenantKey, scope.projectKey, String(file.originalname || 'import.xlsx').slice(0, 200), sha,
      meta.template_version || null, metaVersion, sum.total, sum.valid, sum.warning, sum.error, user.id]);
    await saveRows(client, b[0].id, rows);
    return b[0];
  });
  const previous = await db.query(`SELECT id, created_at, status FROM employee_import_batches
    WHERE tenant_key = $1 AND file_sha256 = $2 AND id <> $3 AND status IN ('COMMITTED','PARTIAL') ORDER BY created_at DESC LIMIT 1`,
  [scope.tenantKey, sha, batch.id]);
  const payload = previewPayload(batch, rows, unknown, master, meta);
  if (previous.rows[0]) payload.notices.unshift('File yang sama persis sudah pernah disimpan sebelumnya. Periksa agar tidak dobel.');
  return payload;
}

async function lockBatch(client, scope, batchId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(batchId || ''))) throw httpError('Batch import tidak ditemukan.', 404);
  const { rows } = await client.query(`SELECT * FROM employee_import_batches WHERE id = $1 AND tenant_key = $2 FOR UPDATE`,
    [batchId, scope.tenantKey]);
  if (!rows[0]) throw httpError('Batch import tidak ditemukan.', 404);
  return rows[0];
}

/**
 * Terapkan padanan dari admin: { positions: {raw: position_id}, locations: {raw: lokasi_id}, remember }.
 * remember=true menyimpan padanan ke master_aliases untuk import berikutnya.
 */
async function applyMappings(db, scope, user, batchId, input = {}, opts = {}) {
  const today = opts.today || Workforce.todayWib();
  const norm = obj => Object.fromEntries(Object.entries(obj || {}).filter(([, v]) => v).map(([k, v]) => [nameKey(k), String(v)]));
  const mappings = { positions: norm(input.positions), locations: norm(input.locations) };
  return Org.withTransaction(db, async (client) => {
    const batch = await lockBatch(client, scope, batchId);
    if (batch.status !== 'VALIDATED') throw httpError('Batch ini sudah diproses.', 409);
    const master = await loadMaster(client, scope);
    for (const id of Object.values(mappings.positions)) {
      const p = master.posById.get(id);
      if (!p || !p.active) throw httpError('Jabatan tujuan padanan tidak ditemukan / nonaktif.');
    }
    for (const id of Object.values(mappings.locations)) {
      if (!master.locById.get(id)) throw httpError('Lokasi tujuan padanan tidak ditemukan.');
    }
    if (input.remember) {
      const save = async (kind, key, targetId, deptId) => client.query(`INSERT INTO master_aliases
        (tenant_key, project_key, kind, alias_key, target_id, department_id, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (tenant_key, project_key, kind, alias_key, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid))
        DO UPDATE SET target_id = EXCLUDED.target_id, usage_count = master_aliases.usage_count + 1`,
      [scope.tenantKey, scope.projectKey, kind, key, targetId, deptId, user.id]);
      for (const [key, id] of Object.entries(mappings.positions)) await save('POSITION', key, id, master.posById.get(id).department_id);
      for (const [key, id] of Object.entries(mappings.locations)) await save('LOCATION', key, id, null);
      if (Object.keys(mappings.positions).length || Object.keys(mappings.locations).length) {
        await Org.bumpMasterVersion(client, scope.tenantKey);
      }
    }
    const stored = await client.query(`SELECT row_no, raw FROM employee_import_rows WHERE batch_id = $1 ORDER BY row_no`, [batch.id]);
    const { master: m2, rows, unknown } = await runValidation(client, scope, stored.rows, { today, mappings });
    await saveRows(client, batch.id, rows);
    const sum = summarize(rows);
    await client.query(`UPDATE employee_import_batches SET valid_rows = $2, warning_rows = $3, error_rows = $4 WHERE id = $1`,
      [batch.id, sum.valid, sum.warning, sum.error]);
    return previewPayload({ id: batch.id, file_name: batch.file_name, status: batch.status, master_version: batch.master_version,
      created_at: batch.created_at }, rows, unknown, m2, { template_version: batch.template_version });
  });
}

/**
 * Simpan baris VALID/WARNING sebagai karyawan (masing-masing transaksi sendiri).
 * Batch diklaim dulu (VALIDATED → COMMITTED) sehingga klik ganda tidak membuat dobel.
 */
async function commitImport(db, scope, user, batchId, opts = {}) {
  const today = opts.today || Workforce.todayWib();
  const claimed = await Org.withTransaction(db, async (client) => {
    const batch = await lockBatch(client, scope, batchId);
    if (batch.status !== 'VALIDATED') throw httpError('Batch ini sudah disimpan atau dibatalkan.', 409, 'IMPORT_ALREADY_PROCESSED');
    await client.query(`UPDATE employee_import_batches SET status = 'COMMITTED', committed_by = $2, committed_at = CURRENT_TIMESTAMP
      WHERE id = $1`, [batch.id, user.id]);
    return batch;
  });
  // Validasi ulang tepat sebelum simpan (data bisa berubah sejak simulasi).
  const stored = await db.query(`SELECT row_no, raw, status FROM employee_import_rows WHERE batch_id = $1 ORDER BY row_no`, [claimed.id]);
  const { rows } = await runValidation(db, scope, stored.rows, { today, mappings: {} });
  const prior = new Map(stored.rows.map(r => [r.row_no, r.status]));
  // Padanan sekali pakai (tanpa "ingat") sudah tertulis di normalized; pakai itu bila validasi ulang gagal hanya karena master.
  const normalizedPrior = await db.query(`SELECT row_no, normalized FROM employee_import_rows WHERE batch_id = $1`, [claimed.id]);
  const priorNorm = new Map(normalizedPrior.rows.map(r => [r.row_no, r.normalized]));

  const results = [];
  const invites = [];
  for (const row of rows) {
    const before = prior.get(row.row_no);
    if (before === 'ERROR') { results.push({ row_no: row.row_no, status: 'SKIPPED' }); continue; }
    const input = { ...(row.status === 'ERROR' ? priorNorm.get(row.row_no) : row.normalized) };
    try {
      const created = await People.createEmployee(db, scope, user, {
        ...input, send_invite: opts.sendInvites !== false,
      }, { today, source: 'IMPORT', batchId: claimed.id });
      if (created.invite) invites.push(created.invite);
      await db.query(`UPDATE employee_import_rows SET status = 'COMMITTED', created_user_id = $3 WHERE batch_id = $1 AND row_no = $2`,
        [claimed.id, row.row_no, created.user_id]);
      results.push({ row_no: row.row_no, status: 'COMMITTED', user_id: created.user_id, nrp: created.nrp });
    } catch (error) {
      await db.query(`UPDATE employee_import_rows SET status = 'ERROR', messages = messages || $3::jsonb WHERE batch_id = $1 AND row_no = $2`,
        [claimed.id, row.row_no, JSON.stringify([{ level: 'error', text: `Gagal disimpan: ${error.message}` }])]);
      results.push({ row_no: row.row_no, status: 'ERROR', error: error.message });
    }
  }
  const committed = results.filter(r => r.status === 'COMMITTED').length;
  const failed = results.filter(r => r.status === 'ERROR').length;
  const skipped = results.filter(r => r.status === 'SKIPPED').length;
  const status = committed && !failed && !skipped ? 'COMMITTED' : committed ? 'PARTIAL' : 'CANCELLED';
  await db.query(`UPDATE employee_import_batches SET status = $2, committed_rows = $3 WHERE id = $1`, [claimed.id, status, committed]);
  return { batch_id: claimed.id, status, committed, failed, skipped, results, invites };
}

async function cancelImport(db, scope, user, batchId) {
  return Org.withTransaction(db, async (client) => {
    const batch = await lockBatch(client, scope, batchId);
    if (batch.status !== 'VALIDATED') throw httpError('Hanya simulasi yang belum disimpan yang bisa dibatalkan.', 409);
    await client.query(`UPDATE employee_import_batches SET status = 'CANCELLED' WHERE id = $1`, [batch.id]);
    return { batch_id: batch.id, status: 'CANCELLED' };
  });
}

/** Void seluruh karyawan hasil satu batch (hanya yang belum punya transaksi). */
async function voidImport(db, scope, user, batchId, input = {}, opts = {}) {
  const reason = People.clean(input.reason);
  if (!reason || reason.length < 5) throw httpError('Alasan Void wajib diisi (minimal 5 karakter).');
  const batch = (await db.query(`SELECT * FROM employee_import_batches WHERE id = $1 AND tenant_key = $2`, [batchId, scope.tenantKey])).rows[0];
  if (!batch) throw httpError('Batch import tidak ditemukan.', 404);
  if (!['COMMITTED', 'PARTIAL'].includes(batch.status)) throw httpError('Batch ini belum disimpan atau sudah di-Void.', 409);
  const { rows } = await db.query(`SELECT r.row_no, r.created_user_id, p.voided_at FROM employee_import_rows r
    LEFT JOIN workforce_employee_profiles p ON p.user_id = r.created_user_id
    WHERE r.batch_id = $1 AND r.status = 'COMMITTED' ORDER BY r.row_no`, [batch.id]);
  const results = [];
  for (const r of rows) {
    if (r.voided_at) { results.push({ row_no: r.row_no, status: 'ALREADY_VOID' }); continue; }
    try {
      await People.voidEmployee(db, scope, user, r.created_user_id, { reason: `Void import: ${reason}` }, opts);
      results.push({ row_no: r.row_no, status: 'VOIDED' });
    } catch (error) {
      results.push({ row_no: r.row_no, status: 'KEPT', error: error.message });
    }
  }
  const kept = results.filter(r => r.status === 'KEPT').length;
  if (!kept) await db.query(`UPDATE employee_import_batches SET status = 'VOIDED' WHERE id = $1`, [batch.id]);
  return { batch_id: batch.id, voided: results.filter(r => r.status === 'VOIDED').length, kept, results };
}

async function listBatches(db, scope, { limit = 20 } = {}) {
  const { rows } = await db.query(`SELECT b.id, b.file_name, b.status, b.total_rows, b.valid_rows, b.warning_rows, b.error_rows,
      b.committed_rows, b.created_at, b.committed_at, u.nama AS created_by_name
    FROM employee_import_batches b LEFT JOIN users u ON u.id = b.created_by
    WHERE b.tenant_key = $1 AND b.project_key = $2 ORDER BY b.created_at DESC LIMIT $3`,
  [scope.tenantKey, scope.projectKey, Math.min(Number(limit) || 20, 100)]);
  return rows;
}

module.exports = {
  TEMPLATE_VERSION,
  COLUMNS,
  headerKey,
  mapHeaders,
  parseDate,
  digitsCell,
  splitPosisi,
  similarity,
  suggest,
  buildTemplate,
  readWorkbook,
  previewImport,
  applyMappings,
  commitImport,
  cancelImport,
  voidImport,
  listBatches,
};
