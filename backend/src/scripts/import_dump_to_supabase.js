const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const fs = require('fs');
const { pool } = require(path.join(__dirname, '../config/db'));

async function importSql(filePath) {
  console.log(`Membaca ${filePath}...`);
  const content = fs.readFileSync(filePath, 'utf8');
  // Ambil hanya statement INSERT
  const lines = content.split('\n');
  const insertStatements = lines.filter(l => l.trim().startsWith('INSERT INTO '));
  console.log(`Ditemukan ${insertStatements.length} statement INSERT.`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let count = 0;
    for (const stmt of insertStatements) {
      // Hilangkan public. jika perlu atau biarkan
      // Gunakan ON CONFLICT DO NOTHING agar aman jika sudah ada
      let sql = stmt.trim();
      if (!sql.endsWith(';')) sql += ';';
      // replace INSERT INTO <table> VALUES (...) dengan ON CONFLICT DO NOTHING
      sql = sql.replace(/;$/, ' ON CONFLICT DO NOTHING;');
      await client.query(sql);
      count++;
      if (count % 100 === 0) {
        process.stdout.write(`\rProgress: ${count}/${insertStatements.length}`);
      }
    }
    await client.query('COMMIT');
    console.log(`\nBerhasil mengimpor ${count} data ke database!`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nError saat import:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

const file = process.argv[2] || 'biznet_leave_data.sql';
importSql(file);
