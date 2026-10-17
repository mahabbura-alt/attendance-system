'use strict';

/**
 * Trial agen LLM HSE — tes integrasi SQL nyata (PGlite) dengan klien LLM TIRUAN.
 * Tidak ada panggilan jaringan ke provider.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { available, createTestDb, readSql } = require('./helpers/pgliteDb');
const hse = require('../src/services/hse');
const hseAi = require('../src/services/hseAi');
const aiSettings = require('../src/ai/aiSettings');
const { runPending } = require('../src/ai/aiJobs');

const scope = { tenantKey: 'default', projectKey: 'default' };
const MIGRATIONS = ['migrations/073_hse_fase1_hazard_capa.sql', 'migrations/082_hse_setup_area_sub_area.sql',
  'migrations/083_hazard_consequence_and_reporter.sql', 'migrations/087_hse_hazard_categories_and_smart_merge.sql',
  'migrations/099_ai_foundation_hse.sql', 'migrations/102_hse_hazard_recommendation.sql'];
const AI_TABLES = ['ai_settings', 'ai_requests', 'ai_jobs', 'hse_ai_suggestions', 'hse_hazard_merge_log'];

function dataFromMessages(messages) {
  const text = messages[messages.length - 1].content;
  return JSON.parse(text.slice(text.indexOf('<data>') + 6, text.indexOf('</data>')));
}

/** Klien LLM tiruan: memutus berdasarkan kata kunci; mencatat prompt yang dikirim. */
function fakeClient(decide, { calls = [] } = {}) {
  return {
    calls,
    async chat({ messages, alias }) {
      calls.push({ messages, alias });
      const data = dataFromMessages(messages);
      return { content: JSON.stringify(decide(data)), model: 'fake-model', usage: { input: 1000, output: 200 }, latencyMs: 12 };
    },
    estimateCostUsd: u => (u.input + u.output) / 1e6,
    providerInfo: () => ({ provider: 'fake', models: { 'omos-standard': 'fake-model' } }),
  };
}

const dupDecider = data => ({
  hasil: data.kandidat.map(k => {
    const both = re => re.test(k.uraian) && re.test(data.laporan.uraian);
    if (/KM 4/i.test(k.uraian) || /KM 4/i.test(data.laporan.uraian)) return { ref: k.ref, putusan: 'TERKAIT', keyakinan: 0.8, alasan: 'Jenis sama, titik KM berbeda', bukti: ['KM 4'] };
    if (both(/kabel/i)) return { ref: k.ref, putusan: 'SAMA', keyakinan: 0.93, alasan: 'Kabel panel genset yang sama', bukti: ['kabel', 'panel genset'] };
    if (both(/lampu/i)) return { ref: k.ref, putusan: 'SAMA', keyakinan: 0.6, alasan: 'Mungkin sama', bukti: [] };
    return { ref: k.ref, putusan: 'BERBEDA', keyakinan: 0.9, alasan: 'Bahaya berbeda', bukti: [] };
  }).concat([{ ref: 'K99', putusan: 'SAMA', keyakinan: 1, alasan: 'karangan', bukti: [] }]),
});

async function seed(db) {
  const q = (s, p) => db.query(s, p);
  const user = async (nama, extra = {}) => (await q(`INSERT INTO users (nama, email, password_hash, role, is_super_admin, permissions)
    VALUES ($1,$2,'x',$3,$4,$5) RETURNING id, nama, role, is_super_admin, permissions`,
  [nama, `${nama.toLowerCase().replace(/\s/g, '')}@x.id`, extra.role || 'admin', extra.super === true, extra.perms || null])).rows[0];
  const superAdmin = await user('Admin Utama', { super: true });
  const officer = await user('Rina HSE', { perms: '["hse.merge"]' });
  const subAdmin = await user('Sub Admin');
  const karyawan = await user('Budi Santoso', { role: 'karyawan' });
  const area = (await q(`INSERT INTO hse_locations (tenant_key, project_key, code, name, type) VALUES ('default','default','T-WS','Workshop Uji','WORKSHOP') RETURNING id`)).rows[0].id;
  const sub1 = (await q(`INSERT INTO hse_locations (tenant_key, project_key, code, name, type, parent_id) VALUES ('default','default','T-WS-P','Panel Genset','WORKSHOP',$1) RETURNING id`, [area])).rows[0].id;
  const sub2 = (await q(`INSERT INTO hse_locations (tenant_key, project_key, code, name, type, parent_id) VALUES ('default','default','T-WS-B','Bay Servis','WORKSHOP',$1) RETURNING id`, [area])).rows[0].id;
  const pit = (await q(`INSERT INTO hse_locations (tenant_key, project_key, code, name, type) VALUES ('default','default','T-PIT1','Pit Uji','PIT') RETURNING id`)).rows[0].id;
  const u = { ...superAdmin, is_super_admin: true };
  const mk = (desc, loc, date = '2026-10-10', extra = {}) => hse.createHazard(db, scope, u, {
    description: desc, potential_consequence: extra.cons || 'Tersengat listrik', location_id: loc, report_date: date,
    likelihood: 3, consequence: 3, reported_by: karyawan.id,
  });
  return { superAdmin: u, officer, subAdmin, karyawan, area, sub1, sub2, pit, mk };
}

async function enableDuplicate(db, user, mode = 'ON') {
  return aiSettings.updateSettings(db, scope, user, { enabled: true, features: { hse_duplicate: mode, hse_triage: 'ON' } });
}

test('Migrasi 099: naik, idempoten, turun, naik lagi', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const tables = async () => new Set((await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`)).rows.map(r => r.table_name));
    await db.exec(readSql('migrations/099_ai_foundation_hse.sql'));
    AI_TABLES.forEach(t => assert.ok(true && t));
    let t = await tables();
    AI_TABLES.forEach(name => assert.ok(t.has(name), `${name} ada`));
    await db.exec(readSql('migrations/099_ai_foundation_hse_down.sql'));
    t = await tables();
    AI_TABLES.forEach(name => assert.ok(!t.has(name), `${name} terhapus`));
    const col = await db.query(`SELECT 1 FROM information_schema.columns WHERE table_name='hazard_reports' AND column_name='ai_clean_description'`);
    assert.equal(col.rows.length, 0);
    await db.exec(readSql('migrations/099_ai_foundation_hse.sql'));
    assert.ok((await tables()).has('hse_ai_suggestions'));
  } finally { await db.close(); }
});

test('Pengaturan AI: default MATI; hanya Admin Utama boleh mengubah; nilai divalidasi', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const s = await seed(db);
    const def = await aiSettings.getSettings(db, scope);
    assert.equal(def.enabled, false);
    assert.equal(aiSettings.featureMode(def, 'hse_duplicate'), 'OFF');
    await assert.rejects(aiSettings.updateSettings(db, scope, s.officer, { enabled: true }), /Admin Utama/);
    await assert.rejects(aiSettings.updateSettings(db, scope, s.superAdmin, { features: { hse_duplicate: 'MAYBE' } }), /tidak valid/);
    await assert.rejects(aiSettings.updateSettings(db, scope, s.superAdmin, { duplicate_min_confidence: 0.2 }), /Ambang/);
    const next = await enableDuplicate(db, s.superAdmin, 'SHADOW');
    assert.equal(aiSettings.featureMode(next, 'hse_duplicate'), 'SHADOW');
    // Tanpa tabel (migrasi belum jalan) → default, tidak error.
    const bare = await createTestDb(MIGRATIONS.slice(0, 4));
    try {
      const d = await aiSettings.getSettings(bare, scope);
      assert.equal(d.migrated, false);
      assert.equal(d.enabled, false);
    } finally { await bare.close(); }
  } finally { await db.close(); }
});

test('Fitur MATI: simpan hazard tidak membuat antrean dan tidak memanggil AI', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const s = await seed(db);
    const h = await s.mk('Kabel panel genset terkelupas', s.sub1);
    const r = await hseAi.afterHazardSaved(db, scope, h);
    assert.equal(r.queued, false);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM ai_jobs')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('Penyaring kandidat: terbuka, satu Area induk (Sub-Area berbeda tetap masuk), dalam jendela hari, pasangan ditolak dikecualikan', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const s = await seed(db);
    await enableDuplicate(db, s.superAdmin);
    const main = await s.mk('Kabel panel genset terkelupas', s.sub1);
    const sameArea = await s.mk('Panel genset kabelnya kelupas, bahaya setrum', s.sub2); // Sub-Area beda, Area sama
    const otherArea = await s.mk('Kabel genset kelupas', s.pit);
    const old = await s.mk('Kabel genset kelupas lama', s.sub1, '2026-08-01');
    const closed = await s.mk('Kabel genset kelupas sudah ditutup', s.sub1);
    await db.query(`UPDATE hazard_reports SET status='CLOSED' WHERE id=$1`, [closed.id]);
    const rejected = await s.mk('Kabel panel genset rusak', s.sub1);
    await hseAi.rejectDuplicate(db, scope, s.officer, { hazard_id: main.id, candidate_hazard_id: rejected.id, note: 'Panel berbeda' });

    const settings = await aiSettings.getSettings(db, scope);
    const hz = (await db.query(`SELECT h.*, COALESCE(l.parent_id,l.id) AS area_id FROM hazard_reports h JOIN hse_locations l ON l.id=h.location_id WHERE h.id=$1`, [main.id])).rows[0];
    const cands = await hseAi.findDuplicateCandidates(db, scope, hz, settings);
    const ids = cands.map(c => c.id);
    assert.ok(ids.includes(sameArea.id), 'Sub-Area berbeda di Area yang sama ikut dibandingkan (perbaikan K3)');
    assert.ok(!ids.includes(otherArea.id), 'Area lain tidak');
    assert.ok(!ids.includes(old.id), 'di luar 30 hari tidak');
    assert.ok(!ids.includes(closed.id), 'CLOSED tidak');
    assert.ok(!ids.includes(rejected.id), 'pasangan yang ditolak tidak disarankan lagi');
  } finally { await db.close(); }
});

test('Cek duplikat AI lewat antrean: data disensor, ref karangan dibuang, saran tersimpan, daftar memakai saran AI', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const s = await seed(db);
    await enableDuplicate(db, s.superAdmin, 'ON');
    const a = await s.mk('Kabel panel genset terkelupas, dilaporkan Pak Budi 0812-3456-7890', s.sub1);
    const b = await s.mk('Panel genset kabelnya kelupas, bahaya setrum', s.sub2);
    const c = await s.mk('Kabel genset terkelupas di bay KM 4', s.sub2);
    const d = await s.mk('Oli tumpah di lantai workshop', s.sub2);
    const calls = [];
    const client = fakeClient(dupDecider, { calls });

    for (const h of [a, b, c, d]) await hseAi.afterHazardSaved(db, scope, h);
    // Simpan ulang tanpa perubahan → tidak menambah antrean (idempoten).
    await hseAi.afterHazardSaved(db, scope, a);
    assert.equal((await db.query('SELECT COUNT(*)::int n FROM ai_jobs')).rows[0].n, 4);

    const res = await runPending(db, { [hseAi.DUP_AGENT_ID]: (dbx, job) => hseAi.duplicateJobHandler(dbx, job, { client }) }, { limit: 10 });
    assert.equal(res.processed, 4);
    assert.ok(calls.length >= 1);

    // Data pribadi tidak terkirim; ID asli tidak terkirim.
    const sent = calls.map(cl => cl.messages.map(m => m.content).join('\n')).join('\n');
    assert.ok(!/Budi/.test(sent), 'nama pelapor tersensor');
    assert.ok(!/0812/.test(sent), 'nomor HP tersensor');
    assert.ok(!sent.includes(a.id) && !sent.includes(b.id), 'UUID laporan tidak dikirim');
    assert.ok(calls.every(cl => cl.alias === 'omos-standard'));

    const sugg = (await db.query(`SELECT * FROM hse_ai_suggestions WHERE kind='DUPLICATE'`)).rows;
    assert.ok(sugg.length >= 2);
    assert.ok(sugg.every(x => x.engine === 'LLM' && x.mode === 'ON'));
    const audit = (await db.query(`SELECT status, input_tokens, payload_sha256 FROM ai_requests`)).rows;
    assert.ok(audit.length >= 1 && audit.every(r => r.status === 'OK' && r.payload_sha256.length === 64));

    // Daftar hazard: pasangan a–b tampil sebagai SAMA dari AI; c tampil sebagai TERKAIT.
    const rows = await hse.listHazards(db, scope, {});
    await hseAi.decorateHazards(db, scope, rows);
    const ra = rows.find(r => r.id === a.id);
    assert.equal(ra.ai_duplicate.mode, 'ON');
    assert.ok(ra.similar_hazards.some(x => x.id === b.id && x.engine === 'LLM' && x.verdict === 'SAMA' && x.reason));
    assert.ok(ra.related_hazards.some(x => x.id === c.id && x.verdict === 'TERKAIT'));
    assert.ok(!ra.similar_hazards.some(x => x.id === d.id), 'BERBEDA tidak ditampilkan');
    const rb = rows.find(r => r.id === b.id);
    assert.ok(rb.similar_hazards.some(x => x.id === a.id), 'saran tampil di kedua laporan');
  } finally { await db.close(); }
});

test('Mode Uji diam-diam: saran AI disimpan tetapi tampilan tetap memakai mesin lama', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const s = await seed(db);
    await enableDuplicate(db, s.superAdmin, 'SHADOW');
    const a = await s.mk('Kabel panel genset terkelupas', s.sub1);
    const b = await s.mk('Kabel panel genset terkelupas parah', s.sub1);
    const client = fakeClient(dupDecider);
    await hseAi.runDuplicateCheck(db, scope, b.id, { client });
    const sugg = (await db.query(`SELECT mode FROM hse_ai_suggestions`)).rows;
    assert.ok(sugg.length >= 1 && sugg.every(x => x.mode === 'SHADOW'));
    const rows = await hse.listHazards(db, scope, {});
    await hseAi.decorateHazards(db, scope, rows);
    const ra = rows.find(r => r.id === a.id);
    assert.ok(ra.similar_hazards.every(x => x.engine === 'RULE'));
    assert.equal(ra.related_hazards.length, 0);
    const report = await hseAi.getShadowReport(db, scope, s.superAdmin, {});
    assert.ok(report.summary.pairs >= 1);
  } finally { await db.close(); }
});

test('Keyakinan SAMA di bawah ambang ditampilkan sebagai TERKAIT, bukan saran gabung', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const s = await seed(db);
    await enableDuplicate(db, s.superAdmin, 'ON');
    const a = await s.mk('Lampu tower LT-05 mati', s.sub1, '2026-10-10', { cons: 'Area gelap' });
    const b = await s.mk('Penerangan lampu area loading gelap', s.sub1, '2026-10-10', { cons: 'Area gelap' });
    await hseAi.runDuplicateCheck(db, scope, b.id, { client: fakeClient(dupDecider) });
    const detail = await hse.getHazardDetail(db, scope, a.id);
    await hseAi.decorateHazards(db, scope, [detail]);
    assert.equal(detail.similar_hazards.length, 0);
    assert.equal(detail.related_hazards[0].verdict, 'TERKAIT');
    assert.equal(detail.related_hazards[0].raw_verdict, 'SAMA');
  } finally { await db.close(); }
});

test('Provider gagal / belum dikonfigurasi / kuota habis: laporan tetap tersimpan, antrean tidak macet', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const s = await seed(db);
    await enableDuplicate(db, s.superAdmin, 'ON');
    await s.mk('Kabel panel genset terkelupas', s.sub1);
    const b = await s.mk('Kabel panel genset terkelupas lagi', s.sub1);
    const { LlmError } = require('../src/ai/llmClient');
    const down = { chat: async () => { throw new LlmError('TIMEOUT', 'x'); }, providerInfo: () => ({ provider: 'fake', models: {} }) };
    const r1 = await hseAi.runDuplicateCheck(db, scope, b.id, { client: down });
    assert.equal(r1.status, 'RETRY');
    const off = { chat: async () => { throw new LlmError('NOT_CONFIGURED', 'x'); }, providerInfo: () => ({ provider: 'fake', models: {} }) };
    const r2 = await hseAi.runDuplicateCheck(db, scope, b.id, { client: off });
    assert.equal(r2.status, 'SKIPPED');
    await aiSettings.updateSettings(db, scope, s.superAdmin, { daily_call_limit: 0 });
    const r3 = await hseAi.runDuplicateCheck(db, scope, b.id, { client: fakeClient(dupDecider) });
    assert.equal(r3.status, 'SKIPPED');
    assert.equal(r3.summary.reason, 'BUDGET_BLOCKED');
    const st = (await db.query(`SELECT status FROM ai_requests ORDER BY created_at`)).rows.map(r => r.status);
    assert.deepEqual(st, ['TIMEOUT', 'NOT_CONFIGURED', 'BUDGET_BLOCKED']);
    // Keluaran rusak dua kali → INVALID_OUTPUT, tanpa saran.
    await aiSettings.updateSettings(db, scope, s.superAdmin, { daily_call_limit: 300 });
    const junk = { chat: async () => ({ content: 'maaf saya tidak bisa', usage: { input: 1, output: 1 }, latencyMs: 1 }), providerInfo: () => ({ provider: 'fake', models: {} }) };
    const r4 = await hseAi.runDuplicateCheck(db, scope, b.id, { client: junk });
    assert.equal(r4.status, 'FAILED');
    assert.equal((await db.query(`SELECT COUNT(*)::int n FROM hse_ai_suggestions`)).rows[0].n, 0);
  } finally { await db.close(); }
});

test('Gabung: wajib izin hse.merge & alasan, laporan utama harus terbuka, tercatat di log, saran ditandai ACCEPTED', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const s = await seed(db);
    await enableDuplicate(db, s.superAdmin, 'ON');
    const a = await s.mk('Kabel panel genset terkelupas', s.sub1);
    const b = await s.mk('Panel genset kabelnya kelupas', s.sub1);
    const c = await s.mk('Kabel panel genset kelupas (sudah ditutup)', s.sub1);
    await hseAi.runDuplicateCheck(db, scope, b.id, { client: fakeClient(dupDecider) });
    const sugg = (await db.query(`SELECT id FROM hse_ai_suggestions WHERE hazard_id=$1 AND candidate_hazard_id=$2`, [b.id, a.id])).rows[0];

    await assert.rejects(hse.mergeSimilarHazards(db, scope, s.subAdmin, a.id, b.id, { reason: 'sama' }), /hse\.merge/);
    await assert.rejects(hse.mergeSimilarHazards(db, scope, s.karyawan, a.id, b.id, { reason: 'sama' }), /hse\.merge/);
    await assert.rejects(hse.mergeSimilarHazards(db, scope, s.officer, a.id, b.id, {}), /Alasan/);
    await db.query(`UPDATE hazard_reports SET status='CLOSED' WHERE id=$1`, [c.id]);
    await assert.rejects(hse.mergeSimilarHazards(db, scope, s.officer, c.id, b.id, { reason: 'sama' }), /terbuka/);

    const merged = await hse.mergeSimilarHazards(db, scope, s.officer, a.id, b.id, { reason: 'Kabel panel yang sama', suggestion_id: sugg.id });
    assert.equal(merged.reporter_count, 2);
    const log = (await db.query(`SELECT * FROM hse_hazard_merge_log`)).rows;
    assert.equal(log.length, 1);
    assert.equal(log[0].reason, 'Kabel panel yang sama');
    assert.equal(log[0].engine, 'LLM');
    assert.equal(String(log[0].merged_by), String(s.officer.id));
    const st = (await db.query(`SELECT status, decision_note FROM hse_ai_suggestions WHERE id=$1`, [sugg.id])).rows[0];
    assert.equal(st.status, 'ACCEPTED');
    // Sudah DUPLICATE → tidak bisa digabung lagi.
    await assert.rejects(hse.mergeSimilarHazards(db, scope, s.officer, a.id, b.id, { reason: 'lagi' }), /sudah digabung|tidak bisa/);
  } finally { await db.close(); }
});

test('Bukan duplikat: wajib alasan, pasangan mesin lama juga tercatat & disembunyikan dari daftar', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const s = await seed(db);
    const a = await s.mk('Jalan hauling licin berlumpur tebal setelah hujan lebat', s.sub1, '2026-10-10', { cons: 'Unit slip' });
    const b = await s.mk('Jalur hauling berlumpur dan licin pasca hujan, perlu grading', s.sub1, '2026-10-10', { cons: 'DT tergelincir' });
    let rows = await hse.listHazards(db, scope, {});
    await hseAi.decorateHazards(db, scope, rows);
    const before = rows.find(r => r.id === a.id);
    assert.ok(before.similar_hazards.some(x => x.id === b.id && x.engine === 'RULE'), 'mesin lama mendeteksi pasangan');
    await assert.rejects(hseAi.rejectDuplicate(db, scope, s.officer, { hazard_id: a.id, candidate_hazard_id: b.id }), /Alasan/);
    await assert.rejects(hseAi.rejectDuplicate(db, scope, s.subAdmin, { hazard_id: a.id, candidate_hazard_id: b.id, note: 'beda ruas' }), /hse\.merge/);
    await hseAi.rejectDuplicate(db, scope, s.officer, { hazard_id: a.id, candidate_hazard_id: b.id, note: 'Ruas jalan berbeda' });
    rows = await hse.listHazards(db, scope, {});
    await hseAi.decorateHazards(db, scope, rows);
    assert.ok(!rows.find(r => r.id === a.id).similar_hazards.some(x => x.id === b.id));
    const rec = (await db.query(`SELECT engine, status, decision_note FROM hse_ai_suggestions`)).rows[0];
    assert.deepEqual([rec.engine, rec.status, rec.decision_note], ['RULE', 'REJECTED', 'Ruas jalan berbeda']);
  } finally { await db.close(); }
});

test('Triase AI: risiko dihitung calculateRisk (bukan AI), kategori dipetakan, saran tersimpan, uraian asli tidak berubah', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const s = await seed(db);
    const triageDecider = data => {
      assert.ok(data.matriks.kemungkinan.length === 5 && data.matriks.akibat.length === 5, 'matriks dikirim dari konfigurasi');
      return {
        kategori: { kode: 'UNSAFE_CONDITION', alasan: 'Kerusakan alat' },
        kemungkinan: { nilai: 4, alasan: 'Panel dipakai tiap shift' },
        akibat: { nilai: 5, alasan: 'Potensi fatal tersengat listrik' },
        tindakan_segera: [{ hierarki: 'REKAYASA', uraian: 'Isolasi panel & pasang LOTO' }, { hierarki: 'XYZ', uraian: 'diabaikan' }],
        pertanyaan_kelengkapan: ['Nomor panel?'],
        uraian_rapi: 'Kabel pada panel genset workshop terkelupas.',
        skor: 99,
      };
    };
    await assert.rejects(hseAi.triageHazard(db, scope, s.superAdmin, { description: 'Kabel panel genset terkelupas' }, { client: fakeClient(triageDecider) }), /dimatikan/);
    await enableDuplicate(db, s.superAdmin, 'ON');
    await assert.rejects(hseAi.triageHazard(db, scope, s.karyawan, { description: 'Kabel panel genset terkelupas' }, { client: fakeClient(triageDecider) }), /admin/);
    await assert.rejects(hseAi.triageHazard(db, scope, s.officer, { description: 'pendek' }, { client: fakeClient(triageDecider) }), /minimal 10/);

    const r = await hseAi.triageHazard(db, scope, s.officer, { description: 'Kabel panel genset terkelupas', location_id: s.sub1 }, { client: fakeClient(triageDecider) });
    assert.deepEqual(r.risk, hse.calculateRisk(4, 5));
    assert.equal(r.risk.riskLevel, 'EXTREME');
    assert.equal(r.category.code, 'UNSAFE_CONDITION');
    assert.ok(r.category_id, 'kategori dipetakan ke master');
    assert.equal(r.immediate_actions.length, 1, 'hierarki tidak dikenal dibuang');
    assert.equal(r.label, 'Saran AI — perlu dicek');
    assert.ok(!('skor' in r));

    const decided = await hseAi.decideSuggestion(db, scope, s.officer, r.suggestion_id, { decision: 'ACCEPTED', applied: ['kategori', 'risiko'] });
    assert.equal(decided.status, 'ACCEPTED');
    await assert.rejects(hseAi.decideSuggestion(db, scope, s.officer, r.suggestion_id, { decision: 'ACCEPTED' }), /sudah diputuskan/);

    const h = await s.mk('Kabel panel genset terkelupas asli pelapor', s.sub1);
    await hseAi.saveCleanDescription(db, scope, s.officer, h.id, { text: 'Uraian rapi' });
    const row = (await db.query(`SELECT description, ai_clean_description FROM hazard_reports WHERE id=$1`, [h.id])).rows[0];
    assert.equal(row.description, 'Kabel panel genset terkelupas asli pelapor');
    assert.equal(row.ai_clean_description, 'Uraian rapi');
  } finally { await db.close(); }
});

test('Ringkasan Asisten AI: status server tanpa key, pemakaian, izin', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  try {
    const s = await seed(db);
    const ov = await hseAi.getAiOverview(db, scope, s.officer);
    assert.equal(ov.can_edit, false);
    assert.equal(ov.can_merge, true);
    assert.equal(ov.server.key_present === true || ov.server.key_present === false, true);
    assert.ok(!JSON.stringify(ov).match(/nvapi-|Bearer/));
    await assert.rejects(hseAi.getAiOverview(db, scope, s.karyawan), /admin/);
    await assert.rejects(hseAi.recheckOpenHazards(db, scope, s.officer), /Admin Utama/);
  } finally { await db.close(); }
});
