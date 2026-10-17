'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('node:crypto');
const { pool } = require('../src/config/db');

test('Review Pareto mengagregasi breakdown/standby/problem per unit plotting', async () => {
  const eq1 = randomUUID(); const eq2 = randomUUID();
  const oldQuery = pool.query; const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomUUID();
  const actor = randomUUID();
  pool.query = async sql => {
    if (sql.includes('FROM users')) return { rows: [{ id: actor, role: 'admin' }] };
    if (sql.includes('FROM productivity_plan_versions')) {
      return { rows: [{ planning_type: 'ob', content_html: '', data_json: { loaderCatalog: [
        { planRef: 'ob:p1', tableId: 'p1', jobCode: 'OB', jobCodes: ['OB'], loaderCode: 'EX30 350-14', material: 'CLAY', loaderProductivity: 100, complete: true },
      ] } }] };
    }
    if (sql.includes("planning_type = 'fleet-capacity'")) {
      return { rows: [{ data_json: { periodicSelections: { p1: { '2026:9:1': true } },
        pitAssignments: { 'fleet:ex30 350-14': { '2026:9:1': 'BEI' } } } }] };
    }
    if (sql.includes('FROM productivity_plans WHERE planning_type')) {
      return { rows: [{ data_json: { assignments: { PA: { [eq1]: 'OB' } } } }] };
    }
    if (sql.includes('FROM equipment')) {
      // eq1: class_unit kosong -> fallback ke tipe_alat (seperti List Equipment)
      return { rows: [{ id: eq1, kode_alat: 'EX30 350-14', kelas_alat: 'Excavator', class_unit: '', tipe_alat: 'EX30 T' },
        { id: eq2, kode_alat: 'EX30 350-15', kelas_alat: 'Excavator', class_unit: 'EX 350', tipe_alat: '' }] };
    }
    if (sql.includes('FROM master_job_codes')) return { rows: [{ job_code: 'OB', job_desc: 'OB Removal' }] };
    if (sql.includes('FROM fleet_mappings')) {
      return { rows: [{ excavator_id: eq1, job_code: 'OB', tanggal: '2026-09-01' }] };
    }
    if (sql.includes('FROM breakdown_logs')) {
      return { rows: [
        { equipment_id: eq1, tanggal: '2026-09-01', kategori: 'Engine', kode: 'ENG', jam: 5, description: 'Turbo rusak' },
        { equipment_id: eq1, tanggal: '2026-09-01', kategori: 'Engine', kode: 'ENG', jam: 3, description: '' },
        { equipment_id: eq1, tanggal: '2026-09-01', kategori: 'Tyre', kode: 'TYR', jam: 2, description: 'Ban sobek' },
        { equipment_id: eq2, tanggal: '2026-09-01', kategori: 'Engine', kode: 'ENG', jam: 99, description: 'bukan plotting' },
      ] };
    }
    if (sql.includes('FROM standby_logs')) {
      return { rows: [
        { equipment_id: eq1, tanggal: '2026-09-01', kategori: 'Waiting Front', kode: 'WF', jam: 2, description: 'Tunggu front' },
      ] };
    }
    if (sql.includes('FROM ritase_productivity_exceptions')) {
      return { rows: [
        { excavator_id: eq1, job_code: 'OB', tanggal: '2026-09-01', fleet_mapping_id: 'fm1', material_detail: 'CLAY', kategori: 'Queue', kode: 'QUEUE', problem: 'Antre dump', impact_minutes: 30 },
        { excavator_id: eq1, job_code: 'OB', tanggal: '2026-09-01', fleet_mapping_id: 'fm1', material_detail: 'CLAY', kategori: 'Queue', kode: 'QUEUE', problem: '', impact_minutes: 15 },
        { excavator_id: eq1, job_code: 'CG', tanggal: '2026-09-01', fleet_mapping_id: 'fm1', material_detail: 'SEAM', kategori: 'Queue', kode: 'QUEUE', problem: 'job lain', impact_minutes: 60 },
      ] };
    }
    return { rows: [] };
  };
  const app = express(); app.use(express.json()); app.use('/production', require('../src/routes/production.routes'));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/production`;
  const headers = { Authorization: `Bearer ${jwt.sign({ id: actor, role: 'admin' }, process.env.JWT_SECRET)}` };
  try {
    const res = await fetch(`${url}/review-produksi/pareto?tanggal_dari=2026-09-01&tanggal_sampai=2026-09-01&pit=BEI&job=OB&planning_source=conservative`, { headers });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.deepEqual(data.units.map(u => u.unit), ['EX30 350-14']);
    assert.equal(data.units[0].class, 'EX30 T');
    assert.equal(data.pa.totalJam, 10);
    assert.equal(data.pa.items[0].kategori, 'Engine');
    assert.equal(data.pa.items[0].jam, 8);
    assert.equal(data.pa.items[0].kejadian, 2);
    assert.equal(data.pa.items[0].units[0].unit, 'EX30 350-14');
    assert.equal(data.pa.items[0].contoh, 'Turbo rusak');
    assert.equal(data.ua.totalJam, 2);
    assert.equal(data.ua.items[0].kategori, 'Waiting Front');
    assert.equal(data.productivity.totalKejadian, 2);
    assert.equal(data.productivity.items[0].problem, 'Antre dump');
    assert.equal(data.productivity.items[0].kategori, 'Queue');
    assert.equal(data.productivity.items[0].kejadian, 2);

    const bad = await fetch(`${url}/review-produksi/pareto?tanggal_dari=xx&tanggal_sampai=2026-09-01`, { headers });
    assert.equal(bad.status, 400);
    const rev = await fetch(`${url}/review-produksi/pareto?tanggal_dari=2026-09-02&tanggal_sampai=2026-09-01`, { headers });
    assert.equal(rev.status, 422);
  } finally {
    server.close(); pool.query = oldQuery; process.env.JWT_SECRET = oldSecret;
  }
});
