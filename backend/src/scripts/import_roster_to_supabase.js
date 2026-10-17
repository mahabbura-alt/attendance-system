const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const fs = require('fs');
const readline = require('readline');
const { pool } = require(path.join(__dirname, '../config/db'));

async function importRoster(filePath) {
  console.log(`Streaming ${filePath}...`);
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const client = await pool.connect();
  let buffer = [];
  let total = 0;
  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed.startsWith('INSERT INTO ')) {
        let sql = trimmed;
        if (!sql.endsWith(';')) sql += ';';
        sql = sql.replace(/;$/, ' ON CONFLICT DO NOTHING;');
        buffer.push(sql);

        if (buffer.length >= 500) {
          const batchSql = buffer.join('\n');
          await client.query(batchSql);
          total += buffer.length;
          console.log(`Progress: ${total} rows imported`);
          buffer = [];
        }
      }
    }
    if (buffer.length > 0) {
      const batchSql = buffer.join('\n');
      await client.query(batchSql);
      total += buffer.length;
      buffer = [];
    }
    console.log(`Selesai! Total ${total} baris roster berhasil diimpor.`);
  } catch (err) {
    console.error('Error saat import roster:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

importRoster('biznet_roster_data_utf8.sql');
