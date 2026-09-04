const { pool } = require('../config/db');

async function seedDummyData() {
  console.log('🚀 Memulai pengisian data dummy produksi tambang untuk pengujian sistem...');

  try {
    // 1. Pastikan Skema Dasar & Skema Produksi Aktif
    const fs = require('fs');
    const path = require('path');
    const baseSqlPath = path.join(__dirname, '../../sql/schema.sql');
    if (fs.existsSync(baseSqlPath)) {
      const baseSqlContent = fs.readFileSync(baseSqlPath, 'utf8');
      await pool.query(baseSqlContent);
    }

    const sqlPath = path.join(__dirname, '../../sql/003_mining_production_schema.sql');
    if (fs.existsSync(sqlPath)) {
      const sqlContent = fs.readFileSync(sqlPath, 'utf8');
      await pool.query(sqlContent);
    }

    // 2. Ambil Shift & User Admin ID
    const shiftRes = await pool.query("SELECT id FROM shifts LIMIT 2");
    const shift1Id = shiftRes.rows[0]?.id;
    const shift2Id = shiftRes.rows[1]?.id || shift1Id;

    const userRes = await pool.query("SELECT id FROM users LIMIT 1");
    const userId = userRes.rows[0]?.id;

    // 3. Ambil Master Pits, LP, Disposal
    const pitRes = await pool.query("SELECT id FROM production_pits LIMIT 2");
    const pit1Id = pitRes.rows[0]?.id;
    const pit2Id = pitRes.rows[1]?.id || pit1Id;

    const lpRes = await pool.query("SELECT id FROM loading_points LIMIT 2");
    const lp1Id = lpRes.rows[0]?.id;
    const lp2Id = lpRes.rows[1]?.id || lp1Id;

    const dispRes = await pool.query("SELECT id FROM disposals LIMIT 2");
    const disp1Id = dispRes.rows[0]?.id;
    const disp2Id = dispRes.rows[1]?.id || disp1Id;

    // 4. Ambil Equipment IDs
    const exc1Res = await pool.query("SELECT id FROM equipment WHERE kode_alat = 'EXC-01'");
    const exc2Res = await pool.query("SELECT id FROM equipment WHERE kode_alat = 'EXC-02'");
    const dt1Res = await pool.query("SELECT id FROM equipment WHERE kode_alat = 'DT-01'");
    const dt2Res = await pool.query("SELECT id FROM equipment WHERE kode_alat = 'DT-02'");
    const dt3Res = await pool.query("SELECT id FROM equipment WHERE kode_alat = 'DT-03'");
    const dt4Res = await pool.query("SELECT id FROM equipment WHERE kode_alat = 'DT-04'");

    const exc1Id = exc1Res.rows[0]?.id;
    const exc2Id = exc2Res.rows[0]?.id;
    const dt1Id = dt1Res.rows[0]?.id;
    const dt2Id = dt2Res.rows[0]?.id;
    const dt3Id = dt3Res.rows[0]?.id;
    const dt4Id = dt4Res.rows[0]?.id;

    // 5. Seed Mining Production Logs (Input Data)
    const today = new Date().toISOString().split('T')[0];
    await pool.query(`
      INSERT INTO mining_production_logs (tanggal, shift_id, project_name, pit_id, loading_point_id, disposal_id, equipment_id, operator_id, job_description, hm_start, hm_finish, remark, status)
      VALUES 
        ('${today}', '${shift1Id}', 'PIM Mining Project', '${pit1Id}', '${lp1Id}', '${disp1Id}', '${exc1Id}', ${userId ? `'${userId}'` : 'NULL'}, 'Stripping Overburden Seam 3A', 1250.0, 1260.5, 'Front bersih, cuaca cerah', 'submitted'),
        ('${today}', '${shift1Id}', 'PIM Mining Project', '${pit1Id}', '${lp1Id}', '${disp1Id}', '${dt1Id}', ${userId ? `'${userId}'` : 'NULL'}, 'Hauling Overburden ke Disposal Outpit', 2100.0, 2110.0, 'Kondisi jalan mulus', 'submitted'),
        ('${today}', '${shift1Id}', 'PIM Mining Project', '${pit1Id}', '${lp1Id}', '${disp1Id}', '${dt2Id}', ${userId ? `'${userId}'` : 'NULL'}, 'Hauling Overburden ke Disposal Outpit', 1980.0, 1989.5, 'Ritase normal', 'submitted'),
        ('${today}', '${shift2Id}', 'PIM Mining Project', '${pit2Id}', '${lp2Id}', '${disp2Id}', '${exc2Id}', ${userId ? `'${userId}'` : 'NULL'}, 'Getting Coal Seam 5B', 890.0, 899.0, 'Shift malam lancar', 'submitted')
      ON CONFLICT DO NOTHING;
    `);

    // 6. Seed Fuel Logs (Input Fuel)
    await pool.query(`
      INSERT INTO fuel_logs (
        tanggal,shift_id,equipment_id,operator_id,hm_start,hm_finish,total_hm,hm_reading,
        fuel_filled,fuel_remaining,fuel_consumption,fuel_per_hm,remark,source_type,record_status
      )
      SELECT v.tanggal::date,v.shift_id::uuid,v.equipment_id::uuid,v.operator_id::uuid,
             v.hm_start,v.hm_finish,v.total_hm,v.hm_finish,v.fuel_filled,0,v.fuel_filled,
             v.fuel_per_hm,v.remark,'seed','migrated'
      FROM (VALUES
        ('${today}', '${shift1Id}', '${exc1Id}', ${userId ? `'${userId}'` : 'NULL'}, 1250.0, 1260.5, 10.5, 550.0, 52.38, 'Pengisian solar jam 07:15 di front'),
        ('${today}', '${shift1Id}', '${dt1Id}', ${userId ? `'${userId}'` : 'NULL'}, 2100.0, 2110.0, 10.0, 380.0, 38.00, 'Solar dispenser tangki 2'),
        ('${today}', '${shift1Id}', '${dt2Id}', ${userId ? `'${userId}'` : 'NULL'}, 1980.0, 1989.5, 9.5, 360.0, 37.89, 'Normal tank fill')
      ) AS v(tanggal,shift_id,equipment_id,operator_id,hm_start,hm_finish,total_hm,fuel_filled,fuel_per_hm,remark)
      WHERE NOT EXISTS (
        SELECT 1 FROM fuel_logs fl
        WHERE fl.tanggal=v.tanggal::date AND fl.shift_id=v.shift_id::uuid
          AND fl.equipment_id=v.equipment_id::uuid AND fl.deleted_at IS NULL
      );
    `);

    // 7. Seed Standby Logs
    const stbRes = await pool.query("SELECT id FROM master_standby_codes LIMIT 2");
    const stb1Id = stbRes.rows[0]?.id;
    const stb2Id = stbRes.rows[1]?.id || stb1Id;

    await pool.query(`
      INSERT INTO standby_logs (tanggal, shift_id, equipment_id, standby_code_id, description, start_time, finish_time, total_standby_hours)
      VALUES
        ('${today}', '${shift1Id}', '${exc1Id}', '${stb1Id}', 'Menunggu antrian Dump Truck tiba di LP', '${today}T09:00:00Z', '${today}T10:30:00Z', 1.5),
        ('${today}', '${shift1Id}', '${dt1Id}', '${stb2Id}', 'Pengawasan hujan lokal dan safety P5M', '${today}T13:00:00Z', '${today}T14:00:00Z', 1.0)
      ON CONFLICT DO NOTHING;
    `);

    // 8. Seed Breakdown Logs
    const bdRes = await pool.query("SELECT id FROM master_breakdown_codes LIMIT 2");
    const bd1Id = bdRes.rows[0]?.id;

    await pool.query(`
      INSERT INTO breakdown_logs (tanggal, shift_id, equipment_id, breakdown_code_id, description, remark, start_time, finish_time, total_breakdown_hours, status, current_status)
      VALUES
        ('${today}', '${shift1Id}', '${dt3Id}', '${bd1Id}', 'Overheat radiator suhu di atas 95C', 'Perbaikan penggantian hose radiator', '${today}T11:00:00Z', '${today}T13:30:00Z', 2.5, 'resolved', 'resolved')
      ON CONFLICT DO NOTHING;
    `);

    // 9. Seed Fleet Mappings
    const fleetRes = await pool.query(`
      INSERT INTO fleet_mappings (tanggal, shift_id, nama_fleet, excavator_id, loading_point_id, disposal_id, material_type)
      VALUES ('${today}', '${shift1Id}', 'Fleet Alpha (EXC-01)', '${exc1Id}', '${lp1Id}', '${disp1Id}', 'Overburden')
      RETURNING id
    `);
    const fleetId = fleetRes.rows[0]?.id;

    if (fleetId) {
      await pool.query(`
        INSERT INTO fleet_mapping_trucks (fleet_mapping_id, dump_truck_id)
        VALUES ('${fleetId}', '${dt1Id}'), ('${fleetId}', '${dt2Id}')
        ON CONFLICT DO NOTHING;
      `);
    }

    // 10. Seed Ritase Logs (Input Ritase)
    await pool.query(`
      INSERT INTO ritase_logs (tanggal, shift_id, fleet_mapping_id, excavator_id, dump_truck_id, operator_id, material, loading_point_id, disposal_id, ritase_count, production_volume, average_cycle_time, remark)
      VALUES
        ('${today}', '${shift1Id}', ${fleetId ? `'${fleetId}'` : 'NULL'}, '${exc1Id}', '${dt1Id}', ${userId ? `'${userId}'` : 'NULL'}, 'Overburden', '${lp1Id}', '${disp1Id}', 18, 360.0, 17.5, 'Hauling OB ritase bagus'),
        ('${today}', '${shift1Id}', ${fleetId ? `'${fleetId}'` : 'NULL'}, '${exc1Id}', '${dt2Id}', ${userId ? `'${userId}'` : 'NULL'}, 'Overburden', '${lp1Id}', '${disp1Id}', 16, 320.0, 18.2, 'Hauling OB ritase normal'),
        ('${today}', '${shift1Id}', NULL, '${exc2Id}', '${dt3Id}', ${userId ? `'${userId}'` : 'NULL'}, 'Coal', '${lp2Id}', '${disp2Id}', 22, 660.0, 15.0, 'Getting Coal Seam 5B fast cycle')
      ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Data dummy produksi tambang berhasil diisikan ke database!');
  } catch (err) {
    console.error('⚠️ Peringatan Seeder Data Dummy:', err.message);
  }
}

// Jalankan seeder jika dipanggil langsung
if (require.main === module) {
  seedDummyData().then(() => pool.end());
}

module.exports = seedDummyData;
