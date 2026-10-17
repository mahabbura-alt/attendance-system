'use strict';

/** HTTP: rute HSE + Asisten AI dengan DB PGlite nyata, auth tiruan, dan klien LLM tiruan. */

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { available, createTestDb } = require('./helpers/pgliteDb');

const MIGRATIONS = ['064_workforce_movements_mpp', '073_hse_fase1_hazard_capa', '074_hse_fase2_incidents_reports', '075_hse_fase3_competency',
  '076_hse_fase4_ptw_inspections', '079_hse_fase7_contractor_environment', '082_hse_setup_area_sub_area', '083_hazard_consequence_and_reporter',
  '084_hse_setup_inspections', '085_hse_inspection_schedules', '086_hse_inspection_personnel_scope', '087_hse_hazard_categories_and_smart_merge',
  '088_hse_hazard_report_targets', '089_hse_p5m_safetytalk_targets', '090_hse_p5m_safetytalk_events', '092_hse_workhours', '099_ai_foundation_hse',
  '100_ai_ask_hse', '102_hse_hazard_recommendation'].map(n => `migrations/${n}.sql`);

function fakeLlm() {
  return {
    async chat({ messages }) {
      const isPlanner = /perencana kueri/.test(messages[0].content);
      const text = messages[messages.length - 1].content;
      const data = JSON.parse(text.slice(text.indexOf('<data>') + 6, text.indexOf('</data>')));
      const out = isPlanner
        ? { tools: [{ nama: 'hazard', args: { tampilkan_daftar: true } }], tidak_bisa_dijawab: '' }
        : { jawaban: `Ada ${data.hasil[0].data.total} laporan hazard.`, angka: [{ label: 'Total', nilai: String(data.hasil[0].data.total) }], halaman: 'hazards' };
      return { content: JSON.stringify(out), usage: { input: 10, output: 5 }, latencyMs: 3, model: 'fake' };
    },
    estimateCostUsd: () => 0,
    providerInfo: () => ({ provider: 'fake', models: { 'omos-standard': 'fake', 'omos-cheap': 'fake' } }),
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

test('HTTP Tanya OMOS: info, tanya, umpan balik, izin & mode', { skip: !available }, async () => {
  require('../src/services/hseAsk')._resetCachesForTests();
  const db = await createTestDb(MIGRATIONS);
  const ins = async (nama, role, sup) => (await db.query(`INSERT INTO users (nama, email, password_hash, role, is_super_admin)
    VALUES ($1,$2,'x',$3,$4) RETURNING *`, [nama, `${nama.replace(/\s/g, '')}@x.id`, role, sup])).rows[0];
  const users = { utama: await ins('Admin Utama', 'admin', true), officer: await ins('Rina HSE', 'admin', false), karyawan: await ins('Budi', 'karyawan', false) };
  const loc = (await db.query(`INSERT INTO hse_locations (tenant_key, project_key, code, name, type) VALUES ('default','default','T-WS','Workshop Uji','WORKSHOP') RETURNING id`)).rows[0].id;
  const app = await startApp(db, users);
  try {
    // Fitur mati secara bawaan.
    const off = await app.call('officer', 'POST', '/ask', { question: 'Berapa hazard?' });
    assert.equal(off.status, 403);
    assert.equal(off.body.code, 'ASK_DISABLED');
    assert.equal((await app.call('officer', 'GET', '/ask/info')).body.available, false);

    // Hanya Admin Utama yang boleh menyalakan; mode uji = hanya Admin Utama yang bisa bertanya.
    assert.equal((await app.call('officer', 'PUT', '/ai/settings', { enabled: true, features: { hse_ask: 'ON' } })).status, 403);
    assert.equal((await app.call('utama', 'PUT', '/ai/settings', { enabled: true, features: { hse_ask: 'SHADOW' } })).body.features.hse_ask, 'SHADOW');
    assert.equal((await app.call('officer', 'POST', '/ask', { question: 'Berapa hazard?' })).body.code, 'ASK_ADMIN_ONLY');

    await app.call('utama', 'PUT', '/ai/settings', { features: { hse_ask: 'ON' } });
    assert.equal((await app.call('karyawan', 'POST', '/ask', { question: 'Berapa hazard?' })).status, 403, 'karyawan biasa ditolak');
    const info = await app.call('officer', 'GET', '/ask/info');
    assert.equal(info.body.available, true);
    assert.ok(info.body.examples.hazards.length >= 1);

    await app.call('karyawan', 'POST', '/hazards', { description: 'Kabel panel genset terkelupas', potential_consequence: 'Tersengat listrik', location_id: loc, likelihood: 3, consequence: 3 });
    const res = await app.call('officer', 'POST', '/ask', { question: 'Berapa hazard saat ini?', context: { page: 'hazards', period: 'Okt 2026' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.kind, 'ANSWER');
    assert.match(res.body.answer, /Ada 1 laporan hazard/);
    assert.equal(res.body.page, 'hazards');
    assert.equal((await app.call('officer', 'POST', '/ask', { question: '' })).status, 422);

    const fb = await app.call('officer', 'POST', '/ask/feedback', { request_id: res.body.request_id, rating: 1 });
    assert.equal(fb.status, 200);
    assert.equal((await app.call('utama', 'POST', '/ask/feedback', { request_id: res.body.request_id, rating: 1 })).status, 404, 'bukan pemilik');
  } finally {
    await app.close();
    await db.close();
  }
});
