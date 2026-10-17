'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'cuti.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'cuti.css'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');

test('Roster tab menyediakan tiga sub-tampilan cuti dengan aset berversi', () => {
  assert.match(html, /data-cuti-view="jadwal"/);
  assert.match(html, /data-cuti-view="cuti"/);
  assert.match(html, /data-cuti-view="kebijakan"/);
  assert.match(html, /id="rosterScheduleView"/);
  assert.match(html, /id="cutiView"/);
  assert.match(html, /id="cutiPolicyView"/);
  assert.match(html, /cuti\.css\?v=10/);
  assert.match(html, /cuti\.js\?v=11/);
  assert.match(html, /<button type="button" data-cuti-view="kebijakan"[^>]*>Atur Roster Cuti<\/button>/);
  assert.match(js, /<h3>Atur Roster Cuti<\/h3>/);
  assert.doesNotMatch(html, /cuti\.(?:css|js)\?v=[01](?:\D|$)/);
});

test('aksi kebijakan menyediakan Edit versi baru dan Hapus tanpa tombol Nonaktifkan', () => {
  assert.match(js, /data-cuti-policy-edit/);
  assert.match(js, /data-cuti-policy-delete/);
  assert.match(js, /Edit Kebijakan Cuti/);
  assert.match(js, /method: 'DELETE'/);
  assert.match(js, /Perubahan disimpan sebagai versi baru/);
  assert.doesNotMatch(js, /data-cuti-policy-toggle/);
  assert.doesNotMatch(js, />Nonaktifkan</);
});

test('Modul cuti memakai endpoint backend cuti yang benar', () => {
  assert.match(js, /window\.OMOSCuti/);
  assert.match(js, /\/api\/admin\/cuti\/dashboard/);
  assert.match(js, /\/api\/admin\/cuti\/detail/);
  assert.match(js, /\/api\/admin\/cuti\/policies/);
  assert.match(js, /\/api\/admin\/cuti\/policy-scopes/);
  assert.match(js, /\/api\/admin\/cuti\/requests/);
  assert.match(js, /\/transition/);
  assert.match(js, /\/api\/admin\/cuti\/realisations/);
  assert.match(js, /\/api\/admin\/cuti\/calendar/);
  assert.match(js, /\/api\/admin\/cuti\/reconciliation/);
  assert.match(js, /Idempotency-Key/);
});

test('form kebijakan memakai scope bertingkat dan kontrak CP mingguan', () => {
  assert.match(js, /id="cutiPolDept"/);
  assert.match(js, /id="cutiPolPos"/);
  assert.match(js, /id="cutiPolEmployee"/);
  assert.match(js, /Semua karyawan pada jabatan ini/);
  assert.match(js, /Pilih departemen dahulu/);
  assert.match(js, /departmentInput\.addEventListener\('change', syncPositions\)/);
  assert.match(js, /positionInput\.addEventListener\('change', syncEmployees\)/);
  assert.match(js, /id="cutiPolWorkWeeks"/);
  assert.match(js, /id="cutiPolLeaveWeeks"/);
  assert.match(js, /id="cutiPolCycleWeeks"/);
  assert.match(js, /Pengaturan Siklus Cuti Periodik/);
  assert.doesNotMatch(js, /<input value="CP — Cuti Periodik"/);
  assert.match(js, /target_user_id:/);
  assert.doesNotMatch(js, /id="cutiPolType"/);
  assert.doesNotMatch(js, /id="cutiPolBasis"/);
  assert.doesNotMatch(js, /id="cutiPolCarry"/);
  assert.doesNotMatch(js, /id="cutiPolTo"/);
  assert.doesNotMatch(js, /id="cutiPolDept" placeholder=/);
});

test('kegagalan database tidak menghasilkan layar kosong dan menawarkan mode Biznet', () => {
  assert.match(js, /Database Cuti tidak dapat dimuat/);
  assert.match(js, /Buka data Biznet/);
  assert.match(js, /api_mode=biznet/);
  assert.match(js, /stateData\.view === 'kebijakan'/);
});

test('Mode List dan Card memakai data yang sama dengan label terkunci', () => {
  assert.match(js, /data-cuti-mode="list"/);
  assert.match(js, /data-cuti-mode="card"/);
  assert.match(js, /CP: Proyeksi|CP.*Proyeksi/);
  assert.match(js, /Jatuh tempo/);
  assert.match(js, /Rekonsiliasi/);
  assert.match(js, /<th>Kebijakan<\/th><th>Hak<\/th><th>Realisasi<\/th>/);
  assert.match(js, /Jadwal Cuti/);
  assert.match(js, /Cuti Periodik/);
  assert.match(js, /Cuti Khusus/);
  assert.match(js, /Cuti Tahunan/);
  assert.match(js, /leave_events/);
  assert.match(js, /BELUM_SETUP/);
  assert.match(css, /cuti-person-cards/);
  assert.match(css, /cuti-cycle/);
  assert.match(css, /min-width:980px/);
  assert.match(css, /@media\(max-width:640px\)/);
});

test('slicer departemen dan jabatan memakai dropdown bertingkat dari master aktif', () => {
  assert.match(js, /<select id="cutiDept"/);
  assert.match(js, /Departemen: Semua/);
  assert.match(js, /<select id="cutiPos"/);
  assert.match(js, /Pilih Departemen dahulu/);
  assert.match(js, /departmentFilter\?\.addEventListener\('change'/);
  assert.match(js, /stateData\.policyScopes/);
  assert.doesNotMatch(js, /<input id="cutiDept"/);
  assert.doesNotMatch(js, /<input id="cutiPos"/);
});

test('approval HR terpisah dari konfirmasi realisasi aktual', () => {
  assert.match(js, /APPROVED: \['REALIZED', 'CANCELLED'\]/);
  assert.match(js, /id="cutiTrxStart"/);
  assert.match(js, /id="cutiTrxEnd"/);
  assert.match(js, /targetInput\.value === 'REALIZED'/);
  assert.match(js, /Durasi yang berbeda dari kebijakan masuk variance/);
  assert.match(js, /id="cutiCorPeriods"/);
});

test('pengajuan CK dan CT mendukung relasi nomor siklus', () => {
  assert.match(js, /id="cutiReqCycle"/);
  assert.match(js, /cycle_no:/);
  assert.match(js, /data-cuti-cycle-apply/);
  assert.match(js, /\/api\/admin\/cuti\/cycle-options/);
  assert.match(js, /\/api\/admin\/cuti\/cycle-applications/);
  assert.match(js, /id="cutiReqCkReason"/);
  assert.match(js, /id="cutiReqCkDays"/);
  assert.match(js, /id="cutiReqCtDays"/);
  assert.match(js, /Total \$\{total\} hari cuti/);
  assert.match(js, /planned_start: startInput\.value/);
  assert.match(js, /owning_year: Number\(stateData\.year\)/);
  assert.doesNotMatch(js, /data-cuti-pengajuan="/);
  assert.doesNotMatch(js, /data-cuti-pengajuan="[^\n]*>Pengajuan Cuti/);
});

test('Roster schedule tetap dimuat mandiri oleh app.js', () => {
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  assert.match(app, /async function muatRoster\(\)/);
  assert.match(app, /rosterTables/);
  assert.match(html, /id="rosterScheduleView"/);
  assert.match(html, /id="tabRoster"/);
});

test('baris mode List membuka pop-up kartu cuti, menampilkan realisasi terbaru, dan meng-highlight aktual', () => {
  assert.match(js, /data-cuti-card-modal/);
  assert.match(js, /openCardModal/);
  assert.match(js, /Kartu Cuti Karyawan/);
  assert.match(js, /latestRealisasiHtml/);
  assert.match(js, /countAktual/);
  assert.match(js, /cuti-kpi--highlight/);
  assert.match(js, /cuti-aktual-highlight/);
  assert.match(css, /cuti-person-modal-wrap/);
  assert.match(css, /cuti-kpi--highlight/);
  assert.match(css, /cuti-aktual-highlight/);
});

