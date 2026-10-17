'use strict';

/**
 * Database PostgreSQL nyata (PGlite, in-process) untuk test integrasi SQL.
 * Memuat schema dasar + migrasi yang diminta. Bila paket PGlite tidak
 * terpasang, `available` = false dan test yang memakainya di-skip.
 */
const fs = require('fs');
const path = require('path');

let PGlite = null;
let btreeGist = null;
try {
  ({ PGlite } = require('@electric-sql/pglite'));
  ({ btree_gist: btreeGist } = require('@electric-sql/pglite/contrib/btree_gist'));
} catch (_) { /* opsional */ }

const ROOT = path.resolve(__dirname, '../..');

function readSql(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";.*\n/g, '');
}

async function createTestDb(migrations = []) {
  if (!PGlite) throw new Error('PGlite tidak tersedia');
  const pg = new PGlite({ extensions: btreeGist ? { btree_gist: btreeGist } : {} });
  await pg.exec(readSql('sql/schema.sql'));
  await pg.exec(`ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id VARCHAR(50);
    CREATE TABLE IF NOT EXISTS keterangan_presensi (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID REFERENCES users(id),
      tanggal DATE NOT NULL, kategori VARCHAR(30) NOT NULL, catatan TEXT,
      created_at TIMESTAMPTZ DEFAULT now(), UNIQUE(user_id, tanggal));`);
  for (const m of migrations) await pg.exec(readSql(m));

  const query = async (text, params) => {
    const r = await pg.query(text, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  const client = { query, release() {} };
  const db = { query, connect: async () => client, pg, exec: sql => pg.exec(sql), close: () => pg.close() };
  return db;
}

module.exports = { available: Boolean(PGlite), createTestDb, readSql };
