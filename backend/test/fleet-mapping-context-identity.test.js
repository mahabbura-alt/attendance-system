'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controller = fs.readFileSync(path.join(__dirname, '../src/controllers/production.controller.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/039_fleet_mapping_operational_context_unique.sql'), 'utf8');

test('fleet mapping uniqueness uses date, shift, excavator, PIT/Area, JOB, and material', () => {
  const start = controller.indexOf('static async createFleetMapping');
  const handler = controller.slice(start, controller.indexOf('static async deleteFleetMapping', start));

  assert.match(handler, /fleet_mapping_id/);
  assert.match(handler, /tanggal = \$1 AND shift_id = \$2 AND excavator_id = \$3/);
  assert.match(handler, /LOWER\(BTRIM\(COALESCE\(pit_area/);
  assert.match(handler, /LOWER\(BTRIM\(COALESCE\(job_code/);
  assert.match(handler, /LOWER\(BTRIM\(COALESCE\(material_detail/);
  assert.match(handler, /id <> \$7::uuid/);
  assert.match(handler, /sudah ada pada tanggal serta shift ini/);
  assert.doesNotMatch(handler, /const find = await pool\.query/);
});

test('database race guard uses the same normalized operational context and preserves soft-deleted history', () => {
  assert.match(migration, /CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_fleet_mapping_operational_context/);
  assert.match(migration, /tanggal,[\s\S]*shift_id,[\s\S]*excavator_id/);
  assert.match(migration, /LOWER\(BTRIM\(COALESCE\(pit_area/);
  assert.match(migration, /LOWER\(BTRIM\(COALESCE\(job_code/);
  assert.match(migration, /LOWER\(BTRIM\(COALESCE\(material_detail/);
  assert.match(migration, /WHERE deleted_at IS NULL/);
});
