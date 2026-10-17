'use strict';
require('dotenv').config();
const fs=require('fs');
const path=require('path');
const {pool}=require('../config/db');
async function main(){
  await pool.query(fs.readFileSync(path.join(__dirname,'../../migrations/062_logistics.sql'),'utf8'));
  const tables=await pool.query(`
    SELECT c.relname AS table_name, c.relrowsecurity AS row_security
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname LIKE 'logistics_%'
    ORDER BY c.relname`);
  const foreignKeys=await pool.query(`
    SELECT COUNT(*)::int AS count FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid
    WHERE c.contype='f' AND t.relname LIKE 'logistics_%'`);
  const indexes=await pool.query(`
    SELECT COUNT(*)::int AS count FROM pg_indexes
    WHERE schemaname='public' AND tablename LIKE 'logistics_%'`);
  const managers=await pool.query(`
    SELECT COUNT(*)::int AS count FROM logistics_memberships
    WHERE tenant_key='default' AND project_key='default' AND role='manager'`);
  if(tables.rows.length!==9 || tables.rows.some(row=>!row.row_security)){
    throw new Error('Verifikasi Migration 062 gagal: tabel atau RLS tidak lengkap.');
  }
  console.log(JSON.stringify({
    tables:tables.rows.length,
    rls_enabled:tables.rows.filter(row=>row.row_security).length,
    foreign_keys:foreignKeys.rows[0].count,
    indexes:indexes.rows[0].count,
    seeded_default_managers:managers.rows[0].count
  }));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(()=>pool.end());
