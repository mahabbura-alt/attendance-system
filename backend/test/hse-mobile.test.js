'use strict';

/** OMOS Safety (APK HSE): sinkronisasi idempoten, siklus PIC → delegator → verifikasi, dengan DB PGlite nyata. */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { available, createTestDb } = require('./helpers/pgliteDb');
const mobile = require('../src/services/hseMobile');

const MIGRATIONS = [
  '064_workforce_movements_mpp', '073_hse_fase1_hazard_capa', '074_hse_fase2_incidents_reports',
  '076_hse_fase4_ptw_inspections', '078_hse_fase6_emergency_ppe', '082_hse_setup_area_sub_area',
  '083_hazard_consequence_and_reporter', '084_hse_setup_inspections', '085_hse_inspection_schedules',
  '086_hse_inspection_personnel_scope', '087_hse_hazard_categories_and_smart_merge', '088_hse_hazard_report_targets',
  '089_hse_p5m_safetytalk_targets', '090_hse_p5m_safetytalk_events', '091_hse_inspection_attachments',
  '101_hse_mobile_safety', '102_hse_hazard_recommendation',
].map(m => `migrations/${m}.sql`);
const hse = require('../src/services/hse');

// PNG 1x1 valid.
const PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SCOPE = { tenantKey: 'default', projectKey: 'default' };
const uuid = () => crypto.randomUUID();

async function seed(db) {
  const user = async (nama, departemen, jabatan, role = 'karyawan') => (await db.query(
    `INSERT INTO users (nama, email, jabatan, departemen, password_hash, role, employee_id)
     VALUES ($1, $2, $3, $4, 'x', $5, $6) RETURNING id`,
    [nama, `${nama.toLowerCase().replace(/\s+/g, '.')}@t.id`, jabatan, departemen, role, `EMP-${nama.slice(0, 4).toUpperCase()}`],
  )).rows[0].id;
  const dept = async (name) => (await db.query(`INSERT INTO workforce_departments (name) VALUES ($1) RETURNING id`, [name])).rows[0].id;
  const ids = {
    produksi: await dept('Produksi'),
    hseDept: await dept('HSE'),
    engineering: await dept('Engineering'),
    reporter: await user('Rudi Pelapor', 'Produksi', 'Operator HD'),
    pic1: await user('Pita Satu', 'Produksi', 'Foreman Produksi'),
    pic2: await user('Pita Dua', 'Produksi', 'Foreman Produksi'),
    head: await user('Dedi Kepala', 'Produksi', 'Superintendent Produksi'),
    hse: await user('Hana Safety', 'HSE', 'HSE Officer'),
    eng: await user('Eko Engineer', 'Engineering', 'Engineer'),
    engHead: await user('Eva Kepala', 'Engineering', 'Engineering Manager'),
    outsider: await user('Oki Luar', 'Logistik', 'Admin'),
    admin: await user('Ani Admin', 'HRGA', 'Admin', 'admin'),
  };
  const area = (await db.query(`INSERT INTO hse_locations (code, name, type) VALUES ('HAUL', 'Jalan Hauling', 'HAUL_ROAD') RETURNING id`)).rows[0].id;
  ids.area = area;
  ids.sub = (await db.query(`INSERT INTO hse_locations (code, name, type, parent_id) VALUES ('KM3', 'KM 3', 'HAUL_ROAD', $1) RETURNING id`, [area])).rows[0].id;
  return ids;
}

const hazardPayload = (ids, over = {}) => ({
  category_code: 'UNSAFE_CONDITION', location_id: ids.sub, occurred_at: new Date(Date.now() - 3600e3).toISOString(),
  description: 'Tanggul jalan hauling KM 3 longsor sebagian', recommendation: 'Tinggikan tanggul minimal 3/4 roda HD',
  potential_consequence: 'HD tergelincir keluar jalur saat berpapasan',
  immediate_action: 'Cone dipasang 20 m sebelum titik', likelihood: 3, consequence: 4, photos: [PHOTO], pic_ids: [ids.pic1], ...over,
});

async function sync(db, userId, type, payload, clientUuid = uuid()) {
  const { results } = await mobile.syncItems(db, SCOPE, userId, [{ client_uuid: clientUuid, type, payload }]);
  return results[0];
}

test('OMOS Safety: hazard idempoten, koreksi, PIC → delegator → verifikasi, konflik & notifikasi', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  const ids = await seed(db);
  const admin = { id: ids.admin };

  await mobile.setDepartmentDelegator(db, SCOPE, admin, ids.produksi, { delegator_user_id: ids.head });
  await mobile.setDepartmentDelegator(db, SCOPE, admin, ids.engineering, { delegator_user_id: ids.engHead });
  await assert.rejects(mobile.setDepartmentDelegator(db, SCOPE, admin, ids.produksi, { delegator_user_id: ids.eng }), /karyawan aktif di departemen Produksi/);
  const delegators = await mobile.listDepartmentDelegators(db, SCOPE);
  assert.equal(delegators.find(d => d.department_name === 'Produksi').delegator_name, 'Dedi Kepala');

  // Buat hazard + kirim ulang dengan client_uuid sama → data tidak ganda.
  const cu = uuid();
  const created = await sync(db, ids.reporter, 'HAZARD_CREATE', hazardPayload(ids), cu);
  assert.equal(created.status, 'OK', JSON.stringify(created));
  const again = await sync(db, ids.reporter, 'HAZARD_CREATE', hazardPayload(ids), cu);
  assert.equal(again.status, 'OK');
  assert.equal(again.server_id, created.server_id);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM hazard_reports')).rows[0].n, 1);
  const hazardId = created.server_id;

  // Validasi: foto wajib, PIC wajib, lokasi nonaktif → MASTER_INACTIVE.
  assert.equal((await sync(db, ids.reporter, 'HAZARD_CREATE', hazardPayload(ids, { photos: [] }))).code, 'VALIDATION');
  assert.equal((await sync(db, ids.reporter, 'HAZARD_CREATE', hazardPayload(ids, { pic_ids: [] }))).code, 'VALIDATION');

  // Koreksi oleh pelapor sebelum diproses → revisi tersimpan.
  const corr = await sync(db, ids.reporter, 'HAZARD_CORRECT', { hazard_id: hazardId, fields: { description: 'Tanggul KM 3 longsor, tinggi < 1/2 roda HD', consequence: 3 } });
  assert.equal(corr.status, 'OK', JSON.stringify(corr));
  assert.equal(corr.revision_no, 1);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM hse_hazard_revisions WHERE hazard_id = $1', [hazardId])).rows[0].n, 1);
  assert.equal((await sync(db, ids.pic1, 'HAZARD_CORRECT', { hazard_id: hazardId, fields: { description: 'x' } })).code, 'CONFLICT_STATE');

  // Konsekuensi & rekomendasi tersimpan di hazard; rekomendasi = uraian CAPA PIC dan ikut koreksi pelapor.
  let hz = (await db.query('SELECT potential_consequence, recommendation FROM hazard_reports WHERE id = $1', [hazardId])).rows[0];
  assert.equal(hz.potential_consequence, 'HD tergelincir keluar jalur saat berpapasan');
  assert.equal(hz.recommendation, 'Tinggikan tanggul minimal 3/4 roda HD');
  assert.equal((await sync(db, ids.reporter, 'HAZARD_CORRECT', { hazard_id: hazardId, fields: { recommendation: ' ' } })).code, 'VALIDATION');
  const corr2 = await sync(db, ids.reporter, 'HAZARD_CORRECT', { hazard_id: hazardId, fields: { recommendation: 'Tinggikan tanggul & pasang delineator', potential_consequence: 'HD terguling' } });
  assert.equal(corr2.status, 'OK', JSON.stringify(corr2));
  assert.equal((await db.query(`SELECT description FROM hse_actions WHERE source_id = $1`, [hazardId])).rows[0].description, 'Tinggikan tanggul & pasang delineator');
  const picRow = (await mobile.getPicActions(db, SCOPE, ids.pic1))[0];
  assert.equal(picRow.potential_consequence, 'HD terguling');
  assert.equal(picRow.recommendation, 'Tinggikan tanggul & pasang delineator');
  assert.equal(picRow.capa_total, 1);
  assert.equal(picRow.capa_closed, 0);

  // PIC mulai → koreksi/batal terkunci.
  const pic = await mobile.getPicActions(db, SCOPE, ids.pic1);
  assert.equal(pic.length, 1);
  const actionId = pic[0].action_id;
  assert.equal((await sync(db, ids.pic1, 'ACTION_START', { action_id: actionId })).status, 'OK');
  assert.equal((await sync(db, ids.reporter, 'HAZARD_CANCEL', { hazard_id: hazardId, reason: 'Salah input' })).code, 'CONFLICT_STATE');
  assert.equal((await db.query('SELECT status FROM hazard_reports WHERE id = $1', [hazardId])).rows[0].status, 'IN_ACTION');

  // Perpanjangan: maks 1 kali, permintaan menunggu tidak boleh ganda.
  const ext = await sync(db, ids.pic1, 'PIC_REQUEST', { action_id: actionId, request_type: 'EXTEND', reason: 'Material tiba 18 Okt', proposed_due_date: '2099-01-10' });
  assert.equal(ext.status, 'OK', JSON.stringify(ext));
  assert.equal((await sync(db, ids.pic1, 'PIC_REQUEST', { action_id: actionId, request_type: 'REASSIGN', reason: 'Bukan area saya' })).code, 'CONFLICT_PENDING');
  assert.equal((await sync(db, ids.eng, 'DELEGATOR_DECISION', { request_id: ext.server_id, decision: 'APPROVE' })).code, 'FORBIDDEN');
  const inbox = await mobile.getDelegatorInbox(db, SCOPE, ids.head);
  assert.equal(inbox.requests.length, 1);
  const approved = await sync(db, ids.head, 'DELEGATOR_DECISION', { request_id: ext.server_id, decision: 'APPROVE' });
  assert.equal(approved.status, 'OK', JSON.stringify(approved));
  assert.equal((await db.query('SELECT extension_count, due_date::text AS d FROM hse_actions WHERE id = $1', [actionId])).rows[0].extension_count, 1);
  const ext2 = await sync(db, ids.pic1, 'PIC_REQUEST', { action_id: actionId, request_type: 'EXTEND', reason: 'Lagi', proposed_due_date: '2099-02-10' });
  assert.equal(ext2.code, 'VALIDATION');
  assert.match(ext2.message, /maksimal 1 kali/);

  // Pengalihan: delegator mengalihkan ke PIC lain di departemennya; PIC luar departemen ditolak.
  const re = await sync(db, ids.pic1, 'PIC_REQUEST', { action_id: actionId, request_type: 'REASSIGN', reason: 'Butuh alat Engineering', proposed_department_id: ids.engineering });
  assert.equal(re.status, 'OK');
  assert.equal((await sync(db, ids.head, 'DELEGATOR_DECISION', { request_id: re.server_id, decision: 'APPROVE', new_pic_id: ids.eng })).code, 'VALIDATION');
  const reOk = await sync(db, ids.head, 'DELEGATOR_DECISION', { request_id: re.server_id, decision: 'APPROVE', new_pic_id: ids.pic2 });
  assert.equal(reOk.status, 'OK', JSON.stringify(reOk));
  assert.equal(String((await db.query('SELECT pic_employee_id FROM hse_actions WHERE id = $1', [actionId])).rows[0].pic_employee_id), String(ids.pic2));
  assert.equal((await sync(db, ids.pic1, 'ACTION_EVIDENCE', { action_id: actionId, photos: [PHOTO] })).code, 'FORBIDDEN');

  // Bukti → verifikasi: tolak wajib alasan, lalu setujui → CLOSED.
  assert.equal((await sync(db, ids.pic2, 'ACTION_EVIDENCE', { action_id: actionId, photos: [], note: 'x' })).code, 'VALIDATION');
  assert.equal((await sync(db, ids.pic2, 'ACTION_EVIDENCE', { action_id: actionId, photos: [PHOTO], note: 'Tanggul ditinggikan' })).status, 'OK');
  assert.equal((await db.query('SELECT status FROM hazard_reports WHERE id = $1', [hazardId])).rows[0].status, 'VERIFY');
  assert.equal((await sync(db, ids.outsider, 'VERIFY_DECISION', { action_id: actionId, decision: 'APPROVE' })).code, 'FORBIDDEN');
  assert.equal((await sync(db, ids.reporter, 'VERIFY_DECISION', { action_id: actionId, decision: 'REJECT' })).code, 'VALIDATION');
  assert.equal((await sync(db, ids.reporter, 'VERIFY_DECISION', { action_id: actionId, decision: 'REJECT', reason: 'Foto belum jelas' })).status, 'OK');
  assert.equal((await db.query('SELECT status FROM hse_actions WHERE id = $1', [actionId])).rows[0].status, 'IN_PROGRESS');
  assert.equal((await sync(db, ids.pic2, 'ACTION_EVIDENCE', { action_id: actionId, photos: [PHOTO], note: 'Foto ulang' })).status, 'OK');
  const queue = await mobile.getVerifyQueue(db, SCOPE, ids.hse);
  assert.equal(queue.length, 1);
  assert.equal((await sync(db, ids.hse, 'VERIFY_DECISION', { action_id: actionId, decision: 'APPROVE' })).status, 'OK');
  assert.equal((await db.query('SELECT status FROM hazard_reports WHERE id = $1', [hazardId])).rows[0].status, 'CLOSED');

  // Data offline yang terlambat setelah hazard ditutup → CONFLICT_CLOSED; catatan tetap bisa dikirim.
  assert.equal((await sync(db, ids.pic2, 'ACTION_EVIDENCE', { action_id: actionId, photos: [PHOTO] })).code, 'CONFLICT_CLOSED');
  assert.equal((await sync(db, ids.pic2, 'HAZARD_NOTE', { hazard_id: hazardId, note: 'Bukti tambahan' })).status, 'OK');

  // Detail & otorisasi.
  const detail = await mobile.getHazardDetailForMobile(db, SCOPE, ids.reporter, hazardId);
  assert.ok(detail.events.some(e => e.event_type === 'EXTENDED'));
  assert.ok(detail.events.some(e => e.event_type === 'REASSIGNED'));
  assert.equal(detail.permissions.can_cancel, false);
  assert.deepEqual([detail.capa_progress.total, detail.capa_progress.closed, detail.capa_progress.percent], [1, 1, 100]);
  await assert.rejects(mobile.getHazardDetailForMobile(db, SCOPE, ids.outsider, hazardId), /tidak terlibat/);

  // Notifikasi (polling dengan kursor).
  const n = await mobile.listNotifications(db, SCOPE, ids.pic2, 0);
  assert.ok(n.items.some(i => i.kind === 'HAZARD_ASSIGNED'));
  assert.ok(n.unread_count > 0);
  const lastId = n.items[n.items.length - 1].id;
  assert.equal((await mobile.listNotifications(db, SCOPE, ids.pic2, lastId)).items.length, 0);
  await mobile.markNotificationsRead(db, SCOPE, ids.pic2, { all: true });
  assert.equal((await mobile.listNotifications(db, SCOPE, ids.pic2, 0)).unread_count, 0);
  await db.close();
});

test('OMOS Safety: Ekstrem tidak bisa diperpanjang, batal oleh pelapor, master nonaktif, insiden & pertemuan', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  const ids = await seed(db);
  await mobile.setDepartmentDelegator(db, SCOPE, { id: ids.admin }, ids.produksi, { delegator_user_id: ids.head, backup_user_id: ids.pic2 });

  const ext = await sync(db, ids.reporter, 'HAZARD_CREATE', hazardPayload(ids, { likelihood: 5, consequence: 5, stop_work: true }));
  assert.equal(ext.status, 'OK');
  const row = (await db.query('SELECT risk_level, stop_work, is_urgent FROM hazard_reports WHERE id = $1', [ext.server_id])).rows[0];
  assert.deepEqual([row.risk_level, row.stop_work, row.is_urgent], ['EXTREME', true, true]);
  const [action] = await mobile.getPicActions(db, SCOPE, ids.pic1);
  const hours = (new Date(action.due_at) - Date.now()) / 3600e3;
  assert.ok(hours > 23 && hours <= 24, `SLA Ekstrem 24 jam, dapat ${hours}`);
  const r = await sync(db, ids.pic1, 'PIC_REQUEST', { action_id: action.action_id, request_type: 'EXTEND', reason: 'x', proposed_due_date: '2099-01-01' });
  assert.equal(r.code, 'VALIDATION');
  assert.match(r.message, /Ekstrem/);

  // Delegator cadangan juga bisa memutuskan.
  assert.equal((await mobile.getDelegatorInbox(db, SCOPE, ids.pic2)).departments.length, 1);

  // Batal oleh pelapor saat masih baru.
  const h2 = await sync(db, ids.reporter, 'HAZARD_CREATE', hazardPayload(ids));
  assert.equal((await sync(db, ids.reporter, 'HAZARD_CANCEL', { hazard_id: h2.server_id, reason: '' })).code, 'VALIDATION');
  assert.equal((await sync(db, ids.reporter, 'HAZARD_CANCEL', { hazard_id: h2.server_id, reason: 'Sudah dilaporkan orang lain' })).status, 'OK');
  assert.equal((await db.query('SELECT status FROM hazard_reports WHERE id = $1', [h2.server_id])).rows[0].status, 'CANCELLED');
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM hse_actions WHERE source_id = $1 AND status = 'CANCELLED'`, [h2.server_id])).rows[0].n, 1);

  // Master lokasi dinonaktifkan → MASTER_INACTIVE.
  await db.query('UPDATE hse_locations SET is_active = FALSE WHERE id = $1', [ids.sub]);
  const inactive = await sync(db, ids.reporter, 'HAZARD_CREATE', hazardPayload(ids));
  assert.equal(inactive.code, 'MASTER_INACTIVE');
  await db.query('UPDATE hse_locations SET is_active = TRUE WHERE id = $1', [ids.sub]);

  // Insiden: tindakan segera wajib; cedera berobat → MTI; idempoten.
  const incPayload = { category: 'INJURY', occurred_at: new Date().toISOString(), location_id: ids.sub, unit_code: 'DT-045',
    description: 'Operator terjepit pintu kabin', immediate_action: 'Dibawa ke klinik', victim: { user_id: ids.pic1, body_part: 'tangan kiri', treatment: 'MEDICAL' },
    witnesses: ['Saksi A'], photos: [PHOTO] };
  assert.equal((await sync(db, ids.reporter, 'INCIDENT_CREATE', { ...incPayload, immediate_action: '' })).code, 'VALIDATION');
  const icu = uuid();
  const inc = await sync(db, ids.reporter, 'INCIDENT_CREATE', incPayload, icu);
  assert.equal(inc.status, 'OK', JSON.stringify(inc));
  assert.equal((await sync(db, ids.reporter, 'INCIDENT_CREATE', incPayload, icu)).server_id, inc.server_id);
  const incRow = (await db.query('SELECT incident_type, unit_code, is_urgent FROM incidents WHERE id = $1', [inc.server_id])).rows[0];
  assert.deepEqual([incRow.incident_type, incRow.unit_code, incRow.is_urgent], ['MTI', 'DT-045', true]);
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM incident_persons WHERE incident_id = $1`, [inc.server_id])).rows[0].n, 2);
  assert.equal(mobile.incidentTypeFor('INJURY', 'FIRST_AID'), 'FAI');
  assert.equal(mobile.incidentTypeFor('NEAR_MISS'), 'NEAR_MISS');

  // Pertemuan K3: lokasi "Lainnya" manual, pemateri eksternal.
  const mtg = await sync(db, ids.hse, 'MEETING_CREATE', { meeting_kind: 'K3', title: 'Rapat P2K3 Oktober', meeting_date: '2026-10-14',
    location_other: 'Ruang rapat kontraktor', leader_external_name: 'Dinas ESDM', participant_ids: [ids.head, ids.eng],
    external_participants: ['Tamu 1'], photos: [PHOTO] });
  assert.equal(mtg.status, 'OK', JSON.stringify(mtg));
  assert.match(mtg.server_no, /^MTG-\d{4}-001$/);

  // Jenis data tak dikenal & uuid salah ditolak tanpa merusak batch.
  const { results } = await mobile.syncItems(db, SCOPE, ids.reporter, [
    { client_uuid: 'bukan-uuid', type: 'HAZARD_CREATE', payload: {} },
    { client_uuid: uuid(), type: 'HACK', payload: {} },
  ]);
  assert.deepEqual(results.map(x => x.code), ['VALIDATION', 'VALIDATION']);

  const reports = await mobile.getMyReports(db, SCOPE, ids.reporter);
  assert.equal(reports.hazards.length, 2);
  assert.equal(reports.incidents.length, 1);
  const boot = await mobile.getBootstrap(db, SCOPE, ids.head);
  assert.equal(boot.me.delegator_departments.length, 1);
  assert.deepEqual(boot.areas.find(a => String(a.id) === String(ids.area)).subs.map(s => s.name), ['KM 3']);
  assert.equal(boot.sla_hours.EXTREME, 24);
  await db.close();
});

test('OMOS Safety: jadwal inspeksi saya, checklist Tidak OK → hazard, jadwal maju', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  const ids = await seed(db);
  const tmpl = (await db.query(`INSERT INTO hse_inspection_templates (code, name, object_type, schedule_cycle)
    VALUES ('HAUL-01', 'Jalan Hauling', 'AREA', 'WEEKLY') RETURNING id, root_id`)).rows[0];
  const item = (await db.query(`INSERT INTO hse_inspection_template_items (template_id, sort_order, question, is_critical)
    VALUES ($1, 1, 'Tanggul min 3/4 roda HD', TRUE) RETURNING id`, [tmpl.id])).rows[0].id;
  await db.query(`INSERT INTO hse_inspection_template_items (template_id, sort_order, question) VALUES ($1, 2, 'Rambu lengkap')`, [tmpl.id]);
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const sched = (await db.query(`INSERT INTO hse_inspection_schedules (template_root_id, location_id, assignee_type, assignee_employee_id, next_due_date)
    VALUES ($1, $2, 'EMPLOYEE', $3, $4::date - 2) RETURNING id`, [tmpl.root_id, ids.sub, ids.pic1, today])).rows[0].id;

  const mine = await mobile.getMySchedules(db, SCOPE, ids.pic1);
  assert.equal(mine.schedules.length, 1);
  assert.equal(mine.schedules[0].due_status, 'OVERDUE');
  assert.equal((await mobile.getMySchedules(db, SCOPE, ids.reporter)).schedules.length, 0);

  const payload = {
    template_id: tmpl.id, location_id: ids.sub, schedule_id: sched, photos: [PHOTO], participant_ids: [ids.hse],
    answers: [
      { item_id: item, question: 'Tanggul min 3/4 roda HD', is_critical: true, answer: 'NO', note: 'Tanggul rendah', photo: PHOTO, make_hazard: true, hazard_pic_ids: [ids.pic2] },
      { question: 'Rambu lengkap', answer: 'YES' },
    ],
    custom_items: [{ question: 'Drainase KM 3', answer: 'NA' }],
  };
  assert.equal((await sync(db, ids.pic1, 'INSPECTION_CREATE', { ...payload, answers: [{ ...payload.answers[0], photo: null }] })).code, 'VALIDATION');
  const cu = uuid();
  const res = await sync(db, ids.pic1, 'INSPECTION_CREATE', payload, cu);
  assert.equal(res.status, 'OK', JSON.stringify(res));
  assert.equal(res.hazards.length, 1);
  const again = await sync(db, ids.pic1, 'INSPECTION_CREATE', payload, cu);
  assert.equal(again.server_id, res.server_id);
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM hazard_reports WHERE source = 'INSPECTION'`)).rows[0].n, 1);
  assert.equal((await db.query(`SELECT COUNT(*)::int AS n FROM hse_inspection_answers WHERE inspection_id = $1 AND photo IS NOT NULL`, [res.server_id])).rows[0].n, 1);
  const after = (await db.query('SELECT next_due_date::text AS d, last_done_at FROM hse_inspection_schedules WHERE id = $1', [sched])).rows[0];
  assert.ok(after.last_done_at);
  assert.ok(after.d > today);
  assert.equal((await mobile.getPicActions(db, SCOPE, ids.pic2)).length, 1);

  const stats = await mobile.getMyStats(db, SCOPE, ids.pic1);
  assert.equal(stats.rows.find(r => r.key === 'inspection').actual, 1);
  await db.close();
});

test('OMOS Safety: eskalasi lewat batas sekali per batas waktu ke delegator (+ HSE untuk Ekstrem)', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  const ids = await seed(db);
  await mobile.setDepartmentDelegator(db, SCOPE, { id: ids.admin }, ids.produksi, { delegator_user_id: ids.head, backup_user_id: ids.pic2 });
  const h = await sync(db, ids.reporter, 'HAZARD_CREATE', hazardPayload(ids, { likelihood: 3, consequence: 4 }));
  const [action] = await mobile.getPicActions(db, SCOPE, ids.pic1);

  // Belum lewat batas → tidak ada eskalasi.
  assert.equal((await mobile.escalateOverdueActions(db)).escalated, 0);

  // Lewat batas → dieskalasi sekali; jalankan ulang tidak mengirim ganda.
  const later = new Date(Date.now() + 4 * 86400e3);
  assert.equal((await mobile.escalateOverdueActions(db, { now: later })).escalated, 1);
  assert.equal((await mobile.escalateOverdueActions(db, { now: later })).escalated, 0);
  const kinds = async (u) => (await mobile.listNotifications(db, SCOPE, u, 0)).items.map(i => i.kind);
  assert.ok((await kinds(ids.head)).includes('ACTION_ESCALATED'));
  assert.ok((await kinds(ids.pic2)).includes('ACTION_ESCALATED'), 'delegator cadangan ikut dinotifikasi');
  assert.ok((await kinds(ids.pic1)).includes('ACTION_OVERDUE'));
  const detail = await mobile.getHazardDetailForMobile(db, SCOPE, ids.reporter, h.server_id);
  assert.ok(detail.events.some(e => e.event_type === 'ESCALATED' && /Dedi Kepala/.test(e.note)));

  // Perpanjangan disetujui → batas baru; bila terlewat lagi, dieskalasi lagi.
  const req = await sync(db, ids.pic1, 'PIC_REQUEST', { action_id: action.action_id, request_type: 'EXTEND', reason: 'Material', proposed_due_date: '2099-01-10' });
  assert.equal((await sync(db, ids.head, 'DELEGATOR_DECISION', { request_id: req.server_id, decision: 'APPROVE' })).status, 'OK');
  assert.equal((await mobile.escalateOverdueActions(db, { now: later })).escalated, 0);
  assert.equal((await mobile.escalateOverdueActions(db, { now: new Date('2099-01-11T00:00:00Z') })).escalated, 1);

  // Hazard yang sudah ditutup/dibatalkan tidak dieskalasi.
  const h2 = await sync(db, ids.reporter, 'HAZARD_CREATE', hazardPayload(ids));
  assert.equal((await sync(db, ids.reporter, 'HAZARD_CANCEL', { hazard_id: h2.server_id, reason: 'Salah input' })).status, 'OK');
  assert.equal((await mobile.escalateOverdueActions(db, { now: new Date('2099-06-01T00:00:00Z') })).escalated, 0);
  await db.close();
});

test('Rekomendasi → CAPA → status hazard otomatis dari dashboard & APK', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  const ids = await seed(db);
  const admin = { id: ids.admin, role: 'admin' };
  const status = async id => (await db.query('SELECT status FROM hazard_reports WHERE id = $1', [id])).rows[0].status;
  const capas = async id => (await db.query(`SELECT * FROM hse_actions WHERE source_type = 'HAZARD' AND source_id = $1 ORDER BY created_at`, [id])).rows;

  // Dashboard: input hazard + rekomendasi + PIC → CAPA otomatis (batas SLA risiko).
  const h = await hse.createHazard(db, SCOPE, admin, {
    description: 'Rambu batas kecepatan KM 5 hilang', potential_consequence: 'Tabrakan unit',
    recommendation: 'Pasang rambu 30 km/jam', likelihood: 3, consequence: 4, assigned_to: ids.pic1, location_id: ids.sub,
  });
  let rows = await capas(h.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].description, 'Pasang rambu 30 km/jam');
  assert.ok(rows[0].due_at, 'CAPA otomatis punya batas waktu SLA');
  assert.equal(await status(h.id), 'NEW');

  // Edit dashboard: rekomendasi berubah → CAPA belum dikerjakan ikut; status progres manual diabaikan.
  await hse.updateHazard(db, SCOPE, admin, h.id, { recommendation: 'Pasang rambu 30 km/jam + speed bump', status: 'IN_ACTION' });
  rows = await capas(h.id);
  assert.equal(rows[0].description, 'Pasang rambu 30 km/jam + speed bump');
  assert.equal(await status(h.id), 'NEW');
  await assert.rejects(hse.updateHazard(db, SCOPE, admin, h.id, { status: 'CLOSED' }), { statusCode: 422 });

  // Progres dari PIC di APK → IN_ACTION → VERIFY → CLOSED otomatis.
  assert.equal((await sync(db, ids.pic1, 'ACTION_START', { action_id: rows[0].id })).status, 'OK');
  assert.equal(await status(h.id), 'IN_ACTION');
  assert.equal((await sync(db, ids.pic1, 'ACTION_EVIDENCE', { action_id: rows[0].id, photos: [PHOTO], note: 'Rambu terpasang' })).status, 'OK');
  assert.equal(await status(h.id), 'VERIFY');
  assert.equal((await sync(db, ids.hse, 'VERIFY_DECISION', { action_id: rows[0].id, decision: 'APPROVE' })).status, 'OK');
  assert.equal(await status(h.id), 'CLOSED');
  assert.equal((await hse.getHazardDetail(db, SCOPE, h.id)).capa_progress.percent, 100);

  // Hazard lama tanpa CAPA: isi rekomendasi + PIC dari dashboard → CAPA dibuat; update CAPA dari dashboard ikut menggerakkan status.
  const h2 = await hse.createHazard(db, SCOPE, admin, { description: 'Lampu tower mati', likelihood: 2, consequence: 2, location_id: ids.sub });
  assert.equal((await capas(h2.id)).length, 0);
  const upd = await hse.updateHazard(db, SCOPE, admin, h2.id, { status: 'ASSESSED', recommendation: 'Ganti lampu tower', assigned_to: ids.pic2 });
  assert.equal(upd.status, 'ASSESSED');
  const [c2] = await capas(h2.id);
  assert.equal(String(c2.pic_employee_id), String(ids.pic2));
  await hse.updateAction(db, SCOPE, admin, c2.id, { status: 'DONE_PENDING_VERIFY' });
  assert.equal(await status(h2.id), 'VERIFY');
  await hse.updateAction(db, SCOPE, admin, c2.id, { status: 'CLOSED' });
  assert.equal(await status(h2.id), 'CLOSED');

  // Ditolak admin → CAPA terbuka dibatalkan, status tidak ditimpa sinkronisasi.
  const h3 = await hse.createHazard(db, SCOPE, admin, { description: 'Laporan tidak valid', recommendation: 'Cek ulang', assigned_to: ids.pic1, likelihood: 1, consequence: 1 });
  await hse.updateHazard(db, SCOPE, admin, h3.id, { status: 'REJECTED' });
  assert.equal(await status(h3.id), 'REJECTED');
  assert.equal((await capas(h3.id))[0].status, 'CANCELLED');
  await db.close();
});

test('Peserta P5M/Safety Talk dari Seleksi Karyawan + statistik mengikuti Setup Target per individu & siklus', { skip: !available }, async () => {
  const db = await createTestDb(MIGRATIONS);
  const ids = await seed(db);
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const from = '2020-01-01';
  const pos = async (name, deptId) => (await db.query(`INSERT INTO workforce_positions (department_id, name) VALUES ($1, $2) RETURNING id`, [deptId, name])).rows[0].id;
  const foreman = await pos('Foreman Produksi', ids.produksi);
  await pos('Operator HD', ids.produksi);

  // P5M: default jabatan Foreman (bulanan 4x) → Pita Satu & Pita Dua WAJIB; Rudi tidak diatur.
  await db.query(`INSERT INTO hse_p5m_targets (target_type, position_id, cycle, target_quota, effective_from) VALUES ('BY_ROLE', $1, 'MONTHLY', 4, $2)`, [foreman, from]);
  // Safety Talk: mingguan per individu untuk Rudi saja.
  await db.query(`INSERT INTO hse_safetytalk_targets (target_type, employee_id, cycle, target_quota, effective_from, reason_code) VALUES ('BY_EMPLOYEE', $1, 'WEEKLY', 1, $2, 'KHUSUS')`, [ids.reporter, from]);
  // Hazard: mingguan 2 per jabatan Foreman (seperti produksi).
  await db.query(`INSERT INTO hse_hazard_report_targets (target_type, position_id, cycle, target_quota, effective_from) VALUES ('BY_ROLE', $1, 'WEEKLY', 2, $2)`, [foreman, from]);

  // Halaman Setup (dashboard): target mingguan/bulanan tampil sebagai WAJIB beserta siklusnya (dulu hanya MONTHLY terbaca).
  const hseSvc = require('../src/services/hse');
  const hzOv = await hseSvc.getHazardReportMandateOverview(db, SCOPE, { status: 'WAJIB' });
  assert.deepEqual(hzOv.items.map(i => [i.nama, i.target_quota, i.quota_cycle]).sort(), [['Pita Dua', 2, 'WEEKLY'], ['Pita Satu', 2, 'WEEKLY']]);
  const stOv = await hseSvc.getSafetytalkMandateOverview(db, SCOPE, {});
  assert.equal(stOv.kpi.wajibCount, 1);
  assert.equal(stOv.items.find(i => i.nama === 'Rudi Pelapor').quota_cycle, 'WEEKLY');
  const p5mMonthly = await hseSvc.getP5mMandateOverview(db, SCOPE, { cycle: 'MONTHLY' });
  assert.equal(p5mMonthly.kpi.wajibCount, 2, 'filter siklus eksplisit tetap didukung');
  assert.equal((await hseSvc.getP5mMandateOverview(db, SCOPE, { cycle: 'WEEKLY' })).kpi.wajibCount, 0);

  let p5m = await mobile.getEventParticipants(db, SCOPE, 'p5m', today);
  assert.deepEqual(p5m.map(p => p.nama).sort(), ['Pita Dua', 'Pita Satu']);
  const st = await mobile.getEventParticipants(db, SCOPE, 'safetytalk', today);
  assert.deepEqual(st.map(p => p.nama), ['Rudi Pelapor'], 'target mingguan ikut terbaca (bukan hanya bulanan)');

  // Seleksi Karyawan CUSTOM: hanya Pita Satu.
  await db.query(`INSERT INTO hse_p5m_scopes (scope_mode, included_employee_ids) VALUES ('CUSTOM', ARRAY[$1::uuid])`, [ids.pic1]);
  p5m = await mobile.getEventParticipants(db, SCOPE, 'p5m', today);
  assert.deepEqual(p5m.map(p => p.nama), ['Pita Satu']);

  // Statistik Pita Dua: hazard 2/minggu, P5M di luar seleksi → tidak bertarget.
  await sync(db, ids.pic2, 'HAZARD_CREATE', hazardPayload(ids, { occurred_at: new Date().toISOString() }));
  let stats = await mobile.getMyStats(db, SCOPE, ids.pic2);
  const byKey = k => stats.rows.find(r => r.key === k);
  assert.deepEqual([byKey('hazard').target, byKey('hazard').cycle, byKey('hazard').actual], [2, 'WEEKLY', 1]);
  assert.equal(byKey('p5m').target, 0);
  assert.equal(byKey('p5m').status, 'TIDAK_DISELEKSI');

  // Statistik Pita Satu: P5M 4/bulan; Rudi: Safety Talk 1/minggu.
  stats = await mobile.getMyStats(db, SCOPE, ids.pic1);
  assert.deepEqual([byKey('p5m').target, byKey('p5m').cycle], [4, 'MONTHLY']);
  stats = await mobile.getMyStats(db, SCOPE, ids.reporter);
  assert.deepEqual([byKey('safetytalk').target, byKey('safetytalk').cycle], [1, 'WEEKLY']);
  assert.equal(byKey('hazard').status, 'BELUM_DIATUR');

  // Inspeksi: target harian khusus satu jenis templat (seperti produksi) → baris per jenis, tidak dikali jumlah templat.
  const tmpl = (await db.query(`INSERT INTO hse_inspection_templates (code, name, object_type, schedule_cycle) VALUES ('LV-01', 'Inspeksi LV', 'AREA', 'DAILY') RETURNING id, root_id`)).rows[0];
  await db.query(`INSERT INTO hse_inspection_templates (code, name, object_type, schedule_cycle) VALUES ('WS-01', 'Workshop', 'AREA', 'WEEKLY')`);
  await db.query(`INSERT INTO hse_inspection_targets (target_type, position_id, template_root_id, cycle, target_quota, effective_from) VALUES ('BY_ROLE', $1, $2, 'DAILY', 1, $3)`, [foreman, tmpl.root_id || tmpl.id, from]);
  stats = await mobile.getMyStats(db, SCOPE, ids.pic1);
  const insp = stats.rows.filter(r => r.key === 'inspection');
  assert.deepEqual(insp.map(r => [r.label, r.target, r.cycle, r.period_from === r.period_to]), [['Inspeksi · Inspeksi LV', 1, 'DAILY', true]]);

  // Sinkron P5M dari APK: peserta dalam seleksi diterima & terhitung; di luar seleksi ditolak (VALIDATION).
  const shiftId = (await db.query('SELECT id FROM shifts LIMIT 1')).rows[0].id;
  const ev = (over = {}) => ({ event_date: today, shift_id: shiftId, location_id: ids.sub, topics: ['Jarak aman'], photos: [PHOTO], participant_ids: [ids.pic1], ...over });
  const okP5m = await sync(db, ids.head, 'P5M_CREATE', ev());
  assert.equal(okP5m.status, 'OK', JSON.stringify(okP5m));
  const outside = await sync(db, ids.head, 'P5M_CREATE', ev({ participant_ids: [ids.pic2] }));
  assert.equal(outside.code, 'VALIDATION');
  assert.match(outside.message, /Seleksi Karyawan/);
  stats = await mobile.getMyStats(db, SCOPE, ids.pic1);
  assert.equal(byKey('p5m').actual, 1);
  // Safety Talk mingguan (target individu) juga tersinkron.
  assert.equal((await sync(db, ids.head, 'SAFETYTALK_CREATE', ev({ participant_ids: [ids.reporter] }))).status, 'OK');
  await db.close();
});

test('OMOS Safety: SLA & tanggal batas WIB', () => {
  const from = new Date('2026-10-13T03:42:00Z');
  assert.equal(mobile.dueAtFor('HIGH', from).toISOString(), '2026-10-16T03:42:00.000Z');
  assert.equal(mobile.dueAtFor('LOW', from).toISOString(), '2026-10-27T03:42:00.000Z');
  assert.equal(mobile.endOfWibDay('2026-10-20').toISOString(), '2026-10-20T16:59:59.000Z');
  assert.match(mobile.deriveUuid('11111111-1111-4111-8111-111111111111', 2), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});
