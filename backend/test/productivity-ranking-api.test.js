'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const dbCfg = require('../src/config/db');
const svc = require('../src/services/productivityRanking');

function pasangMock() {
  const oldConnect = dbCfg.pool.connect;
  const lamaQuery = dbCfg.pool.query;
  const palsu = async (sql, args = []) => {
    if (sql.includes('pr_fleets')) {
      return { rows: [{ id: 'fm-1', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang',
        excavator_id: 'ex-1', excavator_code: 'EX-1', job_code: 'OB', pit_area: 'BEI',
        material_detail: 'CLAY', material_type: 'Overburden', jarak_km: 2.5 }] };
    }
    if (sql.includes('pr_ritase')) {
      return { rows: [{ id: 'r1', fleet_mapping_id: 'fm-1', dump_truck_id: 'dt-1', period_hour: 8,
        ritase_count: 10, nonprod_count: 2, dt_code: 'DT-1', dt_tipe: 'HD785' }] };
    }
    if (sql.includes('pr_segments')) {
      return { rows: [
        { id: 'g1', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'ex-1',
          kode_alat: 'EX-1', tipe_alat: 'PC1250', kelas_alat: 'Excavator', operator_id: 'op-a',
          operator_nama: 'Andi', job: 'OB', area_name: 'BEI', total_hm: 10, status: 'submitted' },
        { id: 'g2', tanggal: '2026-09-20', shift_id: 's1', nama_shift: 'Siang', equipment_id: 'dt-1',
          kode_alat: 'DT-1', tipe_alat: 'HD785', kelas_alat: 'Dump Truck', operator_id: 'dr-x',
          operator_nama: 'Xeni', job: 'OB', area_name: 'BEI', total_hm: 10, status: 'submitted' },
      ] };
    }
    if (sql.includes('pr_factors')) {
      return { rows: [{ tanggal: '2026-09-01', kategori: 'OB', tipe_alat: 'HD785', material: 'CLAY', factor_value: 20 }] };
    }
    if (sql.includes('pr_plan_versions')) {
      return { rows: [{ id: 'v-1', planning_type: 'ob', effective_from: '2026-09-01', revision: 1,
        data_json: {
          loaderCatalog: [{ tableId: 'loader-1', loaderCode: 'EX-1', material: 'CLAY', jobCode: 'OB',
            loaderProductivity: 25, complete: true }],
          parameters: [{ material: 'CLAY', fill: 1, swell: 1 }],
          scenarios: [{ id: 'loader-1', loaderId: 'ex-1', loaderCode: 'EX-1', material: 'CLAY',
            jobCodes: ['OB'], loaderProductivity: 25, bucketCapacity: 2, loaderCap: 2, cycleTimeLoading: 30 }],
          haulerRows: [{ loaderId: 'ex-1', truckId: 'dt-1', material: 'CLAY', capacity: 10,
            capacityUom: 'BCM', loadedSpeed: 20, emptySpeed: 25, spotDumpTime: 2, workEfficiency: 0.8 }],
          distanceHeadersMeters: [2500],
        } }] };
    }
    if (sql.includes('pr_jobs')) {
      return { rows: [{ job_code: 'OB', job_desc: 'OB Removal' }] };
    }
    if (sql.includes('pr_spo')) {
      return { rows: [{ content_html: '', data_json: { deployedJobs: [{ jobCode: 'OB' }] } }] };
    }
    throw new Error(`Mock tidak mengenali query: ${String(sql).slice(0, 80)}`);
  };
  dbCfg.pool.connect = async () => ({ release() {}, query: palsu });
  dbCfg.pool.query = palsu;
  return { lepas() { dbCfg.pool.connect = oldConnect; dbCfg.pool.query = lamaQuery; } };
}

test('GET ranking: kontrak response + angka rekonsiliasi manual', async () => {
  const { lepas } = pasangMock();
  try {
    const lap = await svc.getRankingReport({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob' });
    assert.equal(lap.meta.unit, 'BCM/Hr');
    assert.equal(lap.meta.production_basis, 'gross_including_nonprod');
    assert.equal(lap.meta.data_source, 'data_control');
    assert.equal(lap.meta.aggregation_method, 'hm_weighted_average');
    assert.equal(lap.meta.formula_version, 'productivity-ranking-gross-v1');
    assert.deepEqual(Object.keys(lap.rankings).sort(), [
      'dumpTruckDrivers', 'dumpTrucks', 'excavatorOperators', 'excavators',
      'lowDumpTruckDrivers', 'lowExcavatorOperators',
    ]);
    // Golden manual: gross 10x20=200, net 8x20=160, HM 10, plan 25 → expected 250
    const ex = lap.rankings.excavators[0];
    assert.equal(ex.entity_code, 'EX-1');
    assert.equal(ex.gross_volume, 200);
    assert.equal(ex.net_volume, 160);
    assert.equal(ex.hm_hours, 10);
    assert.equal(ex.actual_productivity, 20);
    assert.equal(ex.weighted_plan_productivity, 25);
    assert.equal(ex.expected_production, 250);
    assert.equal(ex.achievement_percentage, 80);
    assert.equal(ex.data_quality, 'complete');
    const dt = lap.rankings.dumpTrucks[0];
    assert.ok(Math.abs(dt.achievement_percentage - 75) < 1e-9,
      'plan DT berasal dari Hauler Productivity langsung, bukan Setting Fleet');
    const op = lap.rankings.excavatorOperators[0];
    assert.equal(op.entity_code, 'Andi');
    assert.equal(op.gross_volume, 200, 'satu operator menerima seluruh volume sel');
    assert.deepEqual(Object.keys(lap.quality).sort(), ['ambiguousMaterial', 'excludedDwHmHours', 'excludedDwSegments', 'hmWithoutRitase', 'missingHm', 'missingPlan', 'missingTruckFactor', 'ritaseWithoutHm']);
    assert.equal(lap.quality.missingTruckFactor, 0);
    assert.ok(Array.isArray(lap.controlHighlights) && lap.controlHighlights.length === 7);
  } finally { lepas(); }
});

test('GET data-control: pagination + filter + summary', async () => {
  const { lepas } = pasangMock();
  try {
    const dc = await svc.getDataControl({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob', page: 1, page_size: 2 });
    assert.equal(dc.meta.formula_version, 'productivity-ranking-gross-v1');
    assert.equal(dc.meta.page, 1);
    assert.ok(dc.meta.total_rows >= 4);
    assert.equal(dc.rows.length, 2);
    assert.ok(dc.rows[0].control_key);
    assert.ok(Array.isArray(dc.rows[0].reason_codes));
    const barisSiap = dc.rows.find(row => Number(row.hm_hours) > 0 && Number(row.gross_volume) >= 0);
    assert.equal(barisSiap.actual_productivity, barisSiap.gross_volume / barisSiap.hm_hours,
      'PDTY Data Control wajib Produksi / HM pada baris yang sama');
    assert.equal(dc.meta.row_formula, 'actual_productivity=gross_volume/hm_hours');
    assert.ok(dc.summary.readiness_percentage != null);
    const urutPdty = await svc.getDataControl({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob', sort: 'actual_productivity', page_size: 50 });
    const pdty = urutPdty.rows.map(row => row.actual_productivity).filter(Number.isFinite);
    assert.deepEqual(pdty, [...pdty].sort((a, b) => b - a));
    const hanyaEx = await svc.getDataControl({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob', entity_type: 'excavator', page_size: 50 });
    assert.ok(hanyaEx.rows.every(r => r.entity_type === 'excavator'));
    const dw = await svc.getDataControl({ tanggal_dari: '2026-09-01', tanggal_sampai: '2026-09-30', planning_type: 'ob', reason_code: 'NON_PRODUCTION_JOB_DW', page_size: 50 });
    assert.equal(dw.rows.length, 0);
    await assert.rejects(() => svc.getRankingReport({ tanggal_dari: '2026-09-30', tanggal_sampai: '2026-09-01' }), /setelah/);
  } finally { lepas(); }
});
