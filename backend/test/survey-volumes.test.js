'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ctrl = require('../src/controllers/surveyVolume.controller');

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => { res.body = data; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; return res; };
  res.send = data => { res.body = data; return res; };
  return res;
}

function withPool(impl) {
  const dbCfg = require('../src/config/db');
  const oldConnect = dbCfg.pool.connect;
  const oldQuery = dbCfg.pool.query;
  dbCfg.pool.connect = async () => ({ release() {}, query: impl });
  dbCfg.pool.query = impl;
  return () => { dbCfg.pool.connect = oldConnect; dbCfg.pool.query = oldQuery; };
}

test('GET memetakan material planning, PIT master, dan JOB Prod SPO', async () => {
  const restore = withPool(async sql => {
    if (sql.includes('FROM equipment')) {
      return { rows: [{ pit_area: 'BEI' }, { pit_area: 'DKC' }] };
    }
    if (sql.includes('FROM production_pits')) return { rows: [{ pit_area: 'PIT-A' }] };
    if (sql.includes('FROM survey_volumes WHERE tanggal')) {
      return { rows: [{ tanggal: '2026-09-05', pit_area: 'BEI', planning_type: 'ob', material: 'CLAY', volume: 1200 }] };
    }
    if (sql.includes("FROM productivity_plans WHERE planning_type IN")) {
      return { rows: [
        { planning_type: 'ob', data_json: { parameters: [{ material: 'CLAY' }, { material: 'SAND' }, { material: 'CLAY' }] } },
        { planning_type: 'coal', data_json: { version: 2, fleetCatalog: [{ material: 'SEAM 3' }, { material: 'SEAM 3' }] } },
      ] };
    }
    if (sql.includes('FROM productivity_plan_versions')) return { rows: [] };
    if (sql.includes("planning_type = 'spo'")) return { rows: [{ data_json: { tables: {
      ob: { deployed: true, jobCode: 'OB', productionMode: 'prod', materialType: 'ob' },
      cg: { deployed: true, jobCode: 'CG', productionMode: 'prod', materialType: 'coal' },
    } } }] };
    if (sql.includes('FROM master_job_codes')) return { rows: [
      { job_code: 'OB', job_desc: 'Overburden Removal' },
      { job_code: 'CG', job_desc: 'Coal Getting' },
    ] };
    throw new Error('query tak dikenal: ' + String(sql).slice(0, 60));
  });
  try {
    const res = mockRes();
    await ctrl.getSurveyVolumes({ query: { year: '2026', month: '9' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.materials, { ob: ['CLAY', 'SAND'], coal: ['SEAM 3'] });
    assert.deepEqual(res.body.pits, ['BEI', 'DKC']);
    assert.equal(res.body.volumes.length, 1);
    const resBad = mockRes();
    await ctrl.getSurveyVolumes({ query: { year: '2026', month: '13' } }, resBad);
    assert.equal(resBad.statusCode, 422);
  } finally { restore(); }
});

test('POST validasi + upsert atomik', async () => {
  const calls = [];
  const restore = withPool(async (sql, args) => {
    calls.push(sql);
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    if (sql.includes('INSERT INTO survey_volumes')) return { rows: [] };
    throw new Error('query tak dikenal: ' + String(sql).slice(0, 60));
  });
  try {
    const badCases = [
      [{}, /array tidak kosong/],
      [{ volumes: [] }, /array tidak kosong/],
      [{ volumes: [{ tanggal: 'salah', pit_area: 'BEI', planning_type: 'ob', material: 'CLAY', volume: 1 }] }, /tanggal/],
      [{ volumes: [{ tanggal: '2026-09-05', pit_area: 'BEI', planning_type: 'xx', material: 'CLAY', volume: 1 }] }, /planning_type/],
      [{ volumes: [{ tanggal: '2026-09-05', pit_area: 'BEI', planning_type: 'ob', material: 'CLAY', volume: -1 }] }, /volume/],
      [{ volumes: [{ tanggal: '2026-09-05', pit_area: '', planning_type: 'ob', material: 'CLAY', volume: 1 }] }, /pit_area/],
    ];
    for (const [body, rx] of badCases) {
      const res = mockRes();
      await ctrl.saveSurveyVolumes({ body, user: { id: 'u-1' } }, res);
      assert.match(res.body.error, rx);
      assert.ok(res.statusCode >= 400);
    }
    const ok = mockRes();
    await ctrl.saveSurveyVolumes({ body: { volumes: [
      { tanggal: '2026-09-05', pit_area: 'BEI', planning_type: 'ob', material: 'CLAY', volume: 1200 },
      { tanggal: '2026-09-05', pit_area: 'DKC', planning_type: 'coal', material: 'Coal', volume: 300 },
    ] }, user: { id: 'u-1' } }, ok);
    assert.equal(ok.body.saved, 2);
    assert.ok(calls.includes('BEGIN') && calls.includes('COMMIT'));
    assert.equal(calls.filter(s => s.includes('INSERT INTO survey_volumes')).length, 2);
  } finally { restore(); }
});

test('GET export CSV + komparasi survey vs produksi', async () => {
  const restore = withPool(async sql => {
    if (sql.includes('FROM ritase_logs rl')) {
      return { rows: [{ tanggal: '2026-09-05', pit_area: 'BEI', planning_type: 'ob', material: 'CLAY', volume: 1000 },
        { tanggal: '2026-09-05', pit_area: 'BEI', planning_type: 'ob', material: 'SAND', volume: 200 }] };
    }
    if (sql.includes('GROUP BY 1, 2, 3, 4')) {
      return { rows: [{ tanggal: '2026-09-05', pit_area: 'BEI', planning_type: 'ob', material: 'CLAY', volume: 1200 }] };
    }
    if (sql.includes('ORDER BY tanggal, pit_area')) {
      return { rows: [{ tanggal: '2026-09-05', pit_area: 'BEI', planning_type: 'ob', material: 'CLAY', volume: 1200 }] };
    }
    throw new Error('query tak dikenal: ' + String(sql).slice(0, 60));
  });
  try {
    const ex = mockRes();
    await ctrl.exportSurveyVolumes({ query: { year: '2026', month: '9' } }, ex);
    assert.equal(ex.statusCode, 200);
    assert.match(ex.headers['Content-Disposition'], /survey-volumes-2026-09\.csv/);
    assert.ok(String(ex.body).includes('tanggal,pit_area,planning_type,material,volume_liter'));
    assert.ok(String(ex.body).includes('2026-09-05,BEI,ob,CLAY,1200'));
    const cmp = mockRes();
    await ctrl.getSurveyComparison({ query: { year: '2026', month: '9' } }, cmp);
    assert.equal(cmp.statusCode, 200);
    const clay = cmp.body.rows.find(r => r.material === 'CLAY');
    assert.deepEqual([clay.survey, clay.production, clay.selisih], [1200, 1000, 200]);
    const sand = cmp.body.rows.find(r => r.material === 'SAND');
    assert.deepEqual([sand.survey, sand.production, sand.selisih], [0, 200, -200]);
  } finally { restore(); }
});
