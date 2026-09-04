const path = require('path');
const xlsx = require('xlsx');
const { pool } = require('../config/db');

async function importExcel() {
  console.log('🚀 Membuka PARAMETER.xlsx...');
  const excelPath = path.join(__dirname, '../../../PARAMETER.xlsx');
  const workbook = xlsx.readFile(excelPath, { cellDates: true });

  // 1. Skema SQL dasar & 003
  const fs = require('fs');
  const baseSql = fs.readFileSync(path.join(__dirname, '../../sql/schema.sql'), 'utf8');
  await pool.query(baseSql);
  const prodSql = fs.readFileSync(path.join(__dirname, '../../sql/003_mining_production_schema.sql'), 'utf8');
  await pool.query(prodSql);

  // Ambil shift & user default
  const shiftRes = await pool.query("SELECT id FROM shifts LIMIT 1");
  const shiftId = shiftRes.rows[0]?.id;
  const userRes = await pool.query("SELECT id FROM users LIMIT 1");
  const userId = userRes.rows[0]?.id;

  const pitRes = await pool.query("SELECT id FROM production_pits LIMIT 1");
  const pitId = pitRes.rows[0]?.id;
  const lpRes = await pool.query("SELECT id FROM loading_points LIMIT 1");
  const lpId = lpRes.rows[0]?.id;
  const dispRes = await pool.query("SELECT id FROM disposals LIMIT 1");
  const dispId = dispRes.rows[0]?.id;

  // Helper Parse Brand & Class
  function parseBrand(str) {
    const s = String(str || '').toUpperCase();
    if (s.includes('CAT') || s.includes('CATERPILLAR')) return 'Caterpillar';
    if (s.includes('HITACHI') || s.includes('ZX')) return 'Hitachi';
    if (s.includes('KOMATSU') || s.includes('PC') || s.includes('HD') || s.includes('GD')) return 'Komatsu';
    if (s.includes('ISUZU')) return 'Isuzu';
    if (s.includes('SANY')) return 'Sany';
    if (s.includes('SCANIA')) return 'Scania';
    if (s.includes('VOLVO')) return 'Volvo';
    if (s.includes('HINO')) return 'Hino';
    return 'Caterpillar';
  }

  function parseClass(unitStr) {
    const u = String(unitStr || '').toUpperCase();
    if (u.includes('EXCAVATOR')) return 'Excavator';
    if (u.includes('DUMPTRUCK') || u.includes('DT')) return 'Dump Truck';
    if (u.includes('BULLDOZER') || u.includes('DOZER')) return 'Dozer';
    if (u.includes('GRADER')) return 'Grader';
    if (u.includes('COMPACTOR')) return 'Compactor';
    if (u.includes('FUEL')) return 'Fuel Truck';
    if (u.includes('WATER')) return 'Water Truck';
    return 'Heavy Equipment';
  }

  // Helper to estimate capacity based on equipment type and model
  function estimateCapacity(kelasAlat, tipeModel) {
    const model = String(tipeModel || '').toUpperCase();
    
    if (kelasAlat === 'Dump Truck') {
      // Extract tonnage from model like "HD785-7 (100T)" or "P410 (40T)"
      const tonMatch = model.match(/\((\d+)T\)/);
      if (tonMatch) return parseInt(tonMatch[1]);
      // Default capacities based on common models
      if (model.includes('HD785') || model.includes('777E')) return 100;
      if (model.includes('P410')) return 40;
      return 50; // default
    }
    
    if (kelasAlat === 'Excavator') {
      // Extract bucket capacity from model like "CAT 6020B (20 Ton)" 
      // For excavators, we estimate bucket capacity in m³
      if (model.includes('6020B') || model.includes('20 TON')) return 12.5;
      if (model.includes('PC1250')) return 10.5;
      if (model.includes('PC2000') || model.includes('EX3600')) return 18.0;
      return 8.0; // default
    }
    
    if (kelasAlat === 'Dozer') {
      if (model.includes('D8R') || model.includes('D9')) return 18.5;
      if (model.includes('D6')) return 12.0;
      return 10.0;
    }
    
    if (kelasAlat === 'Grader') {
      if (model.includes('GD705') || model.includes('16M')) return 3.7;
      if (model.includes('GD825')) return 4.5;
      return 3.0;
    }
    
    return null; // For other equipment types
  }

  // -------------------------------------------------------------
  // Sheet 1: List Equip
  // -------------------------------------------------------------
  console.log('📦 Mengimpor Sheet [List Equip]...');
  const sheetEq = workbook.Sheets['List Equip'];
  const eqData = xlsx.utils.sheet_to_json(sheetEq, { header: 1 });
  let eqCount = 0;

  for (let i = 5; i < eqData.length; i++) {
    const r = eqData[i];
    if (!r || !r[3] || !r[4]) continue;

    const tipeModel = String(r[3]).trim();
    const noLambung = String(r[4]).trim();
    const unitType = String(r[1] || 'Excavator').trim();
    const fuelRate = parseFloat(r[5]) || 35.0;

    const kelasAlat = parseClass(unitType);
    const brand = parseBrand(tipeModel);
    await pool.query(`
      INSERT INTO equipment (kode_alat, kelas_alat, tipe_alat, brand, date_in, fuel_rate_lph, status_alat)
      VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, 'Working')
      ON CONFLICT (kode_alat) DO UPDATE SET
        kelas_alat = EXCLUDED.kelas_alat,
        tipe_alat = EXCLUDED.tipe_alat,
        brand = EXCLUDED.brand,
        fuel_rate_lph = EXCLUDED.fuel_rate_lph,
        deleted_at = NULL;
    `, [noLambung, kelasAlat, tipeModel, brand, fuelRate]);
    eqCount++;
  }
  console.log(`✅ Berhasil mengimpor ${eqCount} Master Unit dari List Equip!`);

  // -------------------------------------------------------------
  // Sheet 2: Daily STB
  // -------------------------------------------------------------
  console.log('⏱️ Mengimpor Sheet [Daily STB]...');
  const sheetStb = workbook.Sheets['Daily STB'];
  const stbData = xlsx.utils.sheet_to_json(sheetStb, { header: 1 });
  let stbCodeCount = 0, bdCodeCount = 0, stbLogCount = 0;

  for (let i = 7; i < Math.min(stbData.length, 500); i++) {
    const r = stbData[i];
    if (!r || r.length < 17) continue;

    const kodeStb = String(r[16] || '').trim();
    const remarks = String(r[17] || r[4] || '').trim();

    if (kodeStb && remarks) {
      if (kodeStb.startsWith('S')) {
        await pool.query(`
          INSERT INTO master_standby_codes (kode, kategori, deskripsi)
          VALUES ($1, $2, $3)
          ON CONFLICT (kode) DO UPDATE SET kategori = EXCLUDED.kategori;
        `, [kodeStb, remarks, remarks]);
        stbCodeCount++;
      } else if (kodeStb.startsWith('M') || kodeStb.startsWith('BD')) {
        await pool.query(`
          INSERT INTO master_breakdown_codes (kode, kategori, deskripsi)
          VALUES ($1, $2, $3)
          ON CONFLICT (kode) DO UPDATE SET kategori = EXCLUDED.kategori;
        `, [kodeStb, remarks, remarks]);
        bdCodeCount++;
      }
    }

    const tglRaw = r[0];
    const noLambung = String(r[2] || '').trim();
    const lossHours = parseFloat(r[15] || r[12] || 0);

    if (tglRaw && noLambung && lossHours > 0) {
      const tglStr = tglRaw instanceof Date ? tglRaw.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const eqRes = await pool.query("SELECT id FROM equipment WHERE kode_alat = $1 LIMIT 1", [noLambung]);
      if (eqRes.rows.length && shiftId) {
        const eqId = eqRes.rows[0].id;
        const codeRes = await pool.query("SELECT id FROM master_standby_codes WHERE kode = $1 LIMIT 1", [kodeStb]);
        if (codeRes.rows.length) {
          const codeId = codeRes.rows[0].id;
          await pool.query(`
            INSERT INTO standby_logs (tanggal, shift_id, equipment_id, standby_code_id, description, start_time, finish_time, total_standby_hours)
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW() + INTERVAL '1 hour', $6)
            ON CONFLICT DO NOTHING;
          `, [tglStr, shiftId, eqId, codeId, remarks, lossHours]);
          stbLogCount++;
        }
      }
    }
  }
  console.log(`✅ Berhasil mengimpor Kode Delay & ${stbLogCount} Standby Logs!`);

  // -------------------------------------------------------------
  // Sheet 3: DB OB
  // -------------------------------------------------------------
  console.log('📊 Mengimpor Sheet [DB OB]...');
  const sheetOb = workbook.Sheets['DB OB'];
  const obData = xlsx.utils.sheet_to_json(sheetOb, { header: 1 });
  let prodCount = 0, ritCount = 0;

  for (let i = 17; i < Math.min(obData.length, 500); i++) {
    const r = obData[i];
    if (!r || r.length < 8) continue;

    const tglRaw = r[0];
    const noLambung = String(r[2] || '').trim();
    const opNama = String(r[3] || 'Operator Field').trim();
    const hmStart = parseFloat(r[5] || 0);
    const hmStop = parseFloat(r[6] || 0);

    if (tglRaw && noLambung && shiftId) {
      const tglStr = tglRaw instanceof Date ? tglRaw.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      const eqRes = await pool.query("SELECT id, kelas_alat, fuel_rate_lph FROM equipment WHERE kode_alat = $1 LIMIT 1", [noLambung]);
      if (eqRes.rows.length) {
        const eq = eqRes.rows[0];
        const hmTotal = Math.max(0, hmStop - hmStart);

        await pool.query(`
          INSERT INTO mining_production_logs (tanggal, shift_id, project_name, pit_id, loading_point_id, disposal_id, equipment_id, job_description, hm_start, hm_finish, status)
          VALUES ($1, $2, 'PIM Mining Project', $3, $4, $5, $6, $7, $8, $9, 'submitted')
          ON CONFLICT DO NOTHING;
        `, [tglStr, shiftId, pitId, lpId, dispId, eq.id, `Operasional ${eq.kelas_alat} di Front`, hmStart, hmStop]);
        prodCount++;

        if (hmTotal > 0) {
          const fuelFilled = parseFloat((hmTotal * parseFloat(eq.fuel_rate_lph || 35)).toFixed(1));
          await pool.query(`
            INSERT INTO fuel_logs (tanggal, shift_id, equipment_id, hm_start, hm_finish, total_hm, fuel_filled, fuel_remaining, fuel_consumption, fuel_per_hm, remark)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 30.0, $8, $9, 'Pengisian FBR Excel')
            ON CONFLICT DO NOTHING;
          `, [tglStr, shiftId, eq.id, hmStart, hmStop, hmTotal, fuelFilled, fuelFilled, eq.fuel_rate_lph]);

          if (['Dump Truck', 'Excavator'].includes(eq.kelas_alat)) {
            const rit = Math.round(hmTotal * 4);
            const vol = parseFloat((rit * 20.0).toFixed(1));
            await pool.query(`
              INSERT INTO ritase_logs (tanggal, shift_id, excavator_id, dump_truck_id, material, loading_point_id, disposal_id, ritase_count, production_volume, average_cycle_time)
              VALUES ($1, $2, $3, $4, 'Overburden', $5, $6, $7, $8, 17.5)
              ON CONFLICT DO NOTHING;
            `, [tglStr, shiftId, eq.id, eq.id, lpId, dispId, rit, vol]);
            ritCount++;
          }
        }
      }
    }
  }

  console.log('🎉 SINKRONISASI DATABASES PARAMETER.XLSX SELESAI!');
  console.log(`   - ${eqCount} Master Unit Alat Berat (Brand, Date In, FBR LPH, Kapasitas Unit)`);
  console.log(`   - ${prodCount} Daily Production Logs`);
  console.log(`   - ${ritCount} Ritase & Production Records`);
}

if (require.main === module) {
  importExcel().then(() => pool.end());
}

module.exports = importExcel;
