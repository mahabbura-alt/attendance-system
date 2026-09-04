const { pool } = require('./config/db');

async function checkShifts() {
  try {
    const { rows } = await pool.query('SELECT * FROM shifts ORDER BY created_at ASC');
    console.log('=== SHIFTS CONFIGURATION ===');
    console.log(JSON.stringify(rows, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkShifts();
