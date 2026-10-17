/**
 * Rekonsiliasi bukti Fuel: database fuel_attachments ↔ file di bucket fuel-bukti.
 *   node src/scripts/fuelEvidenceReconcile.js           → laporan saja (dry-run)
 *   node src/scripts/fuelEvidenceReconcile.js --apply   → tandai lampiran yatim > 30 hari sebagai 'orphan'
 * Tidak pernah menghapus file atau baris. Penghapusan permanen hanya lewat
 * keputusan owner di luar skrip ini.
 */
require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const storage = require('../services/storage');
const { ORPHAN_AFTER_DAYS } = require('../services/fuelEvidence');

/** Bandingkan baris DB dengan daftar key di storage (fungsi murni, diuji). */
function compareInventory(rows, fileKeys, now = new Date(), orphanDays = ORPHAN_AFTER_DAYS) {
  const files = new Set(fileKeys);
  const referenced = new Set();
  const missingFiles = [];
  const orphanCandidates = [];
  const batas = now.getTime() - orphanDays * 86400000;
  for (const row of rows) {
    for (const key of [row.storage_key, row.thumbnail_key].filter(Boolean)) {
      referenced.add(key);
      if (!files.has(key)) missingFiles.push({ id: row.id, key });
    }
    if (!row.entity_id && row.status === 'active' && Date.parse(row.uploaded_at) < batas) {
      orphanCandidates.push(row.id);
    }
  }
  const filesWithoutRow = fileKeys.filter(k => !referenced.has(k) && !k.endsWith('.tmp'));
  return { missingFiles, filesWithoutRow, orphanCandidates };
}

async function listLocalKeys(root) {
  const keys = [];
  async function jalan(dir) {
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await jalan(full);
      else keys.push(path.relative(root, full).split(path.sep).join('/'));
    }
  }
  await jalan(root);
  return keys;
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (storage.storageProvider() !== 'local') {
    console.log('Rekonsiliasi file hanya untuk STORAGE_PROVIDER=local. Script berhenti.');
    return;
  }
  const { pool } = require('../config/db');
  try {
    const { rows } = await pool.query(
      'SELECT id, storage_key, thumbnail_key, entity_id, status, uploaded_at FROM fuel_attachments');
    const keys = await listLocalKeys(storage.localBucketRoot(storage.EVIDENCE_BUCKET));
    const hasil = compareInventory(rows, keys);
    console.log(JSON.stringify({
      rows: rows.length, files: keys.length,
      missing_files: hasil.missingFiles.length, files_without_row: hasil.filesWithoutRow.length,
      orphan_candidates: hasil.orphanCandidates.length, mode: apply ? 'apply' : 'dry-run',
    }, null, 2));
    for (const m of hasil.missingFiles.slice(0, 50)) console.log(`HILANG  ${m.id}  ${m.key}`);
    for (const k of hasil.filesWithoutRow.slice(0, 50)) console.log(`TANPA-BARIS  ${k}`);
    if (apply && hasil.orphanCandidates.length) {
      const r = await pool.query(
        `UPDATE fuel_attachments SET status = 'orphan', status_reason = $2, status_changed_at = now()
         WHERE id = ANY($1::uuid[]) AND entity_id IS NULL AND status = 'active'`,
        [hasil.orphanCandidates, `tidak tertaut > ${ORPHAN_AFTER_DAYS} hari (rekonsiliasi otomatis)`]);
      console.log(`Ditandai orphan: ${r.rowCount}`);
    }
  } finally {
    await pool.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { compareInventory, listLocalKeys };
