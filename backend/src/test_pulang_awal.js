const { pool } = require('./config/db');

async function testConstraint() {
  try {
    const u = await pool.query('SELECT id FROM users LIMIT 1');
    const s = await pool.query('SELECT id FROM shifts LIMIT 1');

    const res = await pool.query(
      `INSERT INTO absensi (user_id, shift_id, tanggal_kerja, waktu_datang, waktu_pulang, status_datang, status_pulang)
       VALUES ($1, $2, CURRENT_DATE, NOW(), NOW(), 'tepat waktu', 'pulang awal')
       RETURNING id, status_pulang`,
      [u.rows[0].id, s.rows[0].id]
    );

    console.log('✅ TEST INSERT "pulang awal" SUCCESSFUL:', res.rows[0]);
    await pool.query('DELETE FROM absensi WHERE id = $1', [res.rows[0].id]);
    console.log('✅ Cleaned up test record.');
    process.exit(0);
  } catch (err) {
    console.error('❌ FAIL:', err.message);
    process.exit(1);
  }
}

testConstraint();
