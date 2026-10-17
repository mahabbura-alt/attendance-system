'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'workforce.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'workforce.css'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const fixture = fs.readFileSync(path.join(__dirname, 'test-fixtures', 'workforce-preview.html'), 'utf8');

test('Karyawan uses the People v2 workspace and hosts the existing MPP module', () => {
  // People v2 (sample page omos_karyawan_layout.html): Direktori, Pergerakan, MPP, Pengingat, Setup master.
  assert.match(html, /id="peopleRoot"/);
  assert.match(html, /id="workforceMovementView"/);
  assert.match(html, /people\.js\?v=\d+/);
  assert.match(app, /Promise\.all\(\[muatKaryawan\(\), window\.OMOSPeople\?\.load\(\)\]\)/);
  assert.match(js, /async showMpp\(\)/);
  assert.match(js, /window\.OMOSPeople\?\.openMove/);
});

test('movement workspace provides summary, MPP, lifecycle tabs and auditable transitions', () => {
  for (const label of ['Ringkasan','MPP','Masuk','Mutasi','Promosi','Keluar','Riwayat']) assert.match(js, new RegExp(label));
  assert.match(js, /Idempotency-Key/);
  assert.match(js, /workforce\/movements\/\$\{id\}\/transition/);
  assert.match(js, /workforce\/tasks/);
  assert.match(js, /OMOSActionFeedback\.run/);
  assert.match(js, /data-mpp-transition/);
  assert.doesNotMatch(js, /masuk:'HIRE'/);
  assert.doesNotMatch(js, /keluar:'RESIGN'/);
});

test('MPP grid is responsive, sticky and exposes numeric status in addition to color', () => {
  assert.match(js, /Kurang/);
  assert.match(js, /Sesuai/);
  assert.match(js, /Lebih/);
  assert.match(css, /workforce-mpp-table th:first-child/);
  assert.match(css, /@media\(max-width:640px\)/);
  assert.match(css, /workforce-depts/);
  assert.match(css, /workforce-drawer/);
  assert.match(css, /workforce-gap--less/);
  assert.match(html, /workforce-mpp-table\{width:100%;min-width:1080px/);
  assert.match(fixture, /OMOSWorkforce\.load\(\)/);
});

test('People period uses month and year while MPP is monthly and dirty-save driven', () => {
  assert.match(js, /id="workforceMonth"/);
  assert.match(js, /id="workforceYear"/);
  assert.doesNotMatch(js, /id="workforceFrom"/);
  assert.doesNotMatch(js, /id="workforceTo"/);
  assert.match(js, /workforce\/mpp\?period=\$\{stateData\.period\}/);
  assert.match(js, /data-mpp-position/);
  assert.match(js, /data-mpp-need/);
  assert.match(js, /id="workforceMppSave" hidden/);
  assert.match(js, /Simpan Perubahan/);
  assert.match(js, /required_qty/);
});

test('MPP enterprise P0: server summary, department filter, actual drawer, reason editor, history, export', () => {
  // KPI global dari summary server (bukan hitung ulang browser semata).
  assert.match(js, /summary\.open_vacancy/);
  assert.match(js, /summary\.critical_positions/);
  assert.match(js, /summary\.fill_rate/);
  // Kartu departemen sebagai filter + reset.
  assert.match(js, /data-mpp-dept/);
  assert.match(js, /mppDeptFilter/);
  assert.match(js, /Semua Departemen/);
  // Drill-down Aktual per jabatan via API scoped.
  assert.match(js, /data-mpp-actual/);
  assert.match(js, /workforce\/mpp\/actual\?period=/);
  assert.match(js, /workforceDrawerClose/);
  // Editor alasan/prioritas/needed-by + revision untuk concurrency.
  assert.match(js, /data-mpp-reason/);
  assert.match(js, /data-mpp-priority/);
  assert.match(js, /data-mpp-needed/);
  assert.match(js, /expected_revision/);
  assert.match(js, /Alasan perubahan kebutuhan wajib/);
  // Segmented Headcount/Riwayat + riwayat dari API audit.
  assert.match(js, /data-mpp-view/);
  assert.match(js, /workforce\/mpp\/history\?period=/);
  // Save memakai idempotency key + expected_version_no; 409 tidak menghapus input.
  assert.match(js, /expected_version_no/);
  assert.match(js, /Idempotency-Key/);
  assert.match(js, /Muat ulang/);
  // Ekspor MPP sesuai bulan.
  assert.match(js, /mpp-\$\{stateData\.period\}\.csv/);
  // Approval tetap dikunci saat dirty.
  assert.match(js, /Simpan perubahan kebutuhan terlebih dahulu/);
});

test('MPP vacancy P1: view, generate request, pipeline, fulfillment', () => {
  // Segmented Headcount/Vacancy/Riwayat + vacancy dari API server.
  assert.match(js, /data-mpp-view="vacancy"/);
  assert.match(js, /workforce\/mpp\/vacancy\?period=/);
  assert.match(js, /open_vacancy/);
  // Generate request dari gap dengan idempotency + override reason.
  assert.match(js, /data-vac-request/);
  assert.match(js, /workforce\/manpower-requests/);
  assert.match(js, /override_reason/);
  // Pipeline 7 tahap + transisi bervisi + fulfillment onboarding.
  assert.match(js, /CANDIDATE_READY/);
  assert.match(js, /manpower-requests\/\$\{id\}\/transition/);
  assert.match(js, /manpower-requests\/\$\{id\}\/fulfillments/);
  assert.match(js, /expected_revision/);
  // Auto-link HIRE/REHIRE disebut di copy vacancy.
  assert.match(js, /HIRE\/REHIRE efektif/);
  // CSS progress vacancy.
  assert.match(css, /workforce-progress/);
});

test('MPP forecast P2: deterministic view, variance, simulation badge', () => {
  // Segmented Forecast + API deterministik (from/to bulanan).
  assert.match(js, /data-mpp-view="forecast"/);
  assert.match(js, /workforce\/mpp\/forecast\?from=/);
  assert.match(js, /Aktual Saat Ini/);
  // Variance selalu angka + teks, bukan warna saja.
  assert.match(js, /vs butuh/);
  assert.match(js, /tanpa plan/);
  // Risiko berlabel teks.
  assert.match(js, /Kritis/);
  assert.match(js, /Waspada/);
  // Simulasi: CRUD scenario terpisah, label Simulation, tidak campur approved.
  assert.match(js, /workforce\/mpp\/scenarios/);
  assert.match(js, /data-sc-detail/);
  assert.match(js, /Simulation/);
  assert.match(js, /approved MPP tidak berubah/);
  assert.match(css, /workforce-sim-badge/);
});

test('modified employee create and edit actions use standard OMOS save feedback', () => {
  assert.match(app, /id="btnSimpanEditKaryawan"/);
  assert.match(app, /id="btnSimpanTambahKaryawan"/);
  assert.match(app, /OMOSActionFeedback\.run\(saveButton/);
});

test('MPP module keeps its labels and is embedded without its legacy rotation tabs', () => {
  assert.match(html, /workforce\.js\?v=\d+/);
  assert.match(js, /Rotasi terbaru/);
  assert.match(js, /Riwayat Rotasi/);
  const css = fs.readFileSync(path.join(__dirname, 'people.css'), 'utf8');
  assert.match(css, /\.pp-mpp-host \.workforce-tabs \{ display: none; \}/);
});
