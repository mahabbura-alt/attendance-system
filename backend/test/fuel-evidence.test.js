'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const dbCfg = require('../src/config/db');
const evidence = require('../src/services/fuelEvidence');
const { compareInventory } = require('../src/scripts/fuelEvidenceReconcile');

const OPERATOR = { id: '11111111-1111-4111-8111-111111111111', role: 'karyawan', permissions: ['fuel.operator'] };
const LAIN = { id: '22222222-2222-4222-8222-222222222222', role: 'karyawan', permissions: ['fuel.operator'] };
const ADMIN = { id: '33333333-3333-4333-8333-333333333333', role: 'admin', permissions: [] };

const SLOTS = [
  { transaction_kind: 'receipt', slot_code: 'delivery_order', label: 'DO', is_required: true, capture_source: 'camera_or_scan', sort_order: 10 },
  { transaction_kind: 'receipt', slot_code: 'segel', label: 'Segel', is_required: true, capture_source: 'camera', sort_order: 20 },
  { transaction_kind: 'receipt', slot_code: 'flow_meter', label: 'Meter', is_required: false, capture_source: 'camera', sort_order: 30 },
];

/** Mock pool berbasis memori untuk query fuel_attachments / slot / audit. */
function pasangMock() {
  const mem = { attachments: [], audit: [] };
  const lama = { query: dbCfg.pool.query, connect: dbCfg.pool.connect };
  const query = async (sql, args = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
    if (sql.includes('FROM fuel_evidence_config_state')) return { rows: [{ current_version: 1 }] };
    if (sql.includes('FROM fuel_evidence_slots')) return { rows: SLOTS.filter(s => !args[0] || s.transaction_kind === args[0]) };
    if (sql.includes('INSERT INTO fuel_inventory_audit')) { mem.audit.push(args); return { rows: [] }; }
    if (sql.includes('FROM fuel_attachments WHERE client_uuid')) return { rows: mem.attachments.filter(a => a.client_uuid === args[0]) };
    if (sql.includes('WHERE (stored_sha256 = $1')) {
      return { rows: mem.attachments.filter(a => a.stored_sha256 === args[0] || a.received_sha256 === args[1] || a.client_sha256 === args[1]).slice(0, 1) };
    }
    if (sql.includes('INSERT INTO fuel_attachments')) {
      const row = { id: args[0], client_uuid: args[1], slot_code: args[2], storage_key: args[3], thumbnail_key: args[4],
        mime_type: args[5], byte_size: args[6], width: args[7], height: args[8], original_byte_size: args[9],
        client_sha256: args[10], received_sha256: args[11], stored_sha256: args[12], server_recompressed: args[13],
        duplicate_of_id: args[14], captured_at: args[15], upload_source: args[20], uploaded_by: args[21],
        status: 'active', entity_type: null, entity_id: null, has_thumbnail: Boolean(args[4]) };
      mem.attachments.push(row);
      return { rows: [row] };
    }
    if (sql.includes('WHERE id = ANY($1::uuid[]) FOR UPDATE')) return { rows: mem.attachments.filter(a => args[0].includes(a.id)) };
    if (sql.includes('UPDATE fuel_attachments SET entity_type = $1')) {
      mem.attachments.filter(a => args[2].includes(a.id)).forEach(a => { a.entity_type = args[0]; a.entity_id = args[1]; });
      return { rows: [] };
    }
    if (sql.includes('SELECT slot_code, status FROM fuel_attachments')) {
      return { rows: mem.attachments.filter(a => a.entity_type === args[0] && a.entity_id === args[1]) };
    }
    throw new Error(`SQL tak dikenali mock: ${sql.slice(0, 80)}`);
  };
  dbCfg.pool.query = query;
  dbCfg.pool.connect = async () => ({ query, release() {} });
  return { mem, pulih() { dbCfg.pool.query = lama.query; dbCfg.pool.connect = lama.connect; } };
}

async function pasangStorage() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omos-fuel-bukti-'));
  process.env.STORAGE_PROVIDER = 'local';
  process.env.STORAGE_LOCAL_ROOT = root;
  return root;
}

const jpeg = (w, h, quality = 90) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 120, g: 90, b: 40 } } })
  .jpeg({ quality }).toBuffer();
const hash = b => crypto.createHash('sha256').update(b).digest('hex');

test('detectMime memakai magic bytes, bukan nama file', async () => {
  assert.equal(evidence.detectMime(await jpeg(10, 10)), 'image/jpeg');
  assert.equal(evidence.detectMime(Buffer.from('%PDF-1.7\n.......')), 'application/pdf');
  assert.equal(evidence.detectMime(Buffer.from('<html><script>x</script>')), null);
});

test('kindOf memetakan entitas/jenis transaksi ke kelompok slot', () => {
  assert.equal(evidence.kindOf('fuel_log'), 'issue_equipment');
  assert.equal(evidence.kindOf('opname'), 'opname');
  assert.equal(evidence.kindOf('transaction', 'transfer_out'), 'transfer');
  assert.equal(evidence.kindOf('transaction', 'receipt'), 'receipt');
  assert.equal(evidence.kindOf('transaction', 'loss'), null);
});

test('missingSlots hanya menghitung slot wajib dengan lampiran aktif', () => {
  const kurang = evidence.missingSlots(SLOTS, [
    { slot_code: 'delivery_order', status: 'active' },
    { slot_code: 'segel', status: 'replaced' },
  ]);
  assert.deepEqual(kurang.map(k => k.slot_code), ['segel']);
});

test('evaluateFlags: selisih jam > 2 dan hash dobel; GPS tidak dinilai', () => {
  const flags = evidence.evaluateFlags({ captured_at: '2026-10-17T08:00:00Z', duplicate_of_id: 'x', gps_lat: 0, gps_lng: 0 },
    '2026-10-17T11:10:00Z');
  assert.deepEqual(flags.map(f => f.code).sort(), ['capture_time_gap', 'duplicate_hash']);
  assert.equal(evidence.evaluateFlags({ captured_at: '2026-10-17T10:00:00Z' }, '2026-10-17T11:00:00Z').length, 0);
});

test('izin: admin atau permission fuel.operator', () => {
  assert.equal(evidence.isFuelOperator(ADMIN), true);
  assert.equal(evidence.isFuelOperator(OPERATOR), true);
  assert.equal(evidence.isFuelOperator({ id: 'x', role: 'karyawan', permissions: [] }), false);
});

test('prepareFile: foto besar dikompres ulang ≤1600px; foto kecil disimpan apa adanya', async () => {
  const besar = await evidence.prepareFile(await jpeg(3200, 2400));
  assert.equal(besar.recompressed, true);
  assert.ok(Math.max(besar.width, besar.height) <= 1600);
  assert.ok(besar.thumb.length > 0);
  const kecilAsli = await jpeg(800, 600);
  const kecil = await evidence.prepareFile(kecilAsli);
  assert.equal(kecil.recompressed, false);
  assert.ok(kecil.stored.equals(kecilAsli));
  await assert.rejects(evidence.prepareFile(Buffer.from('bukan gambar sama sekali')), e => e.status === 415);
});

test('uploadAttachment: hash HP harus cocok, idempoten per client_uuid, dua hash saat dikompres', async () => {
  const root = await pasangStorage();
  const { mem, pulih } = pasangMock();
  try {
    const foto = await jpeg(3000, 2000);
    await assert.rejects(evidence.uploadAttachment(foto, { slot_code: 'segel', client_sha256: 'a'.repeat(64) }, OPERATOR),
      e => e.code === 'FILE_HASH_MISMATCH');

    const clientUuid = crypto.randomUUID();
    const row = await evidence.uploadAttachment(foto, { slot_code: 'segel', client_sha256: hash(foto), client_uuid: clientUuid, upload_source: 'mobile' }, OPERATOR);
    assert.equal(row.server_recompressed, true);
    assert.equal(row.received_sha256, hash(foto));
    assert.notEqual(row.stored_sha256, row.received_sha256);
    const tersimpan = await fs.readFile(path.join(root, 'fuel-bukti', mem.attachments[0].storage_key));
    assert.equal(hash(tersimpan), row.stored_sha256);

    const ulang = await evidence.uploadAttachment(foto, { slot_code: 'segel', client_uuid: clientUuid }, OPERATOR);
    assert.equal(ulang.idempotent_replay, true);
    assert.equal(mem.attachments.length, 1);
    await assert.rejects(evidence.uploadAttachment(foto, { slot_code: 'segel', client_uuid: clientUuid }, LAIN), e => e.status === 409);

    const dobel = await evidence.uploadAttachment(foto, { slot_code: 'segel' }, OPERATOR);
    assert.equal(dobel.duplicate_of_id, row.id);

    await assert.rejects(evidence.uploadAttachment(foto, { slot_code: 'segel' }, { id: 'x', role: 'karyawan', permissions: [] }),
      e => e.status === 403);
  } finally {
    pulih();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('linkAttachments: APK wajib lengkap, hanya milik sendiri, slot harus berlaku', async () => {
  const root = await pasangStorage();
  const { pulih } = pasangMock();
  const tx = crypto.randomUUID();
  try {
    const db = { query: dbCfg.pool.query };
    const doFoto = await evidence.uploadAttachment(await jpeg(400, 300), { slot_code: 'delivery_order' }, OPERATOR);
    await assert.rejects(evidence.linkAttachments(db, { entityType: 'transaction', entityId: tx, transactionType: 'receipt',
      attachmentIds: [doFoto.id], requireComplete: true, user: OPERATOR }),
    e => e.code === 'EVIDENCE_INCOMPLETE' && e.details.missing.map(m => m.slot_code).join() === 'segel');

    await assert.rejects(evidence.linkAttachments(db, { entityType: 'transaction', entityId: tx, transactionType: 'receipt',
      attachmentIds: [doFoto.id], user: LAIN }), e => e.status === 403);

    const salahSlot = await evidence.uploadAttachment(await jpeg(400, 301), { slot_code: 'hm_km' }, OPERATOR);
    await assert.rejects(evidence.linkAttachments(db, { entityType: 'transaction', entityId: tx, transactionType: 'receipt',
      attachmentIds: [salahSlot.id], user: OPERATOR }), e => e.status === 422);

    const segel = await evidence.uploadAttachment(await jpeg(400, 302), { slot_code: 'segel' }, OPERATOR);
    const ok = await evidence.linkAttachments(db, { entityType: 'transaction', entityId: tx, transactionType: 'receipt',
      attachmentIds: [doFoto.id, segel.id], requireComplete: true, user: OPERATOR });
    assert.deepEqual(ok, { config_version: 1, linked: 2 });

    // Input manual dashboard tanpa lampiran tidak diwajibkan.
    const kosong = await evidence.linkAttachments(db, { entityType: 'transaction', entityId: crypto.randomUUID(),
      transactionType: 'receipt', attachmentIds: [], requireComplete: false, user: ADMIN });
    assert.equal(kosong.linked, 0);
  } finally {
    pulih();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('rekonsiliasi: file hilang, file tanpa baris, kandidat orphan > 30 hari', () => {
  const now = new Date('2026-10-17T00:00:00Z');
  const hasil = compareInventory([
    { id: 'a', storage_key: 'fuel/2026/10/a.jpg', thumbnail_key: 'fuel/2026/10/a-thumb.jpg', entity_id: 'e', status: 'active', uploaded_at: '2026-10-01' },
    { id: 'b', storage_key: 'fuel/2026/08/b.jpg', thumbnail_key: null, entity_id: null, status: 'active', uploaded_at: '2026-08-01' },
    { id: 'c', storage_key: 'fuel/2026/10/c.jpg', thumbnail_key: null, entity_id: null, status: 'active', uploaded_at: '2026-10-10' },
  ], ['fuel/2026/10/a.jpg', 'fuel/2026/08/b.jpg', 'fuel/2026/10/c.jpg', 'fuel/2026/10/z.jpg', 'fuel/2026/10/q.jpg.123.tmp'], now);
  assert.deepEqual(hasil.missingFiles, [{ id: 'a', key: 'fuel/2026/10/a-thumb.jpg' }]);
  assert.deepEqual(hasil.filesWithoutRow, ['fuel/2026/10/z.jpg']);
  assert.deepEqual(hasil.orphanCandidates, ['b']);
});

test('storage bukti terpisah dari /api/storage/view publik', async () => {
  const root = await pasangStorage();
  delete require.cache[require.resolve('../src/services/storage')];
  const storage = require('../src/services/storage');
  try {
    await storage.putEvidenceObject('fuel/2026/10/x.jpg', Buffer.from('rahasia'), 'image/jpeg');
    assert.equal((await storage.readEvidenceObject('fuel/2026/10/x.jpg')).toString(), 'rahasia');
    await assert.rejects(storage.putEvidenceObject('absensi/x.jpg', Buffer.from('a'), 'image/jpeg'), /tidak valid/);
    const res = { status(c) { this.code = c; return this; }, send() { return this; }, setHeader() {}, sendFile(p) { this.file = p; } };
    await storage.streamFoto('fuel/2026/10/x.jpg', res);
    assert.equal(res.code, 404, 'file bukti tidak boleh terbaca lewat endpoint foto publik');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
