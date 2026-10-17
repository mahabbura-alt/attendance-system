'use strict';

/**
 * Katalog tool Tanya OMOS — SEMUA HANYA-BACA.
 * Setiap tool memanggil fungsi servis HSE yang sama dengan halaman HSE (angka di jawaban = angka di layar),
 * lalu meringkas hasilnya. Tidak ada SQL bebas dan tidak ada jalur tulis.
 * Fungsi yang boleh dipanggil didaftar eksplisit di READ_ONLY_FUNCTIONS; tes memastikan tidak ada create/update/delete.
 */

const hse = require('../../services/hse');
const hseWorkhours = require('../../services/hseWorkhours');
const { compactValue } = require('./compact');

const READ_ONLY_FUNCTIONS = Object.freeze({
  getOverview: hse.getOverview,
  listHazards: hse.listHazards,
  listActions: hse.listActions,
  listIncidents: hse.listIncidents,
  getSafetyReports: hse.getSafetyReports,
  listManhours: hse.listManhours,
  getWorkhourRecap: hseWorkhours.getWorkhourRecap,
  getCompetencyOverview: hse.getCompetencyOverview,
  listEmployeeLicenses: hse.listEmployeeLicenses,
  getTrainingMatrix: hse.getTrainingMatrix,
  listInductions: hse.listInductions,
  getPtwOverview: hse.getPtwOverview,
  listPermits: hse.listPermits,
  getInspectionMandateOverview: hse.getInspectionMandateOverview,
  listInspectionTemplates: hse.listInspectionTemplates,
  listInspections: hse.listInspections,
  getHazardReportMandateOverview: hse.getHazardReportMandateOverview,
  listP5mEvents: hse.listP5mEvents,
  listSafetytalkEvents: hse.listSafetytalkEvents,
});

const MAX_RANGE_MONTHS = 25;
const DAY = 86400000;

/* ----------------------------------------------------------- validasi arg */

function argError(message) {
  const e = new Error(message);
  e.code = 'BAD_ARGS';
  return e;
}

const isoDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const isoMonth = v => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

function cleanArgs(spec, raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const [name, def] of Object.entries(spec)) {
    let v = src[name];
    if (v === undefined || v === null || v === '') continue;
    switch (def.type) {
      case 'date':
        if (!isoDate(v)) throw argError(`${name} harus tanggal YYYY-MM-DD`);
        break;
      case 'month':
        if (!isoMonth(v)) throw argError(`${name} harus bulan YYYY-MM`);
        break;
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < (def.min ?? 0) || n > (def.max ?? 1000)) throw argError(`${name} harus bilangan bulat ${def.min ?? 0}–${def.max ?? 1000}`);
        v = n;
        break;
      }
      case 'bool':
        v = v === true || v === 'true';
        break;
      case 'enum':
        v = String(v).trim().toUpperCase();
        if (!def.values.includes(v)) throw argError(`${name} harus salah satu dari: ${def.values.join(', ')}`);
        break;
      case 'code': // kode status/jenis: huruf besar/angka/garis bawah
        v = String(v).trim().toUpperCase().replace(/\s+/g, '_');
        if (!/^[A-Z0-9_]{2,40}$/.test(v)) throw argError(`${name} tidak valid`);
        break;
      case 'text':
        v = String(v).trim().slice(0, def.max || 60);
        if (!v) continue;
        break;
      default:
        throw argError(`tipe argumen ${name} tidak dikenal`);
    }
    out[name] = v;
  }
  return out;
}

function checkRange(a, fromKey, toKey) {
  if (a[fromKey] && a[toKey] && a[fromKey] > a[toKey]) throw argError(`${fromKey} tidak boleh setelah ${toKey}`);
  const f = a[fromKey]; const t = a[toKey];
  if (f && t) {
    const months = (Date.parse(String(t).slice(0, 10)) - Date.parse(String(f).slice(0, 10))) / DAY / 30.4;
    if (months > MAX_RANGE_MONTHS) throw argError(`rentang maksimal ${MAX_RANGE_MONTHS} bulan`);
  }
}

/* ----------------------------------------------------------- util data */

const d10 = v => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : null);
const lc = v => String(v || '').toLowerCase();
const inRange = (value, from, to) => {
  const d = d10(value);
  if (!d) return !from && !to;
  return (!from || d >= from) && (!to || d <= to);
};
const countBy = (rows, fn) => {
  const m = {};
  for (const r of rows) { const k = fn(r) || 'Tidak diisi'; m[k] = (m[k] || 0) + 1; }
  return m;
};
const slim = (s, n = 160) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const limitOf = a => Math.min(a.limit || 10, 20);

/* ----------------------------------------------------------- tool */

const DATE_ARGS = {
  dari: { type: 'date', desc: 'Tanggal awal YYYY-MM-DD (opsional)' },
  sampai: { type: 'date', desc: 'Tanggal akhir YYYY-MM-DD (opsional)' },
};

const TOOLS = {
  ringkasan_hse: {
    desc: 'Gambaran umum HSE: angka utama beranda HSE (hari tanpa LTI, LTIFR, TRIR, near miss bulan ini, hazard & CAPA terbuka, dst).',
    page: 'overview',
    params: {},
    async run({ db, scope, ctx }) {
      return compactValue(await READ_ONLY_FUNCTIONS.getOverview(db, scope), ctx, { maxItems: 8 });
    },
  },

  hazard: {
    desc: 'Laporan hazard: jumlah & rincian per status, tingkat risiko, area/lokasi, kategori; bisa difilter periode (tanggal laporan) dan daftar contoh laporan.',
    page: 'hazards',
    params: {
      status: { type: 'code', desc: 'mis. OPEN, IN_PROGRESS, CLOSED (opsional)' },
      risk_level: { type: 'code', desc: 'mis. LOW, MEDIUM, HIGH, EXTREME (opsional)' },
      lokasi: { type: 'text', desc: 'Sebagian nama area/lokasi, mis. "Workshop" (opsional)' },
      kategori: { type: 'text', desc: 'Sebagian nama kategori (opsional)' },
      ...DATE_ARGS,
      tampilkan_daftar: { type: 'bool', desc: 'true bila perlu daftar laporan' },
      limit: { type: 'int', min: 1, max: 20, desc: 'Maks baris daftar (default 10)' },
    },
    async run({ db, scope, ctx, args }) {
      checkRange(args, 'dari', 'sampai');
      let rows = await READ_ONLY_FUNCTIONS.listHazards(db, scope, { status: args.status, risk_level: args.risk_level });
      rows = rows.filter(r => !r.merged_into_id && inRange(r.report_date, args.dari, args.sampai));
      if (args.lokasi) rows = rows.filter(r => lc(`${r.area_name} ${r.sub_area_name} ${r.location_name}`).includes(lc(args.lokasi)));
      if (args.kategori) rows = rows.filter(r => lc(r.category_name).includes(lc(args.kategori)));
      const out = {
        filter: { ...args },
        total: rows.length,
        per_status: countBy(rows, r => r.status),
        per_risiko: countBy(rows, r => r.risk_level),
        per_area: countBy(rows, r => r.area_name),
        per_kategori: countBy(rows, r => r.category_name),
      };
      if (args.tampilkan_daftar) {
        out.daftar = rows.slice(0, limitOf(args)).map(r => ({
          no: r.report_no, tanggal: d10(r.report_date), lokasi: r.location_name, kategori: r.category_name,
          risiko: r.risk_level, status: r.status, uraian: slim(r.description),
          pelapor: r.reported_by_name ? ctx.aliaser.alias(r.reported_by_name) : null,
        }));
        out.daftar_ditampilkan = out.daftar.length;
      }
      return out;
    },
  },

  tindakan_capa: {
    desc: 'Tindakan perbaikan/CAPA: jumlah per status, yang terlambat (lewat tenggat), daftar contoh.',
    page: 'actions',
    params: {
      status: { type: 'code', desc: 'mis. OPEN, IN_PROGRESS, CLOSED (opsional)' },
      terlambat: { type: 'bool', desc: 'true = hanya yang melewati tenggat' },
      tenggat_dari: { type: 'date', desc: 'Tenggat mulai (opsional)' },
      tenggat_sampai: { type: 'date', desc: 'Tenggat sampai (opsional)' },
      limit: { type: 'int', min: 1, max: 20, desc: 'Maks baris daftar' },
    },
    async run({ db, scope, ctx, args }) {
      checkRange(args, 'tenggat_dari', 'tenggat_sampai');
      let rows = await READ_ONLY_FUNCTIONS.listActions(db, scope, { status: args.status, overdue: args.terlambat ? true : undefined });
      rows = rows.filter(r => inRange(r.due_date, args.tenggat_dari, args.tenggat_sampai));
      return {
        filter: { ...args },
        total: rows.length,
        terlambat: rows.filter(r => r.is_overdue).length,
        per_status: countBy(rows, r => r.status),
        daftar: rows.slice(0, limitOf(args)).map(r => ({
          no: r.action_no, uraian: slim(r.description), status: r.status, tenggat: d10(r.due_date), terlambat: Boolean(r.is_overdue),
          pic: r.pic_name ? ctx.aliaser.alias(r.pic_name) : null,
        })),
      };
    },
  },

  insiden: {
    desc: 'Insiden/kecelakaan: jumlah per jenis (FATALITY, LTI, MTI, FAI, NEAR_MISS, PROPERTY_DAMAGE), status, tingkat keparahan, lokasi; hari hilang.',
    page: 'incidents',
    params: {
      incident_type: { type: 'code', desc: 'mis. LTI, NEAR_MISS (opsional)' },
      status: { type: 'code', desc: 'status laporan (opsional)' },
      lokasi: { type: 'text', desc: 'Sebagian nama lokasi (opsional)' },
      ...DATE_ARGS,
      tampilkan_daftar: { type: 'bool', desc: 'true bila perlu daftar' },
      limit: { type: 'int', min: 1, max: 20, desc: 'Maks baris daftar' },
    },
    async run({ db, scope, args }) {
      checkRange(args, 'dari', 'sampai');
      let rows = await READ_ONLY_FUNCTIONS.listIncidents(db, scope, { incident_type: args.incident_type, status: args.status });
      rows = rows.filter(r => inRange(r.occurred_at, args.dari, args.sampai));
      if (args.lokasi) rows = rows.filter(r => lc(r.location_name).includes(lc(args.lokasi)));
      const out = {
        filter: { ...args },
        total: rows.length,
        per_jenis: countBy(rows, r => r.incident_type),
        per_status: countBy(rows, r => r.status),
        per_keparahan: countBy(rows, r => r.actual_severity),
        per_lokasi: countBy(rows, r => r.location_name),
        total_hari_hilang: rows.reduce((s, r) => s + (Number(r.total_lost_days) || 0), 0),
      };
      if (args.tampilkan_daftar) {
        out.daftar = rows.slice(0, limitOf(args)).map(r => ({
          no: r.incident_no, tanggal: d10(r.occurred_at), jenis: r.incident_type, lokasi: r.location_name,
          keparahan: r.actual_severity, status: r.status, uraian: slim(r.description),
        }));
      }
      return out;
    },
  },

  kpi_keselamatan: {
    desc: 'Statistik keselamatan bulanan 12 bulan terakhir: jam kerja, LTI, LTIFR, TRIR, hari hilang, tingkat keparahan; ringkasan YTD & 12 bulan bergulir; sebaran insiden per jenis & lokasi.',
    page: 'reports',
    params: {
      bulan_dari: { type: 'month', desc: 'Bulan awal YYYY-MM (opsional)' },
      bulan_sampai: { type: 'month', desc: 'Bulan akhir YYYY-MM (opsional)' },
    },
    async run({ db, scope, ctx, args }) {
      const rep = await READ_ONLY_FUNCTIONS.getSafetyReports(db, scope, {});
      const months = (rep.monthlyStatistics || []).filter(m => (!args.bulan_dari || m.monthKey >= args.bulan_dari) && (!args.bulan_sampai || m.monthKey <= args.bulan_sampai));
      return compactValue({
        filter: { ...args },
        bulanan: months,
        ringkasan: rep.summary,
        faktor_tingkat: rep.rateFactor,
        sumber_jam_kerja: rep.hoursSource,
        sebaran_jenis: rep.categoryBreakdown,
        sebaran_lokasi: rep.locationBreakdown,
      }, ctx, { maxItems: 14 });
    },
  },

  jam_kerja: {
    desc: 'Jam kerja (man-hours): data per bulan untuk satu tahun, atau rekap jam kerja karyawan satu bulan.',
    page: 'workhours',
    params: {
      tahun: { type: 'int', min: 2020, max: 2100, desc: 'Tahun untuk jam kerja bulanan' },
      bulan: { type: 'month', desc: 'Bulan YYYY-MM untuk rekap per karyawan/departemen' },
    },
    async run({ db, scope, ctx, args }) {
      if (args.bulan) {
        return compactValue(await READ_ONLY_FUNCTIONS.getWorkhourRecap(db, scope, { month: args.bulan }), ctx, { maxItems: 15 });
      }
      const rows = await READ_ONLY_FUNCTIONS.listManhours(db, scope, args.tahun ? { year: args.tahun } : {});
      return compactValue({ filter: { ...args }, bulanan: rows }, ctx, { maxItems: 14 });
    },
  },

  kompetensi: {
    desc: 'Kompetensi: ringkasan, lisensi/SIMPER (hampir/sudah kedaluwarsa), matriks pelatihan, induksi.',
    page: 'competency',
    params: {
      jenis: { type: 'enum', values: ['RINGKASAN', 'LISENSI', 'MATRIKS', 'INDUKSI'], desc: 'RINGKASAN | LISENSI | MATRIKS | INDUKSI' },
      status: { type: 'code', desc: 'status lisensi, mis. VALID, EXPIRING, EXPIRED (opsional)' },
      license_type: { type: 'text', desc: 'jenis lisensi (opsional)' },
    },
    async run({ db, scope, ctx, args }) {
      const kind = args.jenis || 'RINGKASAN';
      if (kind === 'LISENSI') {
        const rows = await READ_ONLY_FUNCTIONS.listEmployeeLicenses(db, scope, { status: args.status, license_type: args.license_type });
        return { total: rows.length, per_status: countBy(rows, r => r.status), contoh: compactValue(rows.slice(0, 10), ctx) };
      }
      if (kind === 'MATRIKS') return compactValue(await READ_ONLY_FUNCTIONS.getTrainingMatrix(db, scope), ctx, { maxItems: 12 });
      if (kind === 'INDUKSI') {
        const rows = await READ_ONLY_FUNCTIONS.listInductions(db, scope, {});
        return { total: rows.length, per_hasil: countBy(rows, r => r.result), contoh: compactValue(rows.slice(0, 10), ctx) };
      }
      return compactValue(await READ_ONLY_FUNCTIONS.getCompetencyOverview(db, scope), ctx, { maxItems: 10 });
    },
  },

  izin_kerja_ptw: {
    desc: 'Izin kerja (PTW): ringkasan dan daftar izin per status/jenis/lokasi.',
    page: 'ptw',
    params: {
      jenis: { type: 'enum', values: ['RINGKASAN', 'DAFTAR'], desc: 'RINGKASAN | DAFTAR' },
      status: { type: 'code', desc: 'status izin (opsional)' },
      permit_type: { type: 'code', desc: 'jenis izin (opsional)' },
    },
    async run({ db, scope, ctx, args }) {
      if ((args.jenis || 'RINGKASAN') === 'DAFTAR') {
        const rows = await READ_ONLY_FUNCTIONS.listPermits(db, scope, { status: args.status, permit_type: args.permit_type });
        return { total: rows.length, per_status: countBy(rows, r => r.status), contoh: compactValue(rows.slice(0, 10), ctx) };
      }
      return compactValue(await READ_ONLY_FUNCTIONS.getPtwOverview(db, scope, { status: args.status, permit_type: args.permit_type }), ctx, { maxItems: 10 });
    },
  },

  inspeksi: {
    desc: 'Inspeksi: capaian mandat/target inspeksi, daftar template, inspeksi yang sudah dilakukan.',
    page: 'inspections',
    params: {
      jenis: { type: 'enum', values: ['MANDAT', 'TEMPLATE', 'TERLAKSANA'], desc: 'MANDAT | TEMPLATE | TERLAKSANA' },
      date: { type: 'date', desc: 'Tanggal acuan siklus (opsional)' },
      cycle: { type: 'code', desc: 'siklus, mis. DAILY, WEEKLY, MONTHLY (opsional)' },
    },
    async run({ db, scope, ctx, args }) {
      const kind = args.jenis || 'MANDAT';
      if (kind === 'TEMPLATE') {
        const rows = await READ_ONLY_FUNCTIONS.listInspectionTemplates(db, scope, {});
        return { total: rows.length, contoh: compactValue(rows.slice(0, 12), ctx) };
      }
      if (kind === 'TERLAKSANA') {
        const rows = await READ_ONLY_FUNCTIONS.listInspections(db, scope, {});
        return { total: rows.length, contoh: compactValue(rows.slice(0, 12), ctx) };
      }
      return compactValue(await READ_ONLY_FUNCTIONS.getInspectionMandateOverview(db, scope, { date: args.date, cycle: args.cycle }), ctx, { maxItems: 12 });
    },
  },

  mandat_hazard: {
    desc: 'Capaian target pelaporan hazard per orang/departemen pada siklus tertentu.',
    page: 'hazard-targets',
    params: {
      date: { type: 'date', desc: 'Tanggal acuan siklus (opsional)' },
      cycle: { type: 'code', desc: 'siklus (opsional)' },
    },
    async run({ db, scope, ctx, args }) {
      return compactValue(await READ_ONLY_FUNCTIONS.getHazardReportMandateOverview(db, scope, { date: args.date, cycle: args.cycle }), ctx, { maxItems: 12 });
    },
  },

  agenda_event: {
    desc: 'Agenda & kegiatan HSE: P5M dan Safety Talk dalam rentang tanggal.',
    page: 'events',
    params: {
      jenis: { type: 'enum', values: ['SEMUA', 'P5M', 'SAFETYTALK'], desc: 'SEMUA | P5M | SAFETYTALK (default SEMUA)' },
      ...DATE_ARGS,
      kata_kunci: { type: 'text', desc: 'kata kunci (opsional)' },
    },
    async run({ db, scope, ctx, args }) {
      checkRange(args, 'dari', 'sampai');
      const q = { date_from: args.dari, date_to: args.sampai, search: args.kata_kunci };
      const kind = args.jenis || 'SEMUA';
      const out = { filter: { ...args } };
      if (kind === 'SEMUA' || kind === 'P5M') {
        const rows = await READ_ONLY_FUNCTIONS.listP5mEvents(db, scope, q);
        out.p5m = { total: rows.length, contoh: compactValue(rows.slice(0, 10), ctx) };
      }
      if (kind === 'SEMUA' || kind === 'SAFETYTALK') {
        const rows = await READ_ONLY_FUNCTIONS.listSafetytalkEvents(db, scope, q);
        out.safetytalk = { total: rows.length, contoh: compactValue(rows.slice(0, 10), ctx) };
      }
      return out;
    },
  },
};

/* ----------------------------------------------------------- API */

function toolNames() {
  return Object.keys(TOOLS);
}

/** Katalog ringkas untuk prompt perencana. */
function toolCatalog() {
  return Object.entries(TOOLS).map(([nama, t]) => ({
    nama,
    fungsi: t.desc,
    argumen: Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, `${d.type}${d.values ? `(${d.values.join('|')})` : ''} — ${d.desc}`])),
  }));
}

function pageOf(name) {
  return TOOLS[name]?.page || null;
}

async function runTool(name, rawArgs, { db, scope, ctx, cache = null, ttlMs = 60000 }) {
  const tool = TOOLS[name];
  if (!tool) throw argError(`Tool tidak dikenal: ${name}`);
  const args = cleanArgs(tool.params, rawArgs);
  const key = `${scope.tenantKey}|${scope.projectKey}|${name}|${JSON.stringify(args)}`;
  if (cache) {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) {
      // Salin dalam bentuk teks lalu parse: alias orang dihitung ulang per permintaan.
      return { args, data: hit.data, cached: true, aliases: hit.aliases };
    }
  }
  const data = await tool.run({ db, scope, ctx, args });
  const aliases = ctx.aliaser.names();
  if (cache) cache.set(key, { exp: Date.now() + ttlMs, data, aliases });
  return { args, data, cached: false, aliases };
}

module.exports = { TOOLS, READ_ONLY_FUNCTIONS, toolNames, toolCatalog, pageOf, runTool, cleanArgs, MAX_RANGE_MONTHS };
