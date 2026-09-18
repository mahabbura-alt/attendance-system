require('dotenv').config({ path: require('path').join(__dirname, '../../.env.supabase') });
const { pool } = require('../config/db');

const API = 'https://attendance-system-eta-opal.vercel.app';
const TOKEN = process.argv[2];
const SHIFT = 'b0e9a93f-4bcb-4aa5-a8dc-9349d0613479'; // Shift Siang
const TEST_EQUIP = 'd7a9ac7c-76fe-441a-8077-591c91740a44'; // DT20 6-48 (Dump Truck)
const OTHER_EQUIP = '281fdacc-1cb6-404a-bf3f-1f5869014d48'; // DT20 6-49 (Dump Truck, non km_only)

async function api(path, method = 'GET', body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function setKmOnly(id, value) {
  await pool.query('UPDATE equipment SET km_only=$1 WHERE id=$2', [value, id]);
}

async function main() {
  const results = [];
  const createdIds = [];
  try {
    // 1. Baseline: non-km_only unit without HM should be REJECTED (400)
    const baseline = await api('/api/admin/production/fuel', 'POST', {
      tanggal: '2026-09-05', shift_id: SHIFT,
      equipment_id: OTHER_EQUIP, hm_reading: null, odometer_reading: 1000,
      fuel_filled: 50, source_type: 'manual',
    });
    results.push({ test: 'non-km_only tanpa HM (harus ditolak)', status: baseline.status, error: baseline.data.error });

    // 2. Mark test unit as km_only
    await setKmOnly(TEST_EQUIP, true);
    results.push({ test: 'set km_only=true', ok: true });

    // 3. km_only unit WITHOUT HM, WITH odometer -> should SUCCEED (201)
    const okCreate = await api('/api/admin/production/fuel', 'POST', {
      tanggal: '2026-09-05', shift_id: SHIFT,
      equipment_id: TEST_EQUIP, hm_reading: null, odometer_reading: 50000,
      fuel_filled: 60, source_type: 'manual',
    });
    results.push({ test: 'km_only tanpa HM + odometer (harus sukses)', status: okCreate.status, id: okCreate.data.id, error: okCreate.data.error });
    if (okCreate.data.id) createdIds.push(okCreate.data.id);

    // 4. km_only unit WITHOUT HM AND WITHOUT odometer -> should be REJECTED (400)
    const noKm = await api('/api/admin/production/fuel', 'POST', {
      tanggal: '2026-09-05', shift_id: SHIFT,
      equipment_id: TEST_EQUIP, hm_reading: null, odometer_reading: null,
      fuel_filled: 60, source_type: 'manual',
    });
    results.push({ test: 'km_only tanpa HM & tanpa odometer (harus ditolak)', status: noKm.status, error: noKm.data.error });

    // 5. Verify fuel-cards payload exposes km_only
    const cards = await api('/api/admin/production/fuel-cards?year=2026&month=09');
    const card = (cards.data.cards || []).find(c => String(c.id) === TEST_EQUIP);
    results.push({ test: 'fuel-cards expose km_only', km_only: card ? card.km_only : 'UNIT NOT FOUND' });

    console.log(JSON.stringify(results, null, 2));
  } catch (err) {
    console.error('FATAL', err.message);
  } finally {
    // Cleanup: soft-delete created test logs via DB and revert km_only
    if (createdIds.length) {
      await pool.query('UPDATE fuel_logs SET deleted_at=CURRENT_TIMESTAMP WHERE id=ANY($1::uuid[])', [createdIds]);
    }
    await setKmOnly(TEST_EQUIP, false);
    await pool.end();
  }
}

main();
