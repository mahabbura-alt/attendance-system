'use strict';

/** HTTP: rute HSE + Asisten AI dengan DB PGlite nyata, auth tiruan, dan klien LLM tiruan. */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { available, createTestDb } = require('./helpers/pgliteDb');

const MIGRATIONS = ['migrations/073_hse_fase1_hazard_capa.sql', 'migrations/082_hse_setup_area_sub_area.sql',
  'migrations/083_hazard_consequence_and_reporter.sql', 'migrations/087_hse_hazard_categories_and_smart_merge.sql',
  'migrations/099_ai_foundation_hse.sql', 'migrations/102_hse_hazard_recommendation.sql'];

function fakeLlm() {
  return {
    async chat({ messages }) {
      const text = messages[messages.length - 1].content;
      const data = JSON.parse(text.slice(text.indexOf('<data>') + 6, text.indexOf('</data>')));
      const out = data.kandidat
        ? { hasil: data.kandidat.map(k => ({ ref: k.ref, putusan: 'SAMA', keyakinan: 0.9, alasan: 'Objek & titik sama', bukti: ['kabel'] })) }
        : { kategori: { kode: 'UNSAFE_CONDITION', alasan: 'Alat rusak' }, kemungkinan: { nilai: 3, alasan: 'a' }, akibat: { nilai: 4, alasan: 'b' },
          tindakan_segera: [{ hierarki: 'REKAYASA', uraian: 'Isolasi panel' }], pertanyaan_kelengkapan: [], uraian_rapi: '' };
      return { content: JSON.stringify(out), usage: { input: 10, output: 5 }, latencyMs: 3, model: 'fake' };
    },
    estimateCostUsd: () => 0,
    providerInfo: () => ({ provider: 'fake', models: { 'omos-standard': 'fake' } }),
  };
}

async function startApp(db, users) {
  const dbPath = require.resolve('../src/config/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: db } };
  const authPath = require.resolve('../src/middleware/auth');
  require.cache[authPath] = {
    id: authPath, filename: authPath, loaded: true,
    exports: {
      requireAuth: (req, res, next) => { req.user = users[req.headers['x-test-user']]; return req.user ? next() : res.status(401).json({ error: 'no' }); },
      requireAdmin: (req, res, next) => next(),
    },
  };
  for (const k of Object.keys(require.cache)) if (/src[\\/]routes[\\/]hse\.routes/.test(k)) delete require.cache[k];
  const routes = require('../src/routes/hse.routes');
  require('../src/ai/agentRunner').setDefaultClient(fakeLlm());
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/admin/hse', routes);
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
  const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/admin/hse`;
  return {
    close: () => new Promise(r => server.close(r)),
    call: async (who, method, url, body) => {
      const res = await fetch(base + url, { method, headers: { 'content-type': 'application/json', 'x-test-user': who }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
  };
}

test('HTTP Asisten AI: pengaturan, simpan hazard → antrean → saran tampil, gabung wajib alasan, triase', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  const ins = async (nama, role, sup, perms) => (await db.query(`INSERT INTO users (nama, email, password_hash, role, is_super_admin, permissions)
    VALUES ($1,$2,'x',$3,$4,$5) RETURNING *`, [nama, `${nama.replace(/\s/g, '')}@x.id`, role, sup, perms])).rows[0];
  const users = {
    utama: await ins('Admin Utama', 'admin', true, null),
    officer: await ins('Rina HSE', 'admin', false, '["hse.merge"]'),
    karyawan: await ins('Budi', 'karyawan', false, null),
  };
  const loc = (await db.query(`INSERT INTO hse_locations (tenant_key, project_key, code, name, type) VALUES ('default','default','T-WS','Workshop Uji','WORKSHOP') RETURNING id`)).rows[0].id;
  const app = await startApp(db, users);
  try {
    const ov0 = await app.call('officer', 'GET', '/ai/overview');
    assert.equal(ov0.status, 200);
    assert.equal(ov0.body.settings.enabled, false);
    assert.equal(ov0.body.can_edit, false);
    assert.equal((await app.call('officer', 'PUT', '/ai/settings', { enabled: true })).status, 403);
    assert.equal((await app.call('karyawan', 'GET', '/ai/overview')).status, 403);
    const put = await app.call('utama', 'PUT', '/ai/settings', { enabled: true, features: { hse_duplicate: 'ON', hse_triage: 'ON' } });
    assert.equal(put.status, 200);
    assert.equal(put.body.features.hse_duplicate, 'ON');

    const body = d => ({ description: d, potential_consequence: 'Tersengat listrik', location_id: loc, likelihood: 3, consequence: 3 });
    const a = await app.call('karyawan', 'POST', '/hazards', body('Kabel panel genset terkelupas'));
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await app.call('karyawan', 'POST', '/hazards', body('Panel genset kabelnya kelupas'));
    assert.equal((await db.query(`SELECT COUNT(*)::int n FROM ai_jobs`)).rows[0].n, 2);

    const { runPending } = require('../src/ai/aiJobs');
    const hseAi = require('../src/services/hseAi');
    await runPending(db, { [hseAi.DUP_AGENT_ID]: hseAi.duplicateJobHandler }, { limit: 5 });

    const list = await app.call('officer', 'GET', '/hazards');
    const ra = list.body.find(h => h.id === a.body.id);
    assert.equal(ra.similar_hazards[0].engine, 'LLM');
    assert.equal(ra.similar_hazards[0].id, b.body.id);
    assert.ok(ra.similar_hazards[0].suggestion_id);
    const detail = await app.call('officer', 'GET', `/hazards/${a.body.id}`);
    assert.equal(detail.body.can_merge, true);
    assert.equal(detail.body.similar_hazards[0].verdict, 'SAMA');

    const noReason = await app.call('officer', 'POST', `/hazards/${a.body.id}/merge`, { source_hazard_id: b.body.id });
    assert.equal(noReason.status, 422);
    assert.equal(noReason.body.code, 'REASON_REQUIRED');
    assert.equal((await app.call('karyawan', 'POST', `/hazards/${a.body.id}/merge`, { source_hazard_id: b.body.id, reason: 'sama' })).status, 403);
    const merged = await app.call('officer', 'POST', `/hazards/${a.body.id}/merge`, {
      source_hazard_id: b.body.id, reason: 'Panel yang sama', suggestion_id: ra.similar_hazards[0].suggestion_id,
    });
    assert.equal(merged.status, 200);
    assert.equal(merged.body.reporter_count, 2);

    const tri = await app.call('officer', 'POST', '/ai/hazards/triage', { description: 'Kabel panel genset terkelupas', location_id: loc });
    assert.equal(tri.status, 200, JSON.stringify(tri.body));
    assert.equal(tri.body.risk.riskScore, 12);
    assert.equal(tri.body.risk.riskLevel, 'HIGH');
    const dec = await app.call('officer', 'POST', `/ai/suggestions/${tri.body.suggestion_id}/decision`, { decision: 'ACCEPTED', applied: ['risiko'] });
    assert.equal(dec.status, 200);

    const off = await app.call('utama', 'PUT', '/ai/settings', { features: { hse_triage: 'OFF' } });
    assert.equal(off.status, 200);
    const tri2 = await app.call('officer', 'POST', '/ai/hazards/triage', { description: 'Kabel panel genset terkelupas' });
    assert.equal(tri2.status, 409);
    assert.equal(tri2.body.code, 'AI_FEATURE_OFF');

    const shadow = await app.call('officer', 'GET', '/ai/shadow-report?days=7');
    assert.equal(shadow.status, 200);
    assert.ok(shadow.body.summary.human_merged >= 1);
  } finally {
    await app.close();
    await db.close();
  }
});
