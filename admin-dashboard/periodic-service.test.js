'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, 'periodicService.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'periodicService.css'), 'utf8');

test('Breakdown page exposes Periodic Service workspace with four task views', () => {
  assert.match(html, /Periodic Service Control/);
  assert.match(html, /data-ps-view="schedule"/);
  assert.match(html, /data-ps-view="packages"/);
  assert.match(html, /data-ps-view="history"/);
  assert.match(html, /data-ps-view="findings"/);
});

test('Breakdown and Periodic Service use separate contextual headers with an inclusive period slicer', () => {
  assert.match(html, /id="breakdownControlHeader"/);
  assert.match(html, /id="psPeriodFrom" type="date"/);
  assert.match(html, /id="psPeriodTo" type="date"/);
  assert.match(html, /Range memfilter realisasi dan temuan terselesaikan/);
  assert.match(source, /breakdownHeader\.hidden = periodic/);
  assert.match(source, /URLSearchParams\(\{ date_from: range\.dateFrom, date_to: range\.dateTo \}\)/);
  assert.match(css, /periodic-service-header\{position:sticky;top:0/);
});

test('Periodic Service highlight indicators drill down to their matching operational data', () => {
  assert.equal((html.match(/class="periodic-kpi-link"/g) || []).length, 5);
  assert.match(html, /bukaDataIndikatorPeriodicService\('configured'\)/);
  assert.match(html, /bukaDataIndikatorPeriodicService\('overdue'\)/);
  assert.match(html, /bukaDataIndikatorPeriodicService\('findings'\)/);
  assert.match(source, /psIndicatorFilter === 'configured'/);
  assert.match(source, /\['due', 'overdue'\]\.includes\(unitStatus\)/);
  assert.match(source, /\['open', 'in_progress'\]\.includes\(finding\.status\)/);
  assert.match(source, /switchPeriodicView\(view, true\)/);
  assert.match(css, /periodic-kpi-link\.is-active/);
});

test('writes use shared feedback and explain PS/MOHH lineage', () => {
  assert.match(source, /OMOSActionFeedback\.run/);
  assert.match(source, /Generate PS/);
  assert.match(html, /PS memengaruhi MOHH\/PA, tetapi tidak dihitung sebagai functional failure/);
  assert.match(css, /periodic-kpi-grid/);
});

test('package form uses structured item rows instead of pipe-delimited text', () => {
  assert.match(source, /psPackageItems/);
  assert.match(source, /package_item_type/);
  assert.match(source, /package_item_name/);
  assert.match(source, /collectPackageItems/);
  assert.match(source, /Tidak perlu lagi menggunakan format atau tanda pemisah khusus/);
  assert.doesNotMatch(source, /form\.items\.value\.split/);
  assert.match(css, /ps-package-item-row/);
  assert.match(css, /#modalKonten:has\(\.ps-modal\).*1060px/);
});

test('Area Setup is model-scoped, editable, and package output is a grouped unit list', () => {
  assert.match(html, /⚙ Service Setup/);
  assert.match(source, /bukaModalAreaSetupPeriodicService/);
  assert.match(source, /name="model_scope"/);
  assert.match(source, /equipment_class/);
  assert.match(source, /equipment_model/);
  assert.match(source, /method: existing \? 'PUT' : 'POST'/);
  assert.match(source, /bukaDetailPaketPeriodicService/);
  assert.match(source, /ps-package-type-group/);
  assert.match(source, /ps-package-model-group/);
  assert.match(css, /ps-period-chip/);
  assert.match(source, /name="estimated_duration_hours"/);
  assert.match(source, /Acuan Forecast PA; tidak mengunci waktu aktual service/);
  assert.match(source, /estimated_duration_hours: form\.estimated_duration_hours\.value/);
});

test('Forecast PA wizard separates EWH projection from PS downtime and supports manual quick input', () => {
  assert.match(html, /bukaForecastPaPeriodicService\(\)/);
  assert.match(html, /Forecast PA/);
  assert.match(source, /Forecast Mine Plan · halaman 0\.4 PA, UA & EWH/);
  assert.match(source, /Input Manual · EWH jam\/hari per unit/);
  assert.match(source, /terapkanEwhCepatForecastPa/);
  assert.match(source, /periodic-service\/forecast-pa/);
  assert.match(source, /PA periode = \(Σ MOHH − Σ jam PS\) \/ Σ MOHH/);
  assert.match(source, /Durasi aktual Work Order mengalahkan Estimasi Pekerjaan Area Setup/);
  assert.match(css, /ps-forecast-grid/);
  assert.match(css, /ps-forecast-event\.actual/);
});

test('Jadwal Service records actual start-finish as Breakdown PS with auditable extra requirements', () => {
  assert.match(source, />Service<\/button>/);
  assert.doesNotMatch(source, />Buat WO<\/button>/);
  assert.match(source, /name="actual_start" type="datetime-local"/);
  assert.match(source, /name="actual_finish" type="datetime-local"/);
  assert.match(source, /name="shift_id"/);
  assert.match(source, /name="actual_service_hm"/);
  assert.match(source, /Simpan & Catat Breakdown PS/);
  assert.match(source, /Part \/ Task dari Area Setup/);
  assert.match(source, /Part \/ Task Tambahan/);
  assert.match(source, /tambahKebutuhanServiceTambahan/);
  assert.match(source, /additional_items: additionalItems/);
  assert.match(source, /planned_items/);
  assert.match(html, /Jadwal \/ Realisasi/);
  assert.match(css, /ps-service-summary/);
});

test('Jadwal Service provides flexible package selection and Catatan / Temuan Service label', () => {
  assert.match(source, /Periode Service \/ Target Paket/);
  assert.match(source, /name="package_id"/);
  assert.match(source, /name="due_hm"/);
  assert.match(source, /gantiPaketOrderPeriodicService/);
  assert.match(source, /Catatan \/ Temuan Service/);
});

test('Riwayat Service exposes Edit and Cascade Delete instead of Koreksi Waktu button', () => {
  const renderHistoryFn = source.match(/function renderHistory\(\)\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
  assert.match(renderHistoryFn, /bukaModalEditPeriodicService/);
  assert.match(renderHistoryFn, /konfirmasiHapusPeriodicService/);
  assert.doesNotMatch(renderHistoryFn, /bukaModalKoreksiPeriodicService/);
  assert.match(source, /bukaModalEditPeriodicService/);
  assert.match(source, /konfirmasiHapusPeriodicService/);
  assert.match(source, /eksekusiHapusPeriodicService/);
  assert.match(source, /METHOD:\s*'PUT'/i);
  assert.match(source, /METHOD:\s*'DELETE'/i);
});

