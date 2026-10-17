'use strict';

const { available, createTestDb } = require('./pgliteDb');

const MIGRATIONS = [
  'migrations/064_workforce_movements_mpp.sql',
  'migrations/073_hse_fase1_hazard_capa.sql',
  'migrations/075_hse_fase3_competency.sql',
  'migrations/093_people_personal_nrp.sql',
  'migrations/094_people_attendance_locations.sql',
  'migrations/095_people_documents.sql',
  'migrations/096_people_family.sql',
  'migrations/097_people_movement_v2.sql',
  'migrations/098_people_import.sql',
];

const scope = { tenantKey: 'default', projectKey: 'default' };

/** DB People siap pakai + admin + master contoh (Admin ada di 2 departemen). */
async function createPeopleDb() {
  const db = await createTestDb(MIGRATIONS);
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const admin = await one(`INSERT INTO users (nama, email, password_hash, role, is_super_admin)
    VALUES ('Admin HR', 'hr@pim.co.id', 'x', 'admin', TRUE) RETURNING id, nama, role, is_super_admin`);
  const approver = await one(`INSERT INTO users (nama, email, password_hash, role, is_super_admin, permissions)
    VALUES ('Approver HR', 'approver@pim.co.id', 'x', 'admin', FALSE, '["people.approve"]'::jsonb) RETURNING id, nama, role, is_super_admin, permissions`);
  const dept = async name => one(`INSERT INTO workforce_departments (tenant_key, project_key, code, name)
    VALUES ('default','default',upper($1),$1) RETURNING id, name`, [name]);
  const pos = async (d, name) => one(`INSERT INTO workforce_positions (tenant_key, project_key, department_id, name)
    VALUES ('default','default',$1,$2) RETURNING id, name, department_id`, [d.id, name]);
  const produksi = await dept('Produksi');
  const engineering = await dept('Engineering');
  const logistik = await dept('Logistik');
  const positions = {
    operatorDt: await pos(produksi, 'Operator Dump Truck'),
    foreman: await pos(produksi, 'Foreman Produksi'),
    adminEng: await pos(engineering, 'Admin'),
    adminLog: await pos(logistik, 'Admin'),
    fuelman: await pos(logistik, 'Fuelman'),
  };
  const lokasi = {
    pit1: await one(`INSERT INTO lokasi_kantor (nama_lokasi, latitude, longitude, radius_meter) VALUES ('Pos Pit 1', -3.40, 115.90, 300) RETURNING id, nama_lokasi`),
    pit3: await one(`INSERT INTO lokasi_kantor (nama_lokasi, latitude, longitude, radius_meter) VALUES ('Pos Pit 3', -3.50, 115.95, 300) RETURNING id, nama_lokasi`),
    office: await one(`INSERT INTO lokasi_kantor (nama_lokasi, latitude, longitude, radius_meter) VALUES ('Office Batulicin', -3.45, 116.00, 100) RETURNING id, nama_lokasi`),
  };
  return { db, admin, approver, departments: { produksi, engineering, logistik }, positions, lokasi, scope };
}

module.exports = { available, createPeopleDb, scope, MIGRATIONS };
