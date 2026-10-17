const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const client = await pool.connect();
  try {
    console.log('Running Migration 080: HSE Fase 8 Audit, SMKP & Dokumen Regulasi...');
    const sqlPath = path.resolve(__dirname, '../../migrations/080_hse_fase8_audit_compliance_docs.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    console.log('Migration 080 HSE Fase 8 completed successfully!');

    // Verification check
    const tablesCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN (
          'hse_smkp_elements',
          'hse_audits',
          'hse_audit_findings',
          'hse_documents',
          'hse_document_revisions',
          'hse_legal_register',
          'hse_mandatory_reports'
        );
    `);
    console.log(`Verified ${tablesCheck.rows.length} Fase 8 tables exist:`, tablesCheck.rows.map(r => r.table_name));

    const smkpCount = await client.query('SELECT count(*) FROM hse_smkp_elements');
    console.log(`Verified SMKP Minerba elements seeded: ${smkpCount.rows[0].count} elements`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration 080 failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
