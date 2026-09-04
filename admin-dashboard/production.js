// ============================================================
// MODUL MINING PRODUCTION MANAGEMENT SYSTEM (OMOS) - FRONTEND LOGIC
// ============================================================

let masterProdData = {
  pits: [], loadingPoints: [], disposals: [], equipment: [], standbyCodes: [], breakdownCodes: [], shifts: [], jobCodes: [], operators: [], personnel: []
};

// Global chart instances
let chartParetoObj = null;
let chartPieStandbyObj = null;
let chartHourlyProdObj = null;
let chartMtdObj = null;
let chartYtdObj = null;
let filteredEquipmentUnits = null;

// Helper API URL & Headers
function getProdApiUrl(path) {
  if (typeof getApiBaseUrl === 'function') {
    return `${getApiBaseUrl()}${path}`;
  }
  const currentHost = window.location.hostname || 'localhost';
  return `http://${currentHost}:3000${path}`;
}

function getProdAuthHeaders() {
  const token = (typeof state !== 'undefined' && state ? state.token : null) || localStorage.getItem('admin_token') || localStorage.getItem('token_admin') || '';
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

// Helper Format Tanggal Mining (Contoh: "01 Aug 26")
function formatTanggalMining(dateStr) {
  if (!dateStr) return '--';
  const cleanStr = String(dateStr).split('T')[0];
  const parts = cleanStr.split('-');
  if (parts.length !== 3) return dateStr;

  const year2Digits = parts[0].slice(-2);
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parts[2].padStart(2, '0');

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthAbbr = monthNames[monthIdx] || 'Jan';

  return `${day} ${monthAbbr} ${year2Digits}`;
}

// Input type=date bekerja dengan tanggal kalender lokal. Jangan memakai
// toISOString() langsung karena nilainya memakai UTC dan dapat bergeser satu
// hari pada jam-jam tertentu di zona waktu operasional.
function getLocalDateInputValue(date = new Date()) {
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 10);
}

// Inisialisasi Modul Produksi saat Halaman / Tab Dimuat
document.addEventListener('DOMContentLoaded', () => {
  muatMasterDataProduksi();
  setupSidebarClickHandlers();
  setupInputDataUnsavedGuards();
  setupFuelUnsavedGuards();
  setupStandbyUnsavedGuards();
  try {
    toggleFolderParameter(localStorage.getItem('omos:mine-planning-folder') === 'open');
  } catch (error) {
    toggleFolderParameter(false);
  }
});

function setupSidebarClickHandlers() {
  const tabs = document.querySelectorAll('.sidebar__tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      if (tab.classList.contains('sidebar__tab--folder')) return;
      const tabName = tab.getAttribute('data-tab');
      if (tabName && tabName.startsWith('prod')) {
        bukaTabProduksi(tabName);
      }
    });
  });
}

// Toggle Folder Utama 0. Parameter (Collapsible / Autohiding)
function toggleFolderParameter(forceOpen) {
  const subnav = document.getElementById('subnavParameter');
  const arrow = document.getElementById('arrowFolderParameter');
  const button = document.getElementById('btnFolderParameter');
  if (!subnav) return;

  const isOpen = forceOpen !== undefined ? Boolean(forceOpen) : subnav.hidden;
  subnav.hidden = !isOpen;
  if (button) button.setAttribute('aria-expanded', String(isOpen));
  if (arrow) arrow.textContent = isOpen ? '▼' : '▶';
  try { localStorage.setItem('omos:mine-planning-folder', isOpen ? 'open' : 'closed'); } catch (error) { /* storage opsional */ }
}

function escapeMinePlanning(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function parseMinePlanningHtml(payload) {
  return new DOMParser().parseFromString(`<div>${payload?.contentHtml || ''}</div>`, 'text/html');
}

function minePlanningCard(label, value, note, color, tabName) {
  return `<button type="button" onclick="bukaTabProduksi('${tabName}')" style="text-align:left;background:#fff;border:1px solid #dbe7f5;border-top:4px solid ${color};border-radius:12px;padding:14px;min-height:112px;cursor:pointer;box-shadow:0 2px 7px rgba(15,23,42,.04);">
    <div style="font-size:10px;letter-spacing:.08em;color:#64748b;font-weight:800;">${escapeMinePlanning(label)}</div>
    <div style="font-size:23px;color:#0f172a;font-weight:800;margin-top:8px;">${escapeMinePlanning(value)}</div>
    <div style="font-size:11px;color:#64748b;margin-top:6px;line-height:1.35;">${escapeMinePlanning(note)}</div>
  </button>`;
}

function minePlanningWorkflow(label, description, tabName, color) {
  return `<button type="button" onclick="bukaTabProduksi('${tabName}')" style="display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;background:#fff;border:1px solid #dbe7f5;border-left:4px solid ${color};border-radius:8px;padding:10px 12px;cursor:pointer;">
    <span><strong style="display:block;color:#0f172a;font-size:12px;">${escapeMinePlanning(label)}</strong><small style="color:#64748b;font-size:11px;">${escapeMinePlanning(description)}</small></span><span style="font-size:16px;color:#64748b;">→</span>
  </button>`;
}

async function muatMinePlanningOverview() {
  const host = document.getElementById('minePlanningOverview');
  if (!host) return;
  host.innerHTML = '<div style="padding:24px;color:#64748b;">Memuat Mine Planning Overview…</div>';
  try {
    const headers = getProdAuthHeaders();
    const paths = [
      '/api/admin/production/master',
      '/api/admin/production/productivity-plans/spo',
      '/api/admin/production/productivity-plans/ob',
      '/api/admin/production/productivity-plans/coal',
      '/api/admin/production/productivity-plans/fleet-capacity',
      '/api/admin/production/productivity-plans/unit-mapping',
    ];
    const responses = await Promise.all(paths.map(path => fetch(getProdApiUrl(path), { headers })));
    if (!responses[0].ok) throw new Error(`Master Equipment tidak dapat dimuat (${responses[0].status})`);
    const [master, spo, ob, coal, fleet, unitMapping] = await Promise.all(responses.map(async response => response.ok ? response.json() : {}));
    const equipment = master.equipment || [];
    const spoDoc = parseMinePlanningHtml(spo);
    const deployedSpo = [...spoDoc.querySelectorAll('.spo-table')]
      .filter(table => /^\s*deployed\s*$/i.test(table.querySelector('[data-spo-status]')?.textContent || ''));
    const jobs = [...new Set(deployedSpo.map(table => table.querySelector('[data-spo-job]')?.getAttribute('value')?.trim()).filter(Boolean))];
    const periods = Object.values(spo.planningData?.tables || {});
    const periodYears = periods.map(table => Number(table.startYear)).filter(Number.isFinite);
    const periodEndYears = periods.map(table => Number(table.endYear)).filter(Number.isFinite);
    const startYear = periodYears.length ? Math.min(...periodYears) : null;
    const endYear = periodEndYears.length ? Math.max(...periodEndYears) : null;
    const countPlans = payload => parseMinePlanningHtml(payload).querySelectorAll('.plan-productivity-table').length;
    const periodicSelections = fleet.planningData?.periodicSelections || {};
    const scheduledFleet = Object.values(periodicSelections).filter(days => Object.values(days || {}).some(value => value === true)).length;
    const pitAssignments = fleet.planningData?.pitAssignments || {};
    const locationByKey = new Map();
    equipment.forEach(unit => {
      const location = String(unit.lokasi || '').trim();
      const key = location.replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
      if (location && !locationByKey.has(key)) locationByKey.set(key, location);
    });
    const locations = [...locationByKey.values()];
    const configuredPitAreas = new Set(
      Object.values(pitAssignments).flatMap(days => Object.values(days || {}))
        .map(value => String(value || '').trim())
        .filter(value => locationByKey.has(value.replace(/\s+/g, ' ').toLocaleLowerCase('id-ID')))
        .map(value => locationByKey.get(value.replace(/\s+/g, ' ').toLocaleLowerCase('id-ID')))
    );
    const mappingAssignments = unitMapping.planningData?.assignments || {};
    const mappedUnits = Object.values(mappingAssignments).filter(days => Object.values(days || {}).some(Boolean)).length;
    const planningPeriod = startYear && endYear ? (startYear === endYear ? String(startYear) : `${startYear}–${endYear}`) : 'Belum dibuat';
    const planningReady = jobs.length && equipment.length && periods.length;

    host.innerHTML = `<section style="max-width:1500px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:16px;">
        <div><h2 style="margin:0;color:#0f172a;font-size:22px;font-weight:800;">🧭 Mine Planning</h2><p style="margin:4px 0 0;color:#64748b;font-size:13px;">Control center untuk memastikan struktur data, periode, fleet, area PIT, dan rencana produksi sudah terhubung.</p></div>
        <span style="font-size:11px;font-weight:700;color:${planningReady ? '#15803d' : '#b45309'};background:${planningReady ? '#f0fdf4' : '#fffbeb'};border:1px solid ${planningReady ? '#bbf7d0' : '#fde68a'};padding:7px 10px;border-radius:999px;">${planningReady ? '● Planning source terhubung' : '● Lengkapi sumber planning'}</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;">
        ${minePlanningCard('TOTAL UNIT', String(equipment.length), 'Master List Equipment', '#0284c7', 'prodListEquipment')}
        ${minePlanningCard('JOB SPO DEPLOYED', String(jobs.length), jobs.length ? jobs.join(', ') : 'Belum ada JOB aktif', '#16a34a', 'prodSpo')}
        ${minePlanningCard('PERIODE PLANNING', planningPeriod, periods.length ? 'Mengikuti konfigurasi SPO' : 'Buat periode SPO terlebih dahulu', '#7c3aed', 'prodSpo')}
        ${minePlanningCard('OB FLEET SETUP', String(countPlans(ob)), 'Tabel OB Productivity Planning', '#0ea5e9', 'prodPlanProductivity')}
        ${minePlanningCard('COAL FLEET SETUP', String(countPlans(coal)), 'Tabel Coal Productivity Planning', '#8b5cf6', 'prodCoalProductivity')}
        ${minePlanningCard('FLEET TERJADWAL', String(scheduledFleet), 'Fleet dengan checklist periode aktif', '#f59e0b', 'prodFleetCapacity')}
        ${minePlanningCard('PIT AREA SETUP', String(locations.length), locations.length ? locations.join(', ') : 'Isi Lokasi pada List Equipment', '#db2777', 'prodFleetCapacity')}
        ${minePlanningCard('PRODUCTION PLANNING', locations.length ? `${locations.length} area` : 'Belum siap', locations.length ? `${configuredPitAreas.size}/${locations.length} area sudah dialokasikan` : 'Alokasikan Lokasi pada List Equipment terlebih dahulu', '#2f7d68', 'prodFleetCapacity')}
        ${minePlanningCard('UNIT MAPPING', `${mappedUnits} unit`, mappedUnits ? 'Komposisi unit sudah dialokasikan' : 'Alokasikan DT dan support per area', '#0f766e', 'prodUnitMapping')}
        ${minePlanningCard('FUEL BUDGETING', jobs.length ? `${jobs.length} JOB` : 'Belum siap', jobs.length ? 'Estimasi liter mengikuti EWH dan fuel rate' : 'Deploy JOB SPO terlebih dahulu', '#ea580c', 'prodBudgetingCosting')}
      </div>
      <div style="margin-top:18px;background:#f8fafc;border:1px solid #dbe7f5;border-radius:12px;padding:14px;">
        <div style="font-size:11px;letter-spacing:.08em;color:#64748b;font-weight:800;margin-bottom:10px;">ALUR MINE PLANNING</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:8px;">
          ${minePlanningWorkflow('1. List Equipment', 'Master unit, class, kapasitas, fuel rate, dan lokasi.', 'prodListEquipment', '#0284c7')}
          ${minePlanningWorkflow('2. SPO', 'JOB, periode, dan loss time terencana.', 'prodSpo', '#16a34a')}
          ${minePlanningWorkflow('3. PA, UA & EWH', 'Ketersediaan dan effective working hours unit.', 'prodDelayForecasting', '#7c3aed')}
          ${minePlanningWorkflow('4. Productivity Planning', 'Parameter produktivitas OB dan Coal.', 'prodPlanProductivity', '#0ea5e9')}
          ${minePlanningWorkflow('5. Fleet & PIT Area', 'Jadwal fleet running dan alokasi area kerja.', 'prodFleetCapacity', '#f59e0b')}
          ${minePlanningWorkflow('6. Unit Mapping', 'Komposisi DT dan support per area operasional.', 'prodUnitMapping', '#0f766e')}
          ${minePlanningWorkflow('7. Fuel Budgeting', 'Proyeksi konsumsi BBM berdasarkan EWH.', 'prodBudgetingCosting', '#db2777')}
        </div>
      </div>
    </section>`;
  } catch (error) {
    console.error('Gagal memuat Mine Planning Overview:', error);
    host.innerHTML = `<div style="padding:16px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:10px;">Mine Planning Overview belum dapat dimuat: ${escapeMinePlanning(error.message)}</div>`;
  }
}

// Buka Tab Submenu Produksi
function bukaTabProduksi(tabName) {
  const inputDataTab = document.getElementById('tab-prodInputData');
  if (!inputDataNavigationBypass && tabName !== 'prodInputData' && inputDataTab && !inputDataTab.hidden && inputDataDrafts.size) {
    requestInputDataNavigation(() => bukaTabProduksi(tabName));
    return;
  }
  const fuelTab = document.getElementById('tab-prodInputFuel');
  if (!fuelNavigationBypass && tabName !== 'prodInputFuel' && fuelTab && !fuelTab.hidden && fuelDrafts.size) {
    requestFuelNavigation(() => bukaTabProduksi(tabName));
    return;
  }
  // Sembunyikan semua tab absensi/payroll (.tab-panel) dan tab produksi (.tab-konten)
  document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('is-aktif'));
  document.querySelectorAll('.tab-konten').forEach(el => el.hidden = true);
  document.querySelectorAll('.sidebar__tab').forEach(el => el.classList.remove('is-aktif'));

  // Otomatis buka folder jika tab yang dipilih adalah salah satu sub-folder parameter
  if (tabName && tabName.startsWith('prod') && ['prodMinePlanning','prodListEquipment','prodParamStandbyBd','prodSpo','prodDelayForecasting','prodPlanProductivity','prodCoalProductivity','prodBudgetingCosting','prodFleetCapacity','prodUnitMapping'].includes(tabName)) {
    toggleFolderParameter(true);
  }

  // Aktifkan tab yang dipilih
  const targetTab = document.getElementById(`tab-${tabName}`);
  const targetBtn = document.querySelector(`.sidebar__tab[data-tab="${tabName}"]`);

  if (targetTab) targetTab.hidden = false;
  if (targetBtn) targetBtn.classList.add('is-aktif');

  if (typeof simpanSesiUserOMOS === 'function' && tabName) {
    simpanSesiUserOMOS({ activeTab: tabName });
  }

  // Trigger pemuatan data sesuai tab
  switch (tabName) {
    case 'prodMinePlanning': muatMinePlanningOverview(); break;
    case 'prodListEquipment': muatProdListEquipment(); break;
    case 'prodParamStandbyBd': muatProdParamStandbyBd(); break;
    case 'prodSpo': window.SpoPlanning?.init(); break;
    case 'prodDelayForecasting': window.PaUaEwhPlanning?.init(); break;
    case 'prodPlanProductivity': muatMasterDataProduksi(); break;
    case 'prodCoalProductivity': muatMasterDataProduksi(); break;
    case 'prodBudgetingCosting': window.FuelBudgetingPlanning?.init(); break;
    case 'prodFleetCapacity': window.FleetCapacityPlanning?.init(); break;
    case 'prodUnitMapping': window.UnitMappingPlanning?.init(); break;
    case 'prodInputData': muatProdInputData(); break;
    case 'prodInputFuel': muatProdInputFuel(); break;
    case 'prodStandby': muatProdStandby(); break;
    case 'prodBreakdown': muatProdBreakdown(); break;
    case 'prodInputRitase': muatProdRitase(); break;
    case 'prodDailyDashboard': muatDailyDashboard(); break;
    case 'prodShiftReport': muatShiftReport(); break;
    case 'prodProductivityReport': muatProductivityReport(); break;
    case 'prodMtdReport': muatMtdReport(); break;
    case 'prodYtdReport': muatYtdReport(); break;
    case 'prodProjectToDate': muatProjectToDate(); break;
    case 'prodExecutiveDashboard': muatExecutiveDashboard(); break;
  }
}

// Fetch Master Data Produksi dari API Backend
async function muatMasterDataProduksi() {
  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/master'), {
      headers: { ...getProdAuthHeaders() }
    });
    if (res.ok) {
      masterProdData = await res.json();
      const excavatorCodes = (masterProdData.equipment || [])
        .filter((unit) => unit.kelas_alat === 'Excavator' && unit.kode_alat)
        .map((unit) => ({ value: unit.kode_alat, capacity: unit.kapasitas_unit }));
      if (window.PlanProductivity?.setFleetOptions) {
        window.PlanProductivity.setFleetOptions(excavatorCodes);
      }
      const dumpTruckCodes = (masterProdData.equipment || [])
        .filter((unit) => unit.kelas_alat === 'Dump Truck' && unit.kode_alat)
        .map((unit) => ({ value: unit.kode_alat, capacity: unit.kapasitas_unit }));
      if (window.PlanProductivity?.setDumpTruckOptions) {
        window.PlanProductivity.setDumpTruckOptions(dumpTruckCodes);
      }
    }
  } catch (err) {
    console.warn('[Prod Master Error]', err.message);
  }
}

// -------------------------------------------------------------
// 0.1 LIST EQUIPMENT & SLICER FILTER
// -------------------------------------------------------------
async function muatProdListEquipment() {
  await muatMasterDataProduksi();
  isiDropdownSlicers();
  terapkanSlicerEquipment();
}

function isiDropdownSlicers() {
  const units = masterProdData.equipment || [];

  // 1. Dynamic Dropdown Jenis Alat Slicer
  const selectKelas = document.getElementById('slicerEquipKelas');
  if (selectKelas) {
    const currentKelas = selectKelas.value;
    const kelasSet = new Set(units.map(u => u.kelas_alat).filter(Boolean));
    const sortedKelas = Array.from(kelasSet).sort();

    selectKelas.innerHTML = '<option value="">Semua Jenis Alat</option>' + sortedKelas.map(k => `<option value="${k}">${k}</option>`).join('');
    if (currentKelas && sortedKelas.includes(currentKelas)) {
      selectKelas.value = currentKelas;
    }
  }

  // 2. Dynamic Dropdown Tipe Model Slicer
  const selectTipe = document.getElementById('slicerEquipTipe');
  if (selectTipe) {
    const currentTipe = selectTipe.value;
    const tipeSet = new Set(units.map(u => u.tipe_alat).filter(Boolean));
    const sortedTipe = Array.from(tipeSet).sort();

    selectTipe.innerHTML = '<option value="">Semua Tipe Model</option>' + sortedTipe.map(t => `<option value="${t}">${t}</option>`).join('');
    if (currentTipe && sortedTipe.includes(currentTipe)) {
      selectTipe.value = currentTipe;
    }
  }
}

function terapkanSlicerEquipment() {
  const tbodyEquip = document.getElementById('tbodyParamEquipment');
  const counterBadge = document.getElementById('counterSlicerEquip');
  if (!tbodyEquip) return;

  const kelasVal = document.getElementById('slicerEquipKelas')?.value || '';
  const tipeVal = document.getElementById('slicerEquipTipe')?.value || '';

  if (typeof simpanSesiUserOMOS === 'function') {
    simpanSesiUserOMOS({
      slicers: {
        slicerEquipKelas: kelasVal,
        slicerEquipTipe: tipeVal
      }
    });
  }

  let units = masterProdData.equipment || [];
  renderEquipmentPopulationHighlights(units);

  if (kelasVal) {
    units = units.filter(u => u.kelas_alat === kelasVal);
  }
  if (tipeVal) {
    units = units.filter(u => u.tipe_alat === tipeVal);
  }

  filteredEquipmentUnits = units;

  if (counterBadge) {
    counterBadge.textContent = `Total Unit: ${units.length}`;
  }

  if (units.length === 0) {
    tbodyEquip.innerHTML = '<tr><td colspan="13" class="tabel__kosong">Tidak ada unit yang sesuai dengan filter slicer.</td></tr>';
  } else {
    tbodyEquip.innerHTML = units.map(u => `
      <tr>
        <td><strong style="color:#0284c7;">${u.kode_alat}</strong></td>
        <td>${u.kelas_alat}</td>
        <td>${u.class_unit || '-'}</td>
        <td>${u.tipe_alat}</td>
        <td><strong style="color:#64748b;">${u.brand || 'Caterpillar'}</strong></td>
        <td>${formatTanggalMining(u.date_in)}</td>
        <td><strong style="color:#ea580c;">${u.fuel_rate_lph || 35.0} L/Jam</strong></td>
        <td><strong style="color:#10b981;">${u.kapasitas_unit !== null && u.kapasitas_unit !== undefined ? Number(u.kapasitas_unit).toFixed(1) : '-'}</strong></td>
        <td>${u.kapasitas_unit_uom || '-'}</td>
        <td><span style="background:#e2e8f0;color:#334155;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;">${u.status_alat || '-'}</span></td>
        <td><span style="font-size:12px;color:#0f172a;">${u.lokasi || '-'}</span></td>
        <td><span style="font-size:12px;color:#64748b;">${u.keterangan || '-'}</span></td>
        <td>
          <button class="tombol-tautan" style="color:#0284c7;font-weight:bold;margin-right:8px;" onclick="bukaModalEditEquipment('${u.id}')">✏️ Edit</button>
          <button class="tombol-tautan" style="color:#ef4444;font-weight:bold;" onclick="hapusEquipmentParameter('${u.id}')">🗑️ Hapus</button>
        </td>
      </tr>
    `).join('');
  }
}

function renderEquipmentPopulationHighlights(units) {
  const container = document.getElementById('equipmentPopulationHighlights');
  if (!container) return;

  const countBy = (key, emptyLabel) => Object.entries(units.reduce((counts, unit) => {
    const label = unit[key] || emptyLabel;
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {})).sort(([a], [b]) => a.localeCompare(b));

  const renderGroup = (title, entries, accent) => `
    <div style="background:#fff;border:1px solid #e2e8f0;border-top:4px solid ${accent};border-radius:10px;padding:14px;">
      <div style="font-size:12px;font-weight:800;color:#334155;text-transform:uppercase;letter-spacing:.04em;">${title}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
        ${entries.length ? entries.map(([label, total]) => `<span style="background:#f1f5f9;color:#0f172a;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:700;">${label}: ${total}</span>`).join('') : '<span style="color:#64748b;font-size:12px;">Belum ada unit</span>'}
      </div>
    </div>`;

  container.innerHTML = renderGroup('Total Populasi per Jenis Alat', countBy('kelas_alat', 'Belum diisi'), '#0284c7')
    + renderGroup('Total Populasi per Class', countBy('class_unit', 'Belum diisi'), '#16a34a');
}

function pilihFileImportEquipment() {
  const input = document.getElementById('inputImportEquipment');
  if (!input) return;
  input.value = '';
  input.onchange = () => importEquipmentExcel(input.files?.[0]);
  input.click();
}

function excelDateToIso(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && window.XLSX?.SSF) {
    const parsed = window.XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : text;
}

async function importEquipmentExcel(file) {
  if (!file) return;
  if (!window.XLSX) return alert('Library Excel belum siap. Refresh dashboard lalu coba kembali.');
  try {
    const buffer = await file.arrayBuffer();
    const workbook = window.XLSX.read(buffer, { type: 'array', cellDates: true });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const sourceRows = window.XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
    const rows = sourceRows
      .filter((row) => Object.values(row).some((value) => String(value).trim() !== ''))
      .map((row) => ({
        kode_alat: row['Kode Unit'],
        kelas_alat: row['Jenis Alat'],
        class_unit: row.Class,
        tipe_alat: row['Tipe Model'],
        brand: row['Brand / Merek'],
        date_in: excelDateToIso(row['Tanggal Masuk (Date In)']),
        fuel_rate_lph: row['Standard Fuel Rate (L/Jam)'],
        kapasitas_unit: row['Kapasitas Unit - Value'],
        kapasitas_unit_uom: row['Kapasitas Unit - UoM'],
        status_alat: row.Status,
        lokasi: row.Lokasi,
        keterangan: row.Keterangan,
      }));

    if (!rows.length) return alert('Tidak ada baris unit pada file Excel.');
    const missing = rows.findIndex((row) => !String(row.kode_alat || '').trim() || !String(row.kelas_alat || '').trim() || !String(row.tipe_alat || '').trim());
    if (missing >= 0) return alert(`Baris Excel ${missing + 2}: Kode Unit, Jenis Alat, dan Tipe Model wajib diisi.`);
    if (!confirm(`Import ${rows.length} unit dari ${file.name}? Kode Unit yang sama akan diperbarui.`)) return;

    const res = await fetch(getProdApiUrl('/api/admin/production/equipment/import'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
      body: JSON.stringify({ rows }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || 'Gagal mengimpor data Excel.');
    alert(result.message || 'Import data Excel berhasil.');
    await muatProdListEquipment();
  } catch (err) {
    alert(`Import gagal: ${err.message}`);
  }
}

function exportEquipmentExcel() {
  if (!window.XLSX) return alert('Library Excel belum siap. Refresh dashboard lalu coba kembali.');
  const units = Array.isArray(filteredEquipmentUnits) ? filteredEquipmentUnits : (masterProdData.equipment || []);
  if (!units.length) return alert('Tidak ada data unit untuk diekspor.');

  const headers = [
    'Kode Unit', 'Jenis Alat', 'Class', 'Tipe Model', 'Brand / Merek',
    'Tanggal Masuk (Date In)', 'Standard Fuel Rate (L/Jam)',
    'Kapasitas Unit - Value', 'Kapasitas Unit - UoM', 'Status', 'Lokasi', 'Keterangan',
  ];
  const rows = units.map((unit) => [
    unit.kode_alat || '', unit.kelas_alat || '', unit.class_unit || '', unit.tipe_alat || '', unit.brand || '',
    unit.date_in ? String(unit.date_in).slice(0, 10) : '', Number(unit.fuel_rate_lph || 0),
    unit.kapasitas_unit === null || unit.kapasitas_unit === undefined ? '' : Number(unit.kapasitas_unit),
    unit.kapasitas_unit_uom || '', unit.status_alat || '', unit.lokasi || '', unit.keterangan || '',
  ]);
  const worksheet = window.XLSX.utils.aoa_to_sheet([headers, ...rows]);
  worksheet['!cols'] = [
    { wch: 16 }, { wch: 18 }, { wch: 16 }, { wch: 28 }, { wch: 20 }, { wch: 21 },
    { wch: 24 }, { wch: 24 }, { wch: 21 }, { wch: 14 }, { wch: 20 }, { wch: 34 },
  ];
  for (let row = 2; row <= rows.length + 1; row += 1) {
    const fuelCell = worksheet[`G${row}`];
    const capacityCell = worksheet[`H${row}`];
    if (fuelCell) fuelCell.z = '0.0';
    if (capacityCell) capacityCell.z = '0.0';
  }
  worksheet['!autofilter'] = { ref: `A1:L${rows.length + 1}` };
  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Master Equipment');
  window.XLSX.writeFile(workbook, `OMOS_Master_Equipment_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function resetSlicerEquipment() {
  const selKelas = document.getElementById('slicerEquipKelas');
  const selTipe = document.getElementById('slicerEquipTipe');
  if (selKelas) selKelas.value = '';
  if (selTipe) selTipe.value = '';
  terapkanSlicerEquipment();
}

async function muatProdParamStandbyBd() {
  await muatMasterDataProduksi();
  const tbodyStb = document.getElementById('tbodyParamStandby');
  const tbodyBd = document.getElementById('tbodyParamBreakdown');
  const tbodyJob = document.getElementById('tbodyParamJob');
  const tbodyProblem = document.getElementById('tbodyParamProblem');

  if (tbodyStb) {
    const stb = masterProdData.standbyCodes || [];
    tbodyStb.innerHTML = stb.length ? stb.map(s => {
      const locked = s.is_locked || s.is_system;
      const readOnly = locked ? 'readonly aria-readonly="true"' : '';
      return `
      <tr data-delay-master-row="standby:${escapeMinePlanning(s.id)}">
        <td><input data-delay-master-field="kode" class="input-filter" maxlength="20" value="${escapeMinePlanning(s.kode)}" ${readOnly} style="width:100%;font-weight:800;text-transform:uppercase;${locked ? 'background:#eef2ff;color:#3730a3;' : ''}" /></td>
        <td><input data-delay-master-field="kategori" class="input-filter" maxlength="100" value="${escapeMinePlanning(s.kategori)}" ${readOnly} style="width:100%;${locked ? 'background:#eef2ff;color:#3730a3;' : ''}" /></td>
        <td><input data-delay-master-field="deskripsi" class="input-filter" value="${escapeMinePlanning(s.deskripsi || '')}" ${readOnly} style="width:100%;${locked ? 'background:#eef2ff;color:#3730a3;' : ''}" /></td>
        <td><div class="standby-code-governance"><select data-delay-master-field="planning_type" ${locked ? 'disabled' : ''}><option value="planned"${s.planning_type === 'planned' ? ' selected' : ''}>Planned</option><option value="unplanned"${s.planning_type !== 'planned' ? ' selected' : ''}>Unplanned</option></select><select data-delay-master-field="control_class" ${locked ? 'disabled' : ''}><option value="controllable"${s.control_class !== 'uncontrollable' ? ' selected' : ''}>Controllable</option><option value="uncontrollable"${s.control_class === 'uncontrollable' ? ' selected' : ''}>Uncontrollable</option></select><input data-delay-master-field="owner_department" value="${escapeMinePlanning(s.owner_department || 'Production')}" ${readOnly} placeholder="Owner department"/><label><input type="checkbox" data-delay-master-field="requires_description"${s.requires_description ? ' checked' : ''} ${locked ? 'disabled' : ''}/> Keterangan wajib</label></div></td>
        <td>${locked ? '<span class="standby-system-lock">🔒 Sistem · Read Only</span>' : `<div style="display:flex;gap:6px;align-items:center;"><button class="tombol tombol--kecil" onclick="simpanDelayMaster('standby','${escapeMinePlanning(s.id)}')">Simpan</button><button class="tombol tombol--ghost tombol--kecil" style="color:#b91c1c;" onclick="hapusDelayMaster('standby','${escapeMinePlanning(s.id)}')">Hapus</button></div>`}</td>
      </tr>
    `;
    }).join('') : '<tr><td colspan="5" class="tabel__kosong">Belum ada kode standby.</td></tr>';
  }

  if (tbodyBd) {
    const bd = masterProdData.breakdownCodes || [];
    tbodyBd.innerHTML = bd.length ? bd.map(b => `
      <tr data-delay-master-row="breakdown:${escapeMinePlanning(b.id)}">
        <td><input data-delay-master-field="kode" class="input-filter" maxlength="20" value="${escapeMinePlanning(b.kode)}" style="width:100%;font-weight:800;text-transform:uppercase;" /></td>
        <td><input data-delay-master-field="kategori" class="input-filter" maxlength="100" value="${escapeMinePlanning(b.kategori)}" style="width:100%;" /></td>
        <td><input data-delay-master-field="deskripsi" class="input-filter" value="${escapeMinePlanning(b.deskripsi || '')}" style="width:100%;" /></td>
        <td><div style="display:flex;gap:6px;align-items:center;"><button class="tombol tombol--kecil" onclick="simpanDelayMaster('breakdown','${escapeMinePlanning(b.id)}')">Simpan</button><button class="tombol tombol--ghost tombol--kecil" style="color:#b91c1c;" onclick="hapusDelayMaster('breakdown','${escapeMinePlanning(b.id)}')">Hapus</button></div></td>
      </tr>
    `).join('') : '<tr><td colspan="4" class="tabel__kosong">Belum ada kode breakdown.</td></tr>';
  }

  if (tbodyJob) {
    const jobs = masterProdData.jobCodes || [];
    tbodyJob.innerHTML = jobs.length ? jobs.map(job => `
      <tr data-job-code-row="${escapeMinePlanning(job.id)}">
        <td><input data-job-code-field="job_code" class="input-filter" maxlength="20" value="${escapeMinePlanning(job.job_code)}" style="width:100%;font-weight:800;text-transform:uppercase;" /></td>
        <td><input data-job-code-field="job_desc" class="input-filter" maxlength="200" value="${escapeMinePlanning(job.job_desc)}" style="width:100%;" /></td>
        <td>
          <div style="display:flex;gap:6px;align-items:center;">
            <button class="tombol tombol--kecil" onclick="simpanJobCode('${escapeMinePlanning(job.id)}')">Simpan</button>
            <button class="tombol tombol--ghost tombol--kecil" style="color:#b91c1c;" onclick="hapusJobCode('${escapeMinePlanning(job.id)}')">Hapus</button>
          </div>
        </td>
      </tr>
    `).join('') : '<tr><td colspan="3" class="tabel__kosong">Belum ada master JOB. Tambahkan kode JOB baru.</td></tr>';
  }

  if (tbodyProblem) {
    const items = (masterProdData.problemCodes || []).slice();
    const KAT_ORDER = { MACHINE: 1, MAN: 2, METHOD: 3, MATERIAL: 4, ENVIRO: 5 };
    const prefixRank = (k) => k.startsWith('PF') ? 1 : k.startsWith('PRO') ? 2 : k.startsWith('PR') ? 3 : k.startsWith('PD') ? 4 : 5;
    items.sort((a, b) => (KAT_ORDER[a.kategori] || 9) - (KAT_ORDER[b.kategori] || 9) || prefixRank(a.kode) - prefixRank(b.kode) || a.kode.localeCompare(b.kode));

    if (!items.length) {
      tbodyProblem.innerHTML = '<tr><td colspan="4" class="tabel__kosong">Belum ada kode problem. Tambahkan problem baru.</td></tr>';
    } else {
      let html = '';
      let prevKat = null;
      let rowsOfKat = [];
      const flushKat = () => {
        const n = rowsOfKat.length;
        rowsOfKat.forEach((it, idx) => {
          const katCell = idx === 0
            ? `<td rowspan="${n}" style="vertical-align:middle;font-weight:800;color:#0f172a;background:#f8fafc;">${escapeMinePlanning(it.kategori)}</td>`
            : '';
          html += `<tr data-problem-code-row="${escapeMinePlanning(it.id)}" data-kat="${escapeMinePlanning(it.kategori)}">
            ${katCell}
            <td><input data-problem-code-field="kode" class="input-filter" maxlength="20" value="${escapeMinePlanning(it.kode)}" style="width:100%;font-weight:800;text-transform:uppercase;" /></td>
            <td><input data-problem-code-field="problem" class="input-filter" maxlength="200" value="${escapeMinePlanning(it.problem)}" style="width:100%;" /></td>
            <td><div style="display:flex;gap:6px;align-items:center;"><button class="tombol tombol--kecil" onclick="simpanProblemCode('${escapeMinePlanning(it.id)}')">Simpan</button><button class="tombol tombol--ghost tombol--kecil" style="color:#b91c1c;" onclick="hapusProblemCode('${escapeMinePlanning(it.id)}')">Hapus</button></div></td>
          </tr>`;
        });
      };
      for (const it of items) {
        if (prevKat !== null && it.kategori !== prevKat) { flushKat(); rowsOfKat = []; }
        rowsOfKat.push(it);
        prevKat = it.kategori;
      }
      if (rowsOfKat.length) flushKat();
      tbodyProblem.innerHTML = html;
    }
  }
}

async function simpanDelayMaster(tipe, id) {
  const row = document.querySelector(`[data-delay-master-row="${CSS.escape(`${tipe}:${id}`)}"]`);
  if (!row) return;
  const kode = row.querySelector('[data-delay-master-field="kode"]')?.value.trim().toUpperCase();
  const kategori = row.querySelector('[data-delay-master-field="kategori"]')?.value.trim();
  const deskripsi = row.querySelector('[data-delay-master-field="deskripsi"]')?.value.trim() || '';
  const planning_type = row.querySelector('[data-delay-master-field="planning_type"]')?.value || 'unplanned';
  const control_class = row.querySelector('[data-delay-master-field="control_class"]')?.value || 'controllable';
  const owner_department = row.querySelector('[data-delay-master-field="owner_department"]')?.value.trim() || 'Production';
  const requires_description = Boolean(row.querySelector('[data-delay-master-field="requires_description"]')?.checked);
  if (!kode || !kategori) return alert('Kode dan kategori wajib diisi.');
  const endpoint = tipe === 'standby' ? 'standby-codes' : 'breakdown-codes';
  try {
    const response = await fetch(getProdApiUrl(`/api/admin/production/${endpoint}/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
      body: JSON.stringify({ kode, kategori, deskripsi, ...(tipe === 'standby' ? { planning_type, control_class, owner_department, requires_description } : {}) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await muatProdParamStandbyBd();
  } catch (error) {
    alert(`Gagal memperbarui kode ${tipe}: ${error.message}`);
  }
}

async function hapusDelayMaster(tipe, id) {
  if (!confirm(`Hapus kode ${tipe} ini dari master?`)) return;
  const endpoint = tipe === 'standby' ? 'standby-codes' : 'breakdown-codes';
  try {
    const response = await fetch(getProdApiUrl(`/api/admin/production/${endpoint}/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: { ...getProdAuthHeaders() },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await muatProdParamStandbyBd();
  } catch (error) {
    alert(`Gagal menghapus kode ${tipe}: ${error.message}`);
  }
}

async function simpanJobCode(id) {
  const row = document.querySelector(`[data-job-code-row="${CSS.escape(String(id))}"]`);
  if (!row) return;
  const jobCode = row.querySelector('[data-job-code-field="job_code"]')?.value.trim().toUpperCase();
  const jobDesc = row.querySelector('[data-job-code-field="job_desc"]')?.value.trim();
  if (!jobCode || !jobDesc) return alert('JOB dan JOB DESC wajib diisi.');
  try {
    const response = await fetch(getProdApiUrl(`/api/admin/production/job-codes/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
      body: JSON.stringify({ job_code: jobCode, job_desc: jobDesc }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await muatProdParamStandbyBd();
  } catch (error) {
    alert(`Gagal memperbarui master JOB: ${error.message}`);
  }
}

async function hapusJobCode(id) {
  if (!confirm('Hapus kode JOB ini dari master?')) return;
  try {
    const response = await fetch(getProdApiUrl(`/api/admin/production/job-codes/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: { ...getProdAuthHeaders() },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await muatProdParamStandbyBd();
  } catch (error) {
    alert(`Gagal menghapus master JOB: ${error.message}`);
  }
}

function bukaModalTambahJobCode() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  konten.innerHTML = `
    <h3 style="margin-top:0;color:#0f172a;">Tambah Master JOB</h3>
    <form id="formInputJobCode">
      <div style="margin-bottom:10px;"><label class="label">JOB</label><input id="pmJobCode" class="input-filter" maxlength="20" placeholder="Contoh: OB" style="text-transform:uppercase;" required /></div>
      <div style="margin-bottom:14px;"><label class="label">JOB DESC</label><input id="pmJobDesc" class="input-filter" maxlength="200" placeholder="Deskripsi pekerjaan" required /></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan JOB</button></div>
    </form>`;
  overlay.hidden = false;
  document.getElementById('formInputJobCode').addEventListener('submit', async event => {
    event.preventDefault();
    const jobCode = document.getElementById('pmJobCode').value.trim().toUpperCase();
    const jobDesc = document.getElementById('pmJobDesc').value.trim();
    try {
      const response = await fetch(getProdApiUrl('/api/admin/production/job-codes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify({ job_code: jobCode, job_desc: jobDesc }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      tutupModalGenerik();
      await muatProdParamStandbyBd();
    } catch (error) {
      alert(`Gagal menyimpan master JOB: ${error.message}`);
    }
  });
}

async function simpanProblemCode(id) {
  const row = document.querySelector(`[data-problem-code-row="${CSS.escape(String(id))}"]`);
  if (!row) return;
  const kategori = row.dataset.kat || '';
  const kode = row.querySelector('[data-problem-code-field="kode"]')?.value.trim().toUpperCase();
  const problem = row.querySelector('[data-problem-code-field="problem"]')?.value.trim();
  if (!kategori || !kode || !problem) return alert('Kategori, Kode, dan Problem wajib diisi.');
  try {
    const response = await fetch(getProdApiUrl(`/api/admin/production/problem-codes/${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
      body: JSON.stringify({ kategori, kode, problem }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await muatProdParamStandbyBd();
  } catch (error) {
    alert(`Gagal memperbarui problem: ${error.message}`);
  }
}

async function hapusProblemCode(id) {
  if (!confirm('Hapus kode problem ini dari master?')) return;
  try {
    const response = await fetch(getProdApiUrl(`/api/admin/production/problem-codes/${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: { ...getProdAuthHeaders() },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await muatProdParamStandbyBd();
  } catch (error) {
    alert(`Gagal menghapus problem: ${error.message}`);
  }
}

function bukaModalTambahProblemCode() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  const katOptions = ['MACHINE', 'MAN', 'METHOD', 'MATERIAL', 'ENVIRO'].map(k => `<option value="${k}">${k}</option>`).join('');
  konten.innerHTML = `
    <h3 style="margin-top:0;color:#0f172a;">Tambah Problem Productivity</h3>
    <form id="formInputProblemCode">
      <div style="margin-bottom:10px;"><label class="label">Kategori</label><select id="pmProblemKat" class="input-filter" required>${katOptions}</select></div>
      <div style="margin-bottom:10px;"><label class="label">Kode</label><input id="pmProblemKode" class="input-filter" maxlength="20" placeholder="Contoh: PF01" style="text-transform:uppercase;" required /></div>
      <div style="margin-bottom:14px;"><label class="label">Problem</label><input id="pmProblemDesc" class="input-filter" maxlength="200" placeholder="Deskripsi problem" required /></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Problem</button></div>
    </form>`;
  overlay.hidden = false;
  document.getElementById('formInputProblemCode').addEventListener('submit', async event => {
    event.preventDefault();
    const kategori = document.getElementById('pmProblemKat').value;
    const kode = document.getElementById('pmProblemKode').value.trim().toUpperCase();
    const problem = document.getElementById('pmProblemDesc').value.trim();
    try {
      const response = await fetch(getProdApiUrl('/api/admin/production/problem-codes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify({ kategori, kode, problem }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      tutupModalGenerik();
      await muatProdParamStandbyBd();
    } catch (error) {
      alert(`Gagal menyimpan problem: ${error.message}`);
    }
  });
}

async function muatProdParameter() {
  await muatProdListEquipment();
  await muatProdParamStandbyBd();
}

// Hapus Semua Data Parameter & Log Lama (Bersihkan Konsep Baru)
async function hapusSemuaParameterLama() {
  if (!confirm('⚠️ PERINGATAN: Apakah Anda yakin ingin MENGHAPUS SEMUA data parameter unit & delay lama? Anda dapat membuat konsep master unit baru secara bersih.')) return;

  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/clear-parameters'), {
      method: 'POST',
      headers: { ...getProdAuthHeaders() }
    });
    if (res.ok) {
      alert('✅ Semua parameter unit & log lama berhasil dihapus bersih!');
      muatProdParameter();
    } else {
      alert('Gagal menghapus parameter.');
    }
  } catch (err) {
    alert('Terjadi kesalahan: ' + err.message);
  }
}

function bukaModalEditEquipment(id) {
  const u = (masterProdData.equipment || []).find(item => item.id === id);
  if (!u) return alert('Data unit tidak ditemukan.');

  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;

  const tglVal = u.date_in ? u.date_in.split('T')[0] : new Date().toISOString().split('T')[0];

  const standardKelas = ['Excavator', 'Dump Truck', 'Dozer', 'Grader', 'Wheel Loader', 'Compactor', 'Fuel Truck', 'Water Truck', 'Heavy Equipment', 'Support'];
  const isKelasCustom = u.kelas_alat && !standardKelas.includes(u.kelas_alat);

  const standardBrand = ['Caterpillar', 'Komatsu', 'Hitachi', 'Scania', 'Volvo', 'Isuzu', 'Sany', 'Hino', 'Liebherr'];
  const isBrandCustom = u.brand && !standardBrand.includes(u.brand);

  konten.innerHTML = `
    <h3 style="margin-top:0;color:#0f172a;">✏️ Edit Data Master Unit Alat Berat</h3>
    <form id="formEditParamEquipment">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Kode Unit / No Lambung</label>
          <input type="text" id="peEditKode" class="input-filter" value="${u.kode_alat}" required />
        </div>
        <div>
          <label class="label">Jenis Alat</label>
          <select id="peEditKelas" class="input-filter" required>
            <option value="Excavator" ${u.kelas_alat === 'Excavator' ? 'selected' : ''}>Excavator</option>
            <option value="Dump Truck" ${u.kelas_alat === 'Dump Truck' ? 'selected' : ''}>Dump Truck</option>
            <option value="Dozer" ${u.kelas_alat === 'Dozer' ? 'selected' : ''}>Dozer</option>
            <option value="Grader" ${u.kelas_alat === 'Grader' ? 'selected' : ''}>Grader</option>
            <option value="Wheel Loader" ${u.kelas_alat === 'Wheel Loader' ? 'selected' : ''}>Wheel Loader</option>
            <option value="Compactor" ${u.kelas_alat === 'Compactor' ? 'selected' : ''}>Compactor</option>
            <option value="Fuel Truck" ${u.kelas_alat === 'Fuel Truck' ? 'selected' : ''}>Fuel Truck</option>
            <option value="Water Truck" ${u.kelas_alat === 'Water Truck' ? 'selected' : ''}>Water Truck</option>
            <option value="Heavy Equipment" ${u.kelas_alat === 'Heavy Equipment' ? 'selected' : ''}>Heavy Equipment</option>
            <option value="Support" ${u.kelas_alat === 'Support' ? 'selected' : ''}>Support</option>
            <option value="MANUAL" ${isKelasCustom ? 'selected' : ''}>✍️ [Input Manual Kustom...]</option>
          </select>
          <div id="divEditKelasManual" style="margin-top:6px;" ${isKelasCustom ? '' : 'hidden'}>
            <input type="text" id="peEditKelasManual" class="input-filter" placeholder="Ketik Jenis Alat kustom..." value="${isKelasCustom ? u.kelas_alat : ''}" />
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Tipe / Model Unit</label>
          <input type="text" id="peEditTipe" class="input-filter" value="${u.tipe_alat}" required />
        </div>
        <div>
          <label class="label">Brand / Merek Manufactur</label>
          <select id="peEditBrand" class="input-filter" required>
            <option value="Caterpillar" ${u.brand === 'Caterpillar' ? 'selected' : ''}>Caterpillar (CAT)</option>
            <option value="Komatsu" ${u.brand === 'Komatsu' ? 'selected' : ''}>Komatsu</option>
            <option value="Hitachi" ${u.brand === 'Hitachi' ? 'selected' : ''}>Hitachi</option>
            <option value="Scania" ${u.brand === 'Scania' ? 'selected' : ''}>Scania</option>
            <option value="Volvo" ${u.brand === 'Volvo' ? 'selected' : ''}>Volvo</option>
            <option value="Isuzu" ${u.brand === 'Isuzu' ? 'selected' : ''}>Isuzu</option>
            <option value="Sany" ${u.brand === 'Sany' ? 'selected' : ''}>Sany</option>
            <option value="Hino" ${u.brand === 'Hino' ? 'selected' : ''}>Hino</option>
            <option value="Liebherr" ${u.brand === 'Liebherr' ? 'selected' : ''}>Liebherr</option>
            <option value="MANUAL" ${isBrandCustom ? 'selected' : ''}>✍️ [Input Manual Kustom...]</option>
          </select>
          <div id="divEditBrandManual" style="margin-top:6px;" ${isBrandCustom ? '' : 'hidden'}>
            <input type="text" id="peEditBrandManual" class="input-filter" placeholder="Ketik Brand kustom..." value="${isBrandCustom ? u.brand : ''}" />
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Class</label>
          <input type="text" id="peEditClassUnit" class="input-filter" placeholder="cth: DT 30 T" value="${u.class_unit || ''}" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Tanggal Masuk (Date In)</label>
          <input type="date" id="peEditDateIn" class="input-filter" value="${tglVal}" required />
        </div>
        <div>
          <label class="label">Fuel Rate (L/Jam)</label>
          <input type="number" step="0.1" id="peEditFuelRate" class="input-filter" value="${u.fuel_rate_lph || 35.0}" required />
        </div>
        <div>
          <label class="label">Kapasitas Unit — Value</label>
          <input type="number" step="0.1" id="peEditKapasitas" class="input-filter" placeholder="cth: 50.0" value="${u.kapasitas_unit !== null && u.kapasitas_unit !== undefined ? Number(u.kapasitas_unit).toFixed(1) : ''}" />
        </div>
        <div>
          <label class="label">Kapasitas Unit — UoM</label>
          <input type="text" id="peEditKapasitasUom" class="input-filter" placeholder="cth: Ton, BCM, m³" value="${u.kapasitas_unit_uom || ''}" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px;">
        <div>
          <label class="label">Status Unit (Input Manual)</label>
          <input type="text" id="peEditStatus" class="input-filter" placeholder="cth: Working, Standby, Breakdown" value="${u.status_alat || ''}" />
        </div>
        <div>
          <label class="label">Lokasi</label>
          <input type="text" id="peEditLokasi" class="input-filter" placeholder="cth: Pit 1, Front A, Workshop" value="${u.lokasi || ''}" />
        </div>
        <div>
          <label class="label">Keterangan</label>
          <input type="text" id="peEditKeterangan" class="input-filter" placeholder="cth: Unit Backup" value="${u.keterangan || ''}" />
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan Perubahan Data</button>
      </div>
    </form>
  `;
  overlay.hidden = false;

  document.getElementById('peEditKelas').addEventListener('change', (e) => {
    document.getElementById('divEditKelasManual').hidden = e.target.value !== 'MANUAL';
  });
  document.getElementById('peEditBrand').addEventListener('change', (e) => {
    document.getElementById('divEditBrandManual').hidden = e.target.value !== 'MANUAL';
  });

  document.getElementById('formEditParamEquipment').addEventListener('submit', async (e) => {
    e.preventDefault();
    const kelasSel = document.getElementById('peEditKelas').value;
    const kelasVal = kelasSel === 'MANUAL' ? (document.getElementById('peEditKelasManual').value.trim() || 'Heavy Equipment') : kelasSel;

    const brandSel = document.getElementById('peEditBrand').value;
    const brandVal = brandSel === 'MANUAL' ? (document.getElementById('peEditBrandManual').value.trim() || 'Caterpillar') : brandSel;

    const bodyData = {
      kode_alat: document.getElementById('peEditKode').value,
      kelas_alat: kelasVal,
      class_unit: document.getElementById('peEditClassUnit').value.trim() || null,
      tipe_alat: document.getElementById('peEditTipe').value,
      brand: brandVal,
      date_in: document.getElementById('peEditDateIn').value,
      fuel_rate_lph: document.getElementById('peEditFuelRate').value,
      kapasitas_unit: document.getElementById('peEditKapasitas').value || null,
      kapasitas_unit_uom: document.getElementById('peEditKapasitasUom').value.trim() || null,
      status_alat: document.getElementById('peEditStatus').value,
      lokasi: document.getElementById('peEditLokasi').value,
      keterangan: document.getElementById('peEditKeterangan').value
    };

    try {
      const res = await fetch(getProdApiUrl(`/api/admin/production/equipment/${id}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify(bodyData)
      });
      if (res.ok) {
        tutupModalGenerik();
        muatProdListEquipment();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert('Gagal memperbarui data unit: ' + (errData.error || 'Terjadi kesalahan pada server.'));
      }
    } catch (err) {
      alert('Terjadi kesalahan: ' + err.message);
    }
  });
}

function bukaModalTambahEquipment() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;

  konten.innerHTML = `
    <h3 style="margin-top:0;color:#0f172a;">🚜 Tambah Unit Alat Berat Baru</h3>
    <form id="formInputParamEquipment">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Kode Unit (e.g. EXC-01, DT-05)</label>
          <input type="text" id="peKode" class="input-filter" placeholder="EXC-03" required />
        </div>
        <div>
          <label class="label">Jenis Alat</label>
          <select id="peKelas" class="input-filter" required>
            <option value="Excavator">Excavator</option>
            <option value="Dump Truck">Dump Truck</option>
            <option value="Dozer">Dozer</option>
            <option value="Grader">Grader</option>
            <option value="Wheel Loader">Wheel Loader</option>
            <option value="Compactor">Compactor</option>
            <option value="Fuel Truck">Fuel Truck</option>
            <option value="Water Truck">Water Truck</option>
            <option value="Heavy Equipment">Heavy Equipment</option>
            <option value="Support">Support</option>
            <option value="MANUAL">✍️ [Input Manual Kustom...]</option>
          </select>
          <div id="divKelasManual" style="margin-top:6px;" hidden>
            <input type="text" id="peKelasManual" class="input-filter" placeholder="Ketik Jenis Alat kustom..." />
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Tipe / Model Unit</label>
          <input type="text" id="peTipe" class="input-filter" placeholder="CAT 6020B (20 Ton)" required />
        </div>
        <div>
          <label class="label">Brand / Merek Manufactur</label>
          <select id="peBrand" class="input-filter" required>
            <option value="Caterpillar">Caterpillar (CAT)</option>
            <option value="Komatsu">Komatsu</option>
            <option value="Hitachi">Hitachi</option>
            <option value="Scania">Scania</option>
            <option value="Volvo">Volvo</option>
            <option value="Isuzu">Isuzu</option>
            <option value="Sany">Sany</option>
            <option value="Hino">Hino</option>
            <option value="Liebherr">Liebherr</option>
            <option value="MANUAL">✍️ [Input Manual Kustom...]</option>
          </select>
          <div id="divBrandManual" style="margin-top:6px;" hidden>
            <input type="text" id="peBrandManual" class="input-filter" placeholder="Ketik Brand kustom..." />
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Class</label>
          <input type="text" id="peClassUnit" class="input-filter" placeholder="cth: DT 30 T" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Tanggal Masuk (Date In)</label>
          <input type="date" id="peDateIn" class="input-filter" value="${new Date().toISOString().split('T')[0]}" required />
        </div>
        <div>
          <label class="label">Standard Fuel Rate (Liter / Jam)</label>
          <input type="number" step="0.1" id="peFuelRate" class="input-filter" placeholder="35.0" required />
        </div>
        <div>
          <label class="label">Kapasitas Unit — Value</label>
          <input type="number" step="0.1" id="peKapasitas" class="input-filter" placeholder="cth: 50.0" />
        </div>
        <div>
          <label class="label">Kapasitas Unit — UoM</label>
          <input type="text" id="peKapasitasUom" class="input-filter" placeholder="cth: Ton, BCM, m³" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Status Unit (Input Manual)</label>
          <input type="text" id="peStatus" class="input-filter" placeholder="cth: Working, Standby, Ready" />
        </div>
        <div>
          <label class="label">Lokasi</label>
          <input type="text" id="peLokasi" class="input-filter" placeholder="cth: Pit 1, Front A, Workshop" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div>
          <label class="label">Keterangan</label>
          <input type="text" id="peKeterangan" class="input-filter" placeholder="cth: Perlu Service 250H, Unit Backup" />
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan Parameter Unit</button>
      </div>
    </form>
  `;
  overlay.hidden = false;

  document.getElementById('peKelas').addEventListener('change', (e) => {
    document.getElementById('divKelasManual').hidden = e.target.value !== 'MANUAL';
  });
  document.getElementById('peBrand').addEventListener('change', (e) => {
    document.getElementById('divBrandManual').hidden = e.target.value !== 'MANUAL';
  });

  document.getElementById('formInputParamEquipment').addEventListener('submit', async (e) => {
    e.preventDefault();
    const kelasSel = document.getElementById('peKelas').value;
    const kelasVal = kelasSel === 'MANUAL' ? (document.getElementById('peKelasManual').value.trim() || 'Heavy Equipment') : kelasSel;

    const brandSel = document.getElementById('peBrand').value;
    const brandVal = brandSel === 'MANUAL' ? (document.getElementById('peBrandManual').value.trim() || 'Caterpillar') : brandSel;

    const bodyData = {
      kode_alat: document.getElementById('peKode').value,
      kelas_alat: kelasVal,
      class_unit: document.getElementById('peClassUnit').value.trim() || null,
      tipe_alat: document.getElementById('peTipe').value,
      brand: brandVal,
      date_in: document.getElementById('peDateIn').value,
      fuel_rate_lph: document.getElementById('peFuelRate').value,
      kapasitas_unit: document.getElementById('peKapasitas').value || null,
      kapasitas_unit_uom: document.getElementById('peKapasitasUom').value.trim() || null,
      status_alat: document.getElementById('peStatus').value,
      lokasi: document.getElementById('peLokasi').value,
      keterangan: document.getElementById('peKeterangan').value
    };

    try {
      const res = await fetch(getProdApiUrl('/api/admin/production/equipment'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify(bodyData)
      });
      if (res.ok) {
        tutupModalGenerik();
        muatProdListEquipment();
      } else {
        const errData = await res.json().catch(() => ({}));
        alert('Gagal menyimpan unit: ' + (errData.error || 'Terjadi kesalahan pada server'));
      }
    } catch (err) {
      alert('Gagal menyimpan unit: ' + err.message);
    }
  });
}

async function hapusEquipmentParameter(id) {
  if (!confirm('Apakah Anda yakin ingin menghapus unit ini dari master parameter?')) return;
  try {
    const res = await fetch(getProdApiUrl(`/api/admin/production/equipment/${id}`), {
      method: 'DELETE',
      headers: { ...getProdAuthHeaders() }
    });
    if (res.ok) {
      muatProdParameter();
    }
  } catch (err) {
    alert('Gagal menghapus unit: ' + err.message);
  }
}

function bukaModalTambahStandbyCode() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;

  konten.innerHTML = `
    <h3 style="margin-top:0;color:#0f172a;">⏱️ Tambah Parameter Kode Standby</h3>
    <form id="formInputParamStb">
      <div style="margin-bottom:10px;">
        <label class="label">Kode Standby (e.g. STB-08)</label>
        <input type="text" id="psKode" class="input-filter" placeholder="STB-08" required />
      </div>
      <div style="margin-bottom:10px;">
        <label class="label">Kategori Standby</label>
        <input type="text" id="psKategori" class="input-filter" placeholder="Contoh: Blasting / Peledakan Front" required />
      </div>
      <div style="margin-bottom:14px;">
        <label class="label">Deskripsi</label>
        <input type="text" id="psDeskripsi" class="input-filter" placeholder="Penundaan akibat aktivitas blasting" />
      </div>
      <div class="standby-code-modal-governance">
        <label class="label">Planning<select id="psPlanning" class="input-filter"><option value="unplanned">Unplanned</option><option value="planned">Planned</option></select></label>
        <label class="label">Control Class<select id="psControl" class="input-filter"><option value="controllable">Controllable</option><option value="uncontrollable">Uncontrollable</option></select></label>
        <label class="label">Owner Department<input id="psOwner" class="input-filter" value="Production" /></label>
        <label class="label standby-code-check"><input id="psRequireDescription" type="checkbox" /> Keterangan wajib</label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan Kode Standby</button>
      </div>
    </form>
  `;
  overlay.hidden = false;

  document.getElementById('formInputParamStb').addEventListener('submit', async (e) => {
    e.preventDefault();
    const bodyData = {
      kode: document.getElementById('psKode').value,
      kategori: document.getElementById('psKategori').value,
      deskripsi: document.getElementById('psDeskripsi').value,
      planning_type: document.getElementById('psPlanning').value,
      control_class: document.getElementById('psControl').value,
      owner_department: document.getElementById('psOwner').value,
      requires_description: document.getElementById('psRequireDescription').checked
    };

    try {
      const res = await fetch(getProdApiUrl('/api/admin/production/standby-codes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify(bodyData)
      });
      if (res.ok) {
        tutupModalGenerik();
        muatProdParameter();
      }
    } catch (err) {
      alert('Gagal menyimpan kode standby: ' + err.message);
    }
  });
}

function bukaModalTambahBreakdownCode() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;

  konten.innerHTML = `
    <h3 style="margin-top:0;color:#0f172a;">🛠️ Tambah Parameter Kode Breakdown</h3>
    <form id="formInputParamBd">
      <div style="margin-bottom:10px;">
        <label class="label">Kode Breakdown (e.g. BD-09)</label>
        <input type="text" id="pbKode" class="input-filter" placeholder="BD-09" required />
      </div>
      <div style="margin-bottom:10px;">
        <label class="label">Kategori Component Breakdown</label>
        <input type="text" id="pbKategori" class="input-filter" placeholder="Contoh: Air Conditioning / AC Cab" required />
      </div>
      <div style="margin-bottom:14px;">
        <label class="label">Deskripsi Kerusakan</label>
        <input type="text" id="pbDeskripsi" class="input-filter" placeholder="Kerusakan kompresor AC kabin operator" />
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan Kode Breakdown</button>
      </div>
    </form>
  `;
  overlay.hidden = false;

  document.getElementById('formInputParamBd').addEventListener('submit', async (e) => {
    e.preventDefault();
    const bodyData = {
      kode: document.getElementById('pbKode').value,
      kategori: document.getElementById('pbKategori').value,
      deskripsi: document.getElementById('pbDeskripsi').value
    };

    try {
      const res = await fetch(getProdApiUrl('/api/admin/production/breakdown-codes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify(bodyData)
      });
      if (res.ok) {
        tutupModalGenerik();
        muatProdParameter();
      }
    } catch (err) {
      alert('Gagal menyimpan kode breakdown: ' + err.message);
    }
  });
}

// Terapkan Template Master Parameter Standard 1-Klik
async function terapkanTemplateParameterStandard() {
  if (!confirm('Apakah Anda ingin menerapkan Template Master Parameter Standard Tambang? (Mengisi unit alat berat & kode delay standar)')) return;

  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/apply-template'), {
      method: 'POST',
      headers: { ...getProdAuthHeaders() }
    });
    if (res.ok) {
      alert('✅ Template Master Parameter dari PARAMETER.xlsx berhasil diterapkan!');
      muatProdParameter();
    }
  } catch (err) {
    alert('Gagal menerapkan template: ' + err.message);
  }
}

// -------------------------------------------------------------
// 1. INPUT DATA (EQUIPMENT WORK LOG)
// -------------------------------------------------------------
let cachedInputLogs = [];
let cachedInputLogPeriods = [];
let inputDataPeriodInitialized = false;
let cachedStandbyLogs = [];
let standbyPeriodInitialized = false;
let standbyDrafts = new Map();
let standbyInlineBound = false;
let inputDataBulkDeleteMode = false;
const inputDataDeleteSelection = new Set();
const inputDataUndoStack = [];
const inputDataRedoStack = [];
const inputDataEditHistoryStart = new WeakMap();
let inputDataHistoryApplying = false;
let cachedInputOperators = [];
let cachedInputOperatorsSource = 'none';
let currentSortInputKey = null;
let currentSortInputAsc = true;
let inputDataDraftRecoveryPrompted = false;
let inputDataNavigationBypass = false;
let inputDataBeforeUnloadBypass = false;

function getInputDataDraftStorageKey() {
  const account = localStorage.getItem('admin_email') || localStorage.getItem('user_email') || 'default';
  return `omos:production-input-drafts:${account}`;
}

function readInputDataDrafts() {
  try {
    const parsed = JSON.parse(localStorage.getItem(getInputDataDraftStorageKey()) || '{}');
    return new Map(Object.entries(parsed && typeof parsed === 'object' ? parsed : {}));
  } catch (error) {
    console.warn('[Input Data] Draft lokal tidak dapat dibaca.', error);
    return new Map();
  }
}

let inputDataDrafts = readInputDataDrafts();

function persistInputDataDrafts() {
  try {
    localStorage.setItem(getInputDataDraftStorageKey(), JSON.stringify(Object.fromEntries(inputDataDrafts)));
  } catch (error) {
    console.warn('[Input Data] Draft lokal tidak dapat disimpan.', error);
  }
  updateInputDataSaveIndicator();
}

function updateInputDataSaveIndicator(message = '') {
  const button = document.getElementById('btnSimpanPerubahanInputData');
  const status = document.getElementById('statusSimpanInputData');
  const count = inputDataDrafts.size;
  if (button) {
    button.disabled = count === 0;
    button.textContent = count ? `Simpan Perubahan (${count})` : 'Simpan Perubahan';
  }
  if (status) {
    status.textContent = message || (count ? `${count} baris belum disimpan` : 'Tersimpan');
    status.style.color = count ? '#b45309' : '#15803d';
  }
}

function captureInputLogRowDraft(row) {
  const fields = {};
  row.querySelectorAll('[data-input-log-field]').forEach(field => {
    fields[field.dataset.inputLogField] = field.value;
  });
  return { fields, updatedAt: new Date().toISOString() };
}

function updateInputDataHistoryButtons() {
  const undoButton = document.getElementById('btnUndoInputData');
  const redoButton = document.getElementById('btnRedoInputData');
  if (undoButton) {
    undoButton.disabled = inputDataUndoStack.length === 0;
    undoButton.title = inputDataUndoStack.length ? `Undo: ${inputDataUndoStack.at(-1).label || 'aksi terakhir'}` : 'Tidak ada aksi untuk di-undo';
  }
  if (redoButton) {
    redoButton.disabled = inputDataRedoStack.length === 0;
    redoButton.title = inputDataRedoStack.length ? `Redo: ${inputDataRedoStack.at(-1).label || 'aksi terakhir'}` : 'Tidak ada aksi untuk di-redo';
  }
}

function pushInputDataHistory(action) {
  if (inputDataHistoryApplying || !action) return;
  inputDataUndoStack.push(action);
  if (inputDataUndoStack.length > 100) inputDataUndoStack.shift();
  inputDataRedoStack.length = 0;
  updateInputDataHistoryButtons();
}

function inputDataDraftsEqual(left, right) {
  return JSON.stringify(left?.fields || {}) === JSON.stringify(right?.fields || {});
}

function applyInputDataEditSnapshot(logId, snapshot) {
  inputDataDrafts.set(String(logId), { fields: { ...(snapshot?.fields || {}) }, updatedAt: new Date().toISOString() });
  persistInputDataDrafts();
  terapkanSlicerInputData();
  const row = document.querySelector(`[data-input-log-row][data-log-id="${CSS.escape(String(logId))}"]`);
  if (row) row.dataset.saveState = 'dirty';
}

async function mutateInputDataLogsForHistory(ids, restore) {
  const response = await fetch(getProdApiUrl(restore ? '/api/admin/production/logs/batch/restore' : '/api/admin/production/logs/batch'), {
    method: restore ? 'PATCH' : 'DELETE',
    headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
    body: JSON.stringify({ ids }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  await muatProdInputData();
  return result;
}

async function applyInputDataHistoryAction(action, direction) {
  if (action.type === 'edit') {
    applyInputDataEditSnapshot(action.logId, direction === 'undo' ? action.before : action.after);
    return;
  }
  const undo = direction === 'undo';
  const shouldRestore = action.type === 'delete' ? undo : !undo;
  await mutateInputDataLogsForHistory(action.ids, shouldRestore);
  if (action.type === 'delete') {
    if (shouldRestore && action.drafts) {
      Object.entries(action.drafts).forEach(([id, draft]) => inputDataDrafts.set(id, draft));
    } else {
      action.ids.forEach(id => inputDataDrafts.delete(String(id)));
    }
    persistInputDataDrafts();
    terapkanSlicerInputData();
  } else if (action.type === 'create') {
    if (!shouldRestore) {
      action.drafts = Object.fromEntries(action.ids.filter(id => inputDataDrafts.has(String(id))).map(id => [String(id), inputDataDrafts.get(String(id))]));
      action.ids.forEach(id => inputDataDrafts.delete(String(id)));
    } else if (action.drafts) {
      Object.entries(action.drafts).forEach(([id, draft]) => inputDataDrafts.set(id, draft));
    }
    persistInputDataDrafts();
    terapkanSlicerInputData();
  }
}

async function undoInputDataAction() {
  if (!inputDataUndoStack.length || inputDataHistoryApplying) return;
  const action = inputDataUndoStack.pop();
  inputDataHistoryApplying = true;
  updateInputDataHistoryButtons();
  try {
    await applyInputDataHistoryAction(action, 'undo');
    inputDataRedoStack.push(action);
  } catch (error) {
    inputDataUndoStack.push(action);
    alert(`Undo gagal: ${error.message}`);
  } finally {
    inputDataHistoryApplying = false;
    updateInputDataHistoryButtons();
  }
}

async function redoInputDataAction() {
  if (!inputDataRedoStack.length || inputDataHistoryApplying) return;
  const action = inputDataRedoStack.pop();
  inputDataHistoryApplying = true;
  updateInputDataHistoryButtons();
  try {
    await applyInputDataHistoryAction(action, 'redo');
    inputDataUndoStack.push(action);
  } catch (error) {
    inputDataRedoStack.push(action);
    alert(`Redo gagal: ${error.message}`);
  } finally {
    inputDataHistoryApplying = false;
    updateInputDataHistoryButtons();
  }
}

function markInputLogRowDirty(row) {
  if (!row?.dataset.logId) return;
  row.dataset.saveState = 'dirty';
  inputDataDrafts.set(String(row.dataset.logId), captureInputLogRowDraft(row));
  persistInputDataDrafts();
}

function clearInputDataDrafts() {
  inputDataDrafts.clear();
  try { localStorage.removeItem(getInputDataDraftStorageKey()); } catch (error) { /* storage opsional */ }
  document.querySelectorAll('[data-input-log-row]').forEach(row => delete row.dataset.saveState);
  clearInputDataValidationGuide();
  updateInputDataSaveIndicator();
}

function showInputDataUnsavedDialog(contextLabel = 'beralih dari halaman ini') {
  return new Promise(resolve => {
    document.getElementById('inputDataUnsavedOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'inputDataUnsavedOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="inputDataUnsavedTitle" style="width:min(440px,100%);background:#fff;border-radius:14px;padding:22px;box-shadow:0 24px 65px rgba(15,23,42,.3);border:1px solid #cbd5e1;">
      <div id="inputDataUnsavedTitle" style="font-size:18px;font-weight:800;color:#0f172a;">Perubahan belum disimpan</div>
      <p style="margin:8px 0 18px;color:#475569;font-size:13px;line-height:1.5;">Terdapat ${inputDataDrafts.size} baris yang berubah sebelum ${escapeMinePlanning(contextLabel)}. Simpan data sekarang?</p>
      <div style="display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap;">
        <button type="button" data-unsaved-action="discard" class="tombol">Abaikan</button>
        <button type="button" data-unsaved-action="save" class="tombol tombol--utama">Ya, Simpan Data</button>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-unsaved-action]').forEach(button => {
      button.addEventListener('click', () => {
        const action = button.dataset.unsavedAction;
        overlay.remove();
        resolve(action);
      }, { once: true });
    });
  });
}

async function resolveInputDataUnsavedDecision(contextLabel) {
  const action = await showInputDataUnsavedDialog(contextLabel);
  if (action === 'save') return simpanSemuaPerubahanInputData();
  clearInputDataDrafts();
  return true;
}

async function requestInputDataNavigation(callback, contextLabel = 'beralih ke tab lain') {
  if (!inputDataDrafts.size) {
    callback();
    return;
  }
  const canContinue = await resolveInputDataUnsavedDecision(contextLabel);
  if (!canContinue) return;
  inputDataNavigationBypass = true;
  try {
    callback();
  } finally {
    inputDataNavigationBypass = false;
  }
}

function setupInputDataUnsavedGuards() {
  if (document.documentElement.dataset.inputDataUnsavedGuards) return;
  document.documentElement.dataset.inputDataUnsavedGuards = 'true';

  document.addEventListener('click', event => {
    const targetTab = event.target.closest('.sidebar__tab[data-tab]');
    const inputDataTab = document.getElementById('tab-prodInputData');
    if (!targetTab || inputDataNavigationBypass || !inputDataTab || inputDataTab.hidden || !inputDataDrafts.size || targetTab.dataset.tab === 'prodInputData') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    requestInputDataNavigation(() => targetTab.click());
  }, true);

  window.addEventListener('beforeunload', event => {
    if (inputDataBeforeUnloadBypass || !inputDataDrafts.size) return;
    event.preventDefault();
    event.returnValue = '';
  });

  document.addEventListener('keydown', event => {
    const refreshKey = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'r');
    if (!refreshKey || !inputDataDrafts.size) return;
    event.preventDefault();
    requestInputDataNavigation(() => {
      inputDataBeforeUnloadBypass = true;
      window.location.reload();
    }, 'memuat ulang halaman');
  }, true);
}

async function promptInputDataDraftRecovery() {
  if (inputDataDraftRecoveryPrompted || !inputDataDrafts.size) return;
  inputDataDraftRecoveryPrompted = true;
  const action = await showInputDataUnsavedDialog('melanjutkan setelah refresh');
  if (action === 'save') {
    await simpanSemuaPerubahanInputData();
  } else {
    clearInputDataDrafts();
    terapkanSlicerInputData();
  }
}

function isInputOperatorEmployee(employee) {
  const position = String(employee?.jabatan || '').trim().toLocaleLowerCase('id-ID');
  return employee?.is_active !== false && (position.includes('operator') || position === 'driver dt');
}

function syncInputOperatorsFromKaryawan(employees) {
  cachedInputOperators = (Array.isArray(employees) ? employees : [])
    .filter(isInputOperatorEmployee)
    .sort((a, b) => String(a.nama || '').localeCompare(String(b.nama || ''), 'id-ID', { sensitivity: 'base' }));
  cachedInputOperatorsSource = 'karyawan';
  const inputTab = document.getElementById('tab-prodInputData');
  if (inputTab && !inputTab.hidden && cachedInputLogs.length) terapkanSlicerInputData();
  return cachedInputOperators;
}

async function loadInputOperators(options = {}) {
  const force = Boolean(options.force);
  if (!force && typeof dataKaryawanCache !== 'undefined' && Array.isArray(dataKaryawanCache) && dataKaryawanCache.length) {
    return syncInputOperatorsFromKaryawan(dataKaryawanCache);
  }
  if (!force && cachedInputOperatorsSource === 'karyawan') return cachedInputOperators;

  const masterOperators = Array.isArray(masterProdData.operators) ? masterProdData.operators : [];
  if (!force && masterOperators.length) return syncInputOperatorsFromKaryawan(masterOperators);

  const response = await fetch(getProdApiUrl('/api/admin/karyawan'), { headers: { ...getProdAuthHeaders() } });
  if (!response.ok) throw new Error(`Karyawan HTTP ${response.status}`);
  return syncInputOperatorsFromKaryawan(await response.json());
}

function formatHmInputValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}

function formatInputShiftLabel(value) {
  const label = String(value || '').trim();
  const normalized = label.toLocaleLowerCase('id-ID');
  if (normalized.includes('siang')) return 'Siang';
  if (normalized.includes('malam')) return 'Malam';
  return label || '—';
}

function getInputLogShiftChoices() {
  const source = Array.isArray(masterProdData.shifts) ? masterProdData.shifts : [];
  const categories = [
    { label: 'Siang', pattern: /siang/i },
    { label: 'Malam', pattern: /malam/i },
  ];
  return categories.map(category => {
    const exact = source.find(shift => String(shift.nama_shift || '').trim().toLocaleLowerCase('id-ID') === category.label.toLocaleLowerCase('id-ID'));
    const matched = exact || source.find(shift => category.pattern.test(String(shift.nama_shift || '')));
    return matched ? { ...matched, nama_shift: category.label, category: category.label } : null;
  }).filter(Boolean);
}

function getInputLogShiftCategory(shiftId) {
  const selected = (masterProdData.shifts || []).find(shift => String(shift.id) === String(shiftId || ''));
  return formatInputShiftLabel(selected?.nama_shift || '');
}

async function muatProdInputData() {
  const tbody = document.getElementById('tbodyProdInputData');
  if (!tbody) return;
  clearInputDataValidationGuide();
  tbody.innerHTML = '<tr><td colspan="11" class="tabel__kosong">Memuat log produksi...</td></tr>';

  try {
    const periodYearSelect = document.getElementById('slicerInputTahun');
    const periodMonthSelect = document.getElementById('slicerInputBulan');
    if (!inputDataPeriodInitialized) {
      const today = new Date();
      if (periodYearSelect) periodYearSelect.value = String(today.getFullYear());
      if (periodMonthSelect) periodMonthSelect.value = String(today.getMonth() + 1).padStart(2, '0');
      inputDataPeriodInitialized = true;
      try {
        const periodResponse = await fetch(getProdApiUrl('/api/admin/production/log-periods'), {
          headers: { ...getProdAuthHeaders() }
        });
        if (periodResponse.ok) {
          const periods = await periodResponse.json();
          cachedInputLogPeriods = Array.isArray(periods) ? periods : [];
        }
      } catch (periodError) {
        console.warn('[Input Data] Indeks periode tidak dapat dimuat.', periodError);
      }
    }

    if (!(masterProdData.equipment || []).length || !(masterProdData.operators || []).length) {
      await muatMasterDataProduksi();
    }

    let operatorLoadError = null;
    try {
      await loadInputOperators({ force: true });
    } catch (error) {
      operatorLoadError = error;
      console.warn('[Input Data] Dropdown operator gagal dimuat; tabel utama tetap dilanjutkan.', error);
    }

    const periodParams = new URLSearchParams();
    const selectedYear = periodYearSelect?.value || '';
    const selectedMonth = periodMonthSelect?.value || '';
    if (selectedYear) periodParams.set('year', selectedYear);
    if (selectedYear && selectedMonth) periodParams.set('month', selectedMonth);
    const periodQuery = periodParams.toString();
    const res = await fetch(getProdApiUrl(`/api/admin/production/logs${periodQuery ? `?${periodQuery}` : ''}`), {
      headers: { ...getProdAuthHeaders() }
    });
    if (!res.ok) throw new Error(`Work Log HTTP ${res.status}`);
    const logs = await res.json();
    cachedInputLogs = Array.isArray(logs) ? logs : [];

    isiDropdownSlicerInputData();
    terapkanSlicerInputData();
    bindInputDataInlineEditing();
    updateInputDataSaveIndicator();
    updateInputDataHistoryButtons();
    if (inputDataDrafts.size && !inputDataDraftRecoveryPrompted) {
      setTimeout(() => promptInputDataDraftRecovery(), 0);
    }
    if (operatorLoadError) {
      console.warn('[Input Data] Menggunakan operator yang tersedia dari Work Log.', operatorLoadError.message);
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="11" class="teks-error">Gagal memuat data: ${err.message}</td></tr>`;
  }
}

function isiDropdownSlicerInputData() {
  const logs = cachedInputLogs;

  // Slicer Utama Tahun
  const selTahun = document.getElementById('slicerInputTahun');
  if (selTahun) {
    const curVal = selTahun.value;
    const currentYear = String(new Date().getFullYear());
    const years = Array.from(new Set([
      currentYear,
      ...cachedInputLogPeriods.map(period => String(period.year || '')).filter(Boolean),
      ...logs.map(log => log.tanggal ? String(log.tanggal).split('-')[0] : '').filter(Boolean),
    ])).sort((a, b) => Number(b) - Number(a));
    if (years.length > 0) {
      selTahun.innerHTML = '<option value="">Semua Tahun</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
      if (curVal && years.includes(curVal)) {
        selTahun.value = curVal;
      } else if (!curVal && years.includes(currentYear)) {
        selTahun.value = currentYear;
      }
    }
  }

  // Slicer Kode Unit
  const selKode = document.getElementById('slicerInputKode');
  if (selKode) {
    const curVal = selKode.value;
    const list = Array.from(new Set(logs.map(l => l.kode_alat).filter(Boolean))).sort();
    selKode.innerHTML = '<option value="">Semua Kode Unit</option>' + list.map(k => `<option value="${k}">${k}</option>`).join('');
    if (curVal && list.includes(curVal)) selKode.value = curVal;
  }

  // Slicer Shift
  const selShift = document.getElementById('slicerInputShift');
  if (selShift) {
    const curVal = selShift.value;
    const list = Array.from(new Set(logs.map(l => l.nama_shift).filter(Boolean))).sort();
    selShift.innerHTML = '<option value="">Semua Shift</option>' + list.map(s => `<option value="${s}">${s}</option>`).join('');
    if (curVal && list.includes(curVal)) selShift.value = curVal;
  }

  // Slicer Operator
  const selOperator = document.getElementById('slicerInputOperator');
  if (selOperator) {
    const curVal = selOperator.value;
    const list = Array.from(new Set(logs.map(l => l.nama_operator).filter(Boolean))).sort();
    selOperator.innerHTML = '<option value="">Semua Operator</option>' + list.map(o => `<option value="${o}">${o}</option>`).join('');
    if (curVal && list.includes(curVal)) selOperator.value = curVal;
  }
}

function resetSlicerInputData() {
  const selTahun = document.getElementById('slicerInputTahun');
  const selBulan = document.getElementById('slicerInputBulan');
  const inpTanggal = document.getElementById('slicerInputTanggal');
  const selKode = document.getElementById('slicerInputKode');
  const selShift = document.getElementById('slicerInputShift');
  const selOperator = document.getElementById('slicerInputOperator');

  if (selTahun) selTahun.value = '';
  if (selBulan) selBulan.value = '';
  if (inpTanggal) inpTanggal.value = '';
  if (selKode) selKode.value = '';
  if (selShift) selShift.value = '';
  if (selOperator) selOperator.value = '';

  void muatProdInputData();
}

function syncInputDataBulkDeleteUi() {
  const bar = document.getElementById('inputDataBulkDeleteBar');
  const toggleButton = document.getElementById('btnToggleDeleteWorkLogs');
  document.querySelectorAll('[data-input-delete-column]').forEach(element => {
    element.hidden = !inputDataBulkDeleteMode;
  });
  if (bar) {
    bar.hidden = !inputDataBulkDeleteMode;
    bar.style.display = inputDataBulkDeleteMode ? 'flex' : 'none';
  }
  if (toggleButton) toggleButton.textContent = inputDataBulkDeleteMode ? 'Tutup Mode Hapus' : 'Hapus Work Log';
  const count = inputDataDeleteSelection.size;
  const countLabel = document.getElementById('inputDataDeleteSelectedCount');
  const deleteButton = document.getElementById('btnDeleteSelectedWorkLogs');
  if (countLabel) countLabel.textContent = `${count} Work Log dipilih`;
  if (deleteButton) deleteButton.disabled = count === 0;

  const visibleCheckboxes = [...document.querySelectorAll('[data-input-log-select]')].filter(input => !input.closest('tr')?.hidden);
  visibleCheckboxes.forEach(input => { input.checked = inputDataDeleteSelection.has(String(input.value)); });
  const selectAll = document.getElementById('inputDataSelectAll');
  if (selectAll) {
    const checkedCount = visibleCheckboxes.filter(input => input.checked).length;
    selectAll.checked = visibleCheckboxes.length > 0 && checkedCount === visibleCheckboxes.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < visibleCheckboxes.length;
  }
}

function toggleInputDataBulkDeleteMode() {
  inputDataBulkDeleteMode = !inputDataBulkDeleteMode;
  if (!inputDataBulkDeleteMode) inputDataDeleteSelection.clear();
  syncInputDataBulkDeleteUi();
}

function cancelInputDataBulkDelete() {
  inputDataBulkDeleteMode = false;
  inputDataDeleteSelection.clear();
  syncInputDataBulkDeleteUi();
}

function toggleInputDataDeleteSelection(logId, checked) {
  const id = String(logId || '');
  if (!id) return;
  if (checked) inputDataDeleteSelection.add(id);
  else inputDataDeleteSelection.delete(id);
  syncInputDataBulkDeleteUi();
}

function toggleSelectAllInputData(checked) {
  document.querySelectorAll('[data-input-log-select]').forEach(input => {
    const id = String(input.value || '');
    if (!id) return;
    if (checked) inputDataDeleteSelection.add(id);
    else inputDataDeleteSelection.delete(id);
  });
  syncInputDataBulkDeleteUi();
}

async function deleteSelectedInputDataLogs() {
  const ids = [...inputDataDeleteSelection];
  if (!ids.length) return alert('Pilih minimal satu Work Log.');
  if (!confirm(`Hapus ${ids.length} Work Log terpilih? Data akan dikeluarkan dari tabel.`)) return;
  const deletedDrafts = Object.fromEntries(ids.filter(id => inputDataDrafts.has(String(id))).map(id => [String(id), inputDataDrafts.get(String(id))]));
  const deleteButton = document.getElementById('btnDeleteSelectedWorkLogs');
  if (deleteButton) {
    deleteButton.disabled = true;
    deleteButton.textContent = 'Menghapus...';
  }
  try {
    const response = await fetch(getProdApiUrl('/api/admin/production/logs/batch'), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
      body: JSON.stringify({ ids }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    ids.forEach(id => inputDataDrafts.delete(String(id)));
    persistInputDataDrafts();
    clearInputDataValidationGuide();
    inputDataDeleteSelection.clear();
    inputDataBulkDeleteMode = false;
    await muatProdInputData();
    pushInputDataHistory({ type: 'delete', ids: [...(result.ids || ids)].map(String), drafts: deletedDrafts, label: `Hapus ${result.deleted || ids.length} Work Log` });
    alert(`${result.deleted || 0} Work Log berhasil dihapus.`);
  } catch (error) {
    alert(`Gagal menghapus Work Log: ${error.message}`);
    if (deleteButton) {
      deleteButton.disabled = false;
      deleteButton.textContent = 'Hapus Terpilih';
    }
  }
}

function inputLogOption(value, label, selectedValue) {
  const selected = String(value ?? '') === String(selectedValue ?? '') ? ' selected' : '';
  return `<option value="${escapeMinePlanning(value)}"${selected}>${escapeMinePlanning(label)}</option>`;
}

function inputLogShiftOptions(selectedValue) {
  const selectedCategory = getInputLogShiftCategory(selectedValue);
  return getInputLogShiftChoices()
    .map(shift => inputLogOption(shift.id, shift.nama_shift, shift.category === selectedCategory ? shift.id : selectedValue))
    .join('');
}

function inputLogClassOptions(selectedValue) {
  const classes = [...new Set((masterProdData.equipment || []).map(unit => String(unit.class_unit || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id-ID', { numeric: true, sensitivity: 'base' }));
  return inputLogOption('', 'Semua Class', selectedValue) + classes.map(value => inputLogOption(value, value, selectedValue)).join('');
}

function findInputLogEquipment(equipmentId) {
  return (masterProdData.equipment || []).find(unit => String(unit.id) === String(equipmentId || '')) || null;
}

function resolveInputLogEquipmentClass(equipmentId, fallbackClass = '') {
  const unit = findInputLogEquipment(equipmentId);
  return String(unit?.class_unit || fallbackClass || '').trim();
}

function inputLogEquipmentOptions(selectedValue, classFilter = '') {
  const units = (masterProdData.equipment || [])
    .filter(unit => unit.id && unit.kode_alat && (!classFilter || String(unit.class_unit || '') === classFilter))
    .sort((a, b) => String(a.kode_alat).localeCompare(String(b.kode_alat), 'id-ID', { numeric: true, sensitivity: 'base' }));
  return inputLogOption('', 'Pilih Kode Unit', selectedValue) + units.map(unit => inputLogOption(unit.id, unit.kode_alat, selectedValue)).join('');
}

function inputLogOperatorOptions(selectedValue) {
  return inputLogOption('', 'Pilih Operator / Driver DT', selectedValue)
    + cachedInputOperators.map(employee => inputLogOption(employee.id, `${employee.nama} — ${employee.jabatan || 'Operator'}`, selectedValue)).join('');
}

function inputLogAreaOptions(selectedValue) {
  const areas = [...new Set((masterProdData.equipment || []).map(unit => String(unit.lokasi || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id-ID', { sensitivity: 'base' }));
  return inputLogOption('', 'Pilih PIT / Area', selectedValue) + areas.map(value => inputLogOption(value, value, selectedValue)).join('');
}

function findInputLogJob(jobCode) {
  const normalized = String(jobCode || '').trim().toLocaleUpperCase('id-ID');
  return (masterProdData.jobCodes || []).find(job => String(job.job_code || '').trim().toLocaleUpperCase('id-ID') === normalized) || null;
}

function inputLogJobOptions(selectedValue) {
  const jobs = [...(masterProdData.jobCodes || [])]
    .filter(job => job.job_code)
    .sort((a, b) => String(a.job_code).localeCompare(String(b.job_code), 'id-ID', { numeric: true, sensitivity: 'base' }));
  const selectedJob = findInputLogJob(selectedValue);
  const legacyOption = selectedValue && !selectedJob
    ? inputLogOption(selectedValue, `${selectedValue} — Data lama`, selectedValue)
    : '';
  return inputLogOption('', 'Pilih JOB', selectedValue)
    + legacyOption
    + jobs.map(job => inputLogOption(job.job_code, `${job.job_code} — ${job.job_desc || ''}`, selectedValue)).join('');
}

function terapkanSlicerInputData() {
  const tbody = document.getElementById('tbodyProdInputData');
  const counterBadge = document.getElementById('counterSlicerInputData');
  if (!tbody) return;

  const tahunVal = document.getElementById('slicerInputTahun')?.value || '';
  const bulanVal = document.getElementById('slicerInputBulan')?.value || '';
  const tglVal = document.getElementById('slicerInputTanggal')?.value || '';
  const kodeVal = document.getElementById('slicerInputKode')?.value || '';
  const shiftVal = document.getElementById('slicerInputShift')?.value || '';
  const opVal = document.getElementById('slicerInputOperator')?.value || '';

  if (typeof simpanSesiUserOMOS === 'function') {
    simpanSesiUserOMOS({
      slicers: {
        slicerInputTahun: tahunVal,
        slicerInputBulan: bulanVal,
        slicerInputTanggal: tglVal,
        slicerInputKode: kodeVal,
        slicerInputShift: shiftVal,
        slicerInputOperator: opVal
      }
    });
  }

  let logs = [...cachedInputLogs];

  if (tahunVal) {
    logs = logs.filter(l => l.tanggal && l.tanggal.startsWith(tahunVal));
  }
  if (bulanVal) {
    logs = logs.filter(l => {
      if (!l.tanggal) return false;
      const parts = l.tanggal.split('T')[0].split('-');
      return parts.length >= 2 && parts[1] === bulanVal;
    });
  }
  if (tglVal) {
    logs = logs.filter(l => l.tanggal && l.tanggal.startsWith(tglVal));
  }
  if (kodeVal) {
    logs = logs.filter(l => l.kode_alat === kodeVal);
  }
  if (shiftVal) {
    logs = logs.filter(l => l.nama_shift === shiftVal);
  }
  if (opVal) {
    logs = logs.filter(l => l.nama_operator === opVal);
  }

  if (counterBadge) {
    counterBadge.textContent = `Total Work Log: ${logs.length}`;
  }

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="tabel__kosong">Tidak ada data work log yang sesuai filter.</td></tr>';
    syncInputDataBulkDeleteUi();
    return;
  }

  tbody.innerHTML = logs.map(row => {
    const resolvedClass = resolveInputLogEquipmentClass(row.equipment_id, row.class_unit);
    return `
    <tr data-input-log-row data-log-id="${escapeMinePlanning(row.id)}"${row.hm_validated_at ? ` data-hm-anomaly="${escapeMinePlanning(row.hm_anomaly_status || 'normal')}"` : ''}>
      <td data-input-delete-column${inputDataBulkDeleteMode ? '' : ' hidden'} style="text-align:center;"><input type="checkbox" data-input-log-select value="${escapeMinePlanning(row.id)}" onchange="toggleInputDataDeleteSelection('${escapeMinePlanning(row.id)}',this.checked)" style="width:17px;height:17px;accent-color:#dc2626;"${inputDataDeleteSelection.has(String(row.id)) ? ' checked' : ''}></td>
      <td><input type="date" data-input-log-field="tanggal" value="${escapeMinePlanning(String(row.tanggal || '').split('T')[0])}" required /></td>
      <td><select data-input-log-field="shift_id" required>${inputLogShiftOptions(row.shift_id)}</select></td>
      <td><select data-input-log-field="equipment_id" required>${inputLogEquipmentOptions(row.equipment_id, resolvedClass)}</select></td>
      <td><select data-input-log-field="class_filter">${inputLogClassOptions(resolvedClass)}</select></td>
      <td><select data-input-log-field="operator_id" required>${inputLogOperatorOptions(row.operator_id)}</select></td>
      <td><select data-input-log-field="area_name" required>${inputLogAreaOptions(row.area_name || row.nama_pit)}</select></td>
      <td class="prod-input-number"><input type="number" step="0.01" min="0" data-input-log-field="hm_start" value="${escapeMinePlanning(row.hm_start ?? '')}" required /></td>
      <td class="prod-input-number"><input type="number" step="0.01" min="0" data-input-log-field="hm_finish" value="${escapeMinePlanning(row.hm_finish ?? '')}" required /></td>
      <td class="prod-input-number"><input type="number" step="0.01" data-input-log-field="total_hm" value="${escapeMinePlanning(row.total_hm ?? '')}" readonly aria-readonly="true" />${inputHmStatusMarkup(row)}</td>
      <td><select data-input-log-field="job" required>${inputLogJobOptions(row.job || '')}</select></td>
      <td><input type="text" data-input-log-field="job_description" value="${escapeMinePlanning(row.job_description || '')}" placeholder="Job Description" required /></td>
    </tr>
  `;
  }).join('');
  syncInputDataBulkDeleteUi();
  applyInputDataDraftsToRenderedRows();
  updateInputDataSaveIndicator();
}

function applyInputDataDraftsToRenderedRows() {
  document.querySelectorAll('[data-input-log-row]').forEach(row => {
    const draft = inputDataDrafts.get(String(row.dataset.logId));
    if (!draft?.fields) return;
    const fields = draft.fields;
    const classSelect = row.querySelector('[data-input-log-field="class_filter"]');
    const equipmentSelect = row.querySelector('[data-input-log-field="equipment_id"]');
    if (classSelect) classSelect.value = fields.class_filter || '';
    if (equipmentSelect) equipmentSelect.innerHTML = inputLogEquipmentOptions(fields.equipment_id || '', fields.class_filter || '');
    Object.entries(fields).forEach(([fieldName, value]) => {
      const field = row.querySelector(`[data-input-log-field="${fieldName}"]`);
      if (field) field.value = value ?? '';
    });
    updateInlineHmTotal(row);
    row.dataset.saveState = 'dirty';
  });
}

function updateInlineHmTotal(row) {
  const startInput = row.querySelector('[data-input-log-field="hm_start"]');
  const finishInput = row.querySelector('[data-input-log-field="hm_finish"]');
  const totalInput = row.querySelector('[data-input-log-field="total_hm"]');
  finishInput.setCustomValidity('');
  if (startInput.value === '' || finishInput.value === '') {
    totalInput.value = '';
    return false;
  }
  const start = Number(startInput.value);
  const finish = Number(finishInput.value);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) {
    finishInput.setCustomValidity('HM Akhir tidak boleh lebih kecil dari HM Start.');
    totalInput.value = '';
    finishInput.reportValidity();
    return false;
  }
  totalInput.value = (finish - start).toFixed(2);
  return true;
}

function buildInputLogDraftPayload(draft) {
  const fields = draft?.fields || {};
  const required = ['tanggal', 'shift_id', 'equipment_id', 'operator_id', 'area_name', 'job', 'job_description'];
  const missing = required.filter(field => !String(fields[field] || '').trim());
  if (missing.length) {
    const error = new Error('Masih ada kolom wajib yang belum diisi.');
    error.inputFields = missing;
    throw error;
  }
  const hmStart = Number(fields.hm_start);
  const hmFinish = Number(fields.hm_finish);
  if (!Number.isFinite(hmStart) || !Number.isFinite(hmFinish) || hmStart < 0 || hmFinish < hmStart) {
    const error = new Error('HM Akhir harus sama atau lebih besar dari HM Start.');
    error.inputFields = ['hm_start', 'hm_finish'];
    throw error;
  }
  return {
    tanggal: fields.tanggal,
    shift_id: fields.shift_id,
    equipment_id: fields.equipment_id,
    operator_id: fields.operator_id,
    area_name: String(fields.area_name).trim(),
    job: String(fields.job).trim(),
    job_description: String(fields.job_description).trim(),
    hm_start: hmStart,
    hm_finish: hmFinish,
  };
}

const inputLogFieldLabels = {
  tanggal: 'Hari wajib diisi',
  shift_id: 'Shift wajib dipilih',
  equipment_id: 'Kode Unit wajib dipilih',
  operator_id: 'Operator wajib dipilih',
  area_name: 'PIT / Area wajib dipilih',
  job: 'JOB wajib diisi',
  job_description: 'Job Description wajib diisi',
  hm_start: 'Periksa HM Start',
  hm_finish: 'Periksa HM Akhir',
};

function clearInputDataValidationGuide() {
  const guide = document.getElementById('inputDataValidationGuide');
  if (guide) {
    guide.hidden = true;
    guide.innerHTML = '';
  }
  document.querySelectorAll('[data-input-log-row][data-validation-error="true"]').forEach(row => {
    delete row.dataset.validationError;
  });
  document.querySelectorAll('[data-validation-invalid="true"]').forEach(field => {
    delete field.dataset.validationInvalid;
    field.removeAttribute('aria-invalid');
    field.removeAttribute('title');
    const cell = field.closest('td');
    if (cell) delete cell.dataset.validationLabel;
  });
}

function clearInputLogFieldValidation(field) {
  if (!field?.dataset.validationInvalid) return;
  delete field.dataset.validationInvalid;
  field.removeAttribute('aria-invalid');
  field.removeAttribute('title');
  const cell = field.closest('td');
  if (cell) delete cell.dataset.validationLabel;
  const row = field.closest('[data-input-log-row]');
  if (row && !row.querySelector('[data-validation-invalid="true"]')) delete row.dataset.validationError;
}

function showInputDataValidationGuide(failures) {
  clearInputDataValidationGuide();
  const normalizedFailures = Array.isArray(failures) ? failures : [];
  const hasHiddenFailure = normalizedFailures.some(failure => !document.querySelector(`[data-input-log-row][data-log-id="${CSS.escape(String(failure.logId))}"]`));
  if (hasHiddenFailure) resetSlicerInputData();
  let firstInvalidField = null;
  const missingLabels = new Set();
  normalizedFailures.forEach(failure => {
    const row = document.querySelector(`[data-input-log-row][data-log-id="${CSS.escape(String(failure.logId))}"]`);
    if (!row) return;
    row.dataset.saveState = 'error';
    row.dataset.validationError = 'true';
    (failure.fields || []).forEach(fieldName => {
      const field = row.querySelector(`[data-input-log-field="${CSS.escape(fieldName)}"]`);
      if (!field) return;
      const label = inputLogFieldLabels[fieldName] || 'Data perlu diperiksa';
      field.dataset.validationInvalid = 'true';
      field.setAttribute('aria-invalid', 'true');
      field.title = label;
      const cell = field.closest('td');
      if (cell) cell.dataset.validationLabel = label;
      missingLabels.add(label.replace(/ wajib.*|Periksa /i, ''));
      if (!firstInvalidField) firstInvalidField = field;
    });
  });

  const guide = document.getElementById('inputDataValidationGuide');
  if (guide) {
    const columns = [...missingLabels].filter(Boolean);
    guide.hidden = false;
    guide.innerHTML = `<div><strong>⚠ ${normalizedFailures.length} baris belum lengkap.</strong><div style="margin-top:3px;">Periksa kolom: ${escapeMinePlanning(columns.join(', ') || 'data yang ditandai merah')}.</div></div><button type="button" id="btnGoToFirstInputError" class="tombol tombol--kecil" style="background:#e11d48;color:#fff;border-color:#be123c;white-space:nowrap;">Lihat Kesalahan Pertama</button>`;
    guide.querySelector('#btnGoToFirstInputError')?.addEventListener('click', () => {
      firstInvalidField?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      setTimeout(() => firstInvalidField?.focus({ preventScroll: true }), 350);
    });
  }
  if (firstInvalidField) {
    firstInvalidField.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    setTimeout(() => firstInvalidField.focus({ preventScroll: true }), 450);
  }
}

function hmStatusMeta(status, validated = true) {
  if (!validated) return { label: 'Belum dicek', color: '#475569', background: '#e2e8f0', border: '#cbd5e1' };
  if (status === 'blocked') return { label: 'Tidak valid', color: '#fff', background: '#dc2626', border: '#b91c1c' };
  if (status === 'critical') return { label: 'Anomali', color: '#fff', background: '#e11d48', border: '#be123c' };
  if (status === 'confirmed') return { label: 'Dikonfirmasi', color: '#fff', background: '#7c3aed', border: '#6d28d9' };
  if (status === 'warning') return { label: 'Perlu dicek', color: '#78350f', background: '#fef3c7', border: '#f59e0b' };
  return { label: 'Normal', color: '#166534', background: '#dcfce7', border: '#86efac' };
}

function hmAnalysisMessages(analysis) {
  return [...(analysis?.hardIssues || []), ...(analysis?.criticalIssues || []), ...(analysis?.warnings || [])]
    .map(issue => issue.message).filter(Boolean);
}

function inputHmStatusMarkup(log) {
  const validated = Boolean(log?.hm_validated_at);
  const status = validated ? (log.hm_anomaly_status || 'normal') : 'pending';
  const meta = hmStatusMeta(status, validated);
  const messages = hmAnalysisMessages(log?.hm_anomaly_details || log?.hm_analysis || {});
  return `<span data-hm-status-badge style="display:inline-flex;margin-top:4px;padding:2px 6px;border-radius:999px;border:1px solid ${meta.border};background:${meta.background};color:${meta.color};font-size:9px;font-weight:900;white-space:nowrap;" title="${escapeMinePlanning(messages.join(' | ') || meta.label)}">${meta.label}</span>`;
}

function applyInputHmAnalysis(row, analysis, persistedStatus = '') {
  if (!row) return;
  const status = persistedStatus || analysis?.status || 'normal';
  const meta = hmStatusMeta(status, true);
  const messages = hmAnalysisMessages(analysis);
  let badge = row.querySelector('[data-hm-status-badge]');
  if (!badge) {
    badge = document.createElement('span');
    badge.dataset.hmStatusBadge = '';
    row.querySelector('[data-input-log-field="total_hm"]')?.closest('td')?.appendChild(badge);
  }
  badge.textContent = meta.label;
  badge.title = messages.join(' | ') || meta.label;
  badge.style.cssText = `display:inline-flex;margin-top:4px;padding:2px 6px;border-radius:999px;border:1px solid ${meta.border};background:${meta.background};color:${meta.color};font-size:9px;font-weight:900;white-space:nowrap;`;
  row.dataset.hmAnomaly = status;
}

function showHmAnomalyConfirmation(anomaly) {
  return new Promise(resolve => {
    document.getElementById('hmAnomalyConfirmOverlay')?.remove();
    const messages = hmAnalysisMessages(anomaly);
    const overlay = document.createElement('div');
    overlay.id = 'hmAnomalyConfirmOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100002;background:rgba(15,23,42,.68);display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `<div role="dialog" aria-modal="true" style="width:min(560px,100%);max-height:88vh;overflow:auto;background:#fff;border-radius:14px;padding:22px;border:2px solid #e11d48;box-shadow:0 25px 70px rgba(15,23,42,.38);">
      <div style="display:flex;gap:10px;align-items:flex-start;"><span style="font-size:24px;">⚠</span><div><h3 style="margin:0;color:#9f1239;">Konfirmasi Anomali HM</h3><p style="margin:4px 0 0;color:#64748b;font-size:12px;">Sistem menemukan ketidaksesuaian terhadap histori unit. Periksa data sebelum melanjutkan.</p></div></div>
      <div style="margin:14px 0;padding:10px 12px;background:#fff1f2;border:1px solid #fda4af;border-radius:8px;color:#881337;font-size:12px;line-height:1.5;">${messages.map(message => `<div style="margin:3px 0;">• ${escapeMinePlanning(message)}</div>`).join('')}</div>
      <label class="label">Kategori alasan</label><select id="hmAnomalyReasonCategory" class="input-filter" style="width:100%;margin-bottom:10px;"><option value="">Pilih alasan</option><option>Kesalahan input admin</option><option>Kesalahan catatan operator</option><option>Reset / penggantian HM meter</option><option>Data histori belum lengkap</option><option>Penyesuaian hasil verifikasi lapangan</option><option>Lainnya</option></select>
      <label class="label">Catatan verifikasi</label><textarea id="hmAnomalyReasonNote" class="input-filter" rows="3" placeholder="Jelaskan hasil pengecekan atau alasan data tetap digunakan..." style="width:100%;resize:vertical;"></textarea>
      <div id="hmAnomalyReasonError" style="display:none;margin-top:6px;color:#be123c;font-size:11px;font-weight:800;">Pilih kategori dan isi catatan minimal 5 karakter.</div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:15px;"><button type="button" data-hm-action="cancel" class="tombol">Kembali Periksa Data</button><button type="button" data-hm-action="confirm" class="tombol" style="background:#e11d48;color:#fff;border-color:#be123c;font-weight:800;">Konfirmasi & Simpan</button></div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-hm-action="cancel"]').addEventListener('click', () => { overlay.remove(); resolve(null); });
    overlay.querySelector('[data-hm-action="confirm"]').addEventListener('click', () => {
      const category = overlay.querySelector('#hmAnomalyReasonCategory').value.trim();
      const note = overlay.querySelector('#hmAnomalyReasonNote').value.trim();
      if (!category || note.length < 5) {
        overlay.querySelector('#hmAnomalyReasonError').style.display = 'block';
        return;
      }
      overlay.remove();
      resolve(`${category}: ${note}`);
    });
  });
}

async function sendInputLogWithHmConfirmation(url, method, payload) {
  const send = body => fetch(getProdApiUrl(url), {
    method,
    headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
    body: JSON.stringify(body),
  });
  let response = await send(payload);
  let result = await response.json().catch(() => ({}));
  if (response.status === 409 && result.code === 'HM_CONFIRMATION_REQUIRED') {
    const reason = await showHmAnomalyConfirmation(result.anomaly);
    if (!reason) {
      const error = new Error('Anomali HM belum dikonfirmasi. Periksa kembali HM Start dan HM Akhir.');
      error.inputFields = ['hm_start', 'hm_finish'];
      error.anomaly = result.anomaly;
      throw error;
    }
    response = await send({ ...payload, acknowledge_hm_anomaly: true, hm_anomaly_reason: reason });
    result = await response.json().catch(() => ({}));
  }
  if (!response.ok) {
    const error = new Error(result.error || `HTTP ${response.status}`);
    if (result.code === 'HM_HARD_BLOCK') error.inputFields = ['hm_start', 'hm_finish'];
    error.anomaly = result.anomaly;
    throw error;
  }
  return result;
}

async function checkInputLogHmAnomaly(row) {
  const fieldValue = name => row.querySelector(`[data-input-log-field="${name}"]`)?.value;
  const hmStart = fieldValue('hm_start');
  const hmFinish = fieldValue('hm_finish');
  if (!fieldValue('tanggal') || !fieldValue('shift_id') || !fieldValue('equipment_id') || hmStart === '' || hmFinish === '') return;
  try {
    const response = await fetch(getProdApiUrl('/api/admin/production/logs/hm-check'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
      body: JSON.stringify({ log_id: row.dataset.logId, tanggal: fieldValue('tanggal'), shift_id: fieldValue('shift_id'), equipment_id: fieldValue('equipment_id'), hm_start: hmStart, hm_finish: hmFinish }),
    });
    const analysis = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(analysis.error || `HTTP ${response.status}`);
    applyInputHmAnalysis(row, analysis);
  } catch (error) {
    console.warn('[HM Check]', error.message);
  }
}

async function persistInputLogDraft(logId, draft) {
  const payload = buildInputLogDraftPayload(draft);
  const result = await sendInputLogWithHmConfirmation(`/api/admin/production/logs/${encodeURIComponent(logId)}`, 'PATCH', payload);
  const cached = cachedInputLogs.find(log => String(log.id) === String(logId));
  if (cached) Object.assign(cached, result);
  const renderedRow = document.querySelector(`[data-input-log-row][data-log-id="${CSS.escape(String(logId))}"]`);
  if (renderedRow) {
    renderedRow.dataset.saveState = 'saved';
    const totalInput = renderedRow.querySelector('[data-input-log-field="total_hm"]');
    if (totalInput) totalInput.value = Number(result.total_hm ?? (payload.hm_finish - payload.hm_start)).toFixed(2);
    applyInputHmAnalysis(renderedRow, result.hm_analysis || result.hm_anomaly_details || {}, result.hm_anomaly_status || 'normal');
    setTimeout(() => { if (renderedRow.isConnected) delete renderedRow.dataset.saveState; }, 900);
  }
  return result;
}

async function simpanSemuaPerubahanInputData() {
  document.querySelectorAll('[data-input-log-row][data-save-state="dirty"]').forEach(row => {
    inputDataDrafts.set(String(row.dataset.logId), captureInputLogRowDraft(row));
  });
  if (!inputDataDrafts.size) {
    updateInputDataSaveIndicator();
    return true;
  }

  const saveButton = document.getElementById('btnSimpanPerubahanInputData');
  if (saveButton) saveButton.disabled = true;
  updateInputDataSaveIndicator('Menyimpan perubahan...');
  clearInputDataValidationGuide();
  const failures = [];
  let savedCount = 0;
  for (const [logId, draft] of [...inputDataDrafts.entries()]) {
    try {
      await persistInputLogDraft(logId, draft);
      inputDataDrafts.delete(logId);
      savedCount += 1;
    } catch (error) {
      failures.push({ logId, message: error.message, fields: error.inputFields || [] });
    }
  }
  persistInputDataDrafts();
  if (failures.length) {
    updateInputDataSaveIndicator(`${failures.length} baris gagal disimpan`);
    showInputDataValidationGuide(failures);
    return false;
  }
  updateInputDataSaveIndicator(`${savedCount} baris berhasil disimpan`);
  setTimeout(() => updateInputDataSaveIndicator(), 1400);
  return true;
}

function bindInputDataInlineEditing() {
  const tbody = document.getElementById('tbodyProdInputData');
  if (!tbody || tbody.dataset.inlineEditingBound) return;
  tbody.dataset.inlineEditingBound = 'true';
  tbody.addEventListener('focusin', event => {
    const field = event.target.closest('[data-input-log-field]');
    const row = field?.closest('[data-input-log-row]');
    if (!field || !row || field.readOnly || inputDataHistoryApplying) return;
    inputDataEditHistoryStart.set(field, captureInputLogRowDraft(row));
  });
  tbody.addEventListener('focusout', event => {
    const field = event.target.closest('[data-input-log-field]');
    const row = field?.closest('[data-input-log-row]');
    const before = field ? inputDataEditHistoryStart.get(field) : null;
    if (!field || !row || !before || inputDataHistoryApplying) return;
    inputDataEditHistoryStart.delete(field);
    setTimeout(() => {
      if (!row.isConnected) return;
      const after = captureInputLogRowDraft(row);
      if (!inputDataDraftsEqual(before, after)) {
        pushInputDataHistory({ type: 'edit', logId: String(row.dataset.logId), before, after, label: `Edit ${field.dataset.inputLogField || 'Work Log'}` });
      }
    }, 0);
  });
  tbody.addEventListener('change', event => {
    const field = event.target.closest('[data-input-log-field]');
    const row = field?.closest('[data-input-log-row]');
    if (!field || !row) return;
    clearInputLogFieldValidation(field);
    if (field.dataset.inputLogField === 'class_filter') {
      const unitSelect = row.querySelector('[data-input-log-field="equipment_id"]');
      const currentUnit = findInputLogEquipment(unitSelect.value);
      const currentUnitMatches = currentUnit && (!field.value || String(currentUnit.class_unit || '') === field.value);
      const selectedUnitId = currentUnitMatches ? currentUnit.id : '';
      unitSelect.innerHTML = inputLogEquipmentOptions(selectedUnitId, field.value);
      unitSelect.focus();
      markInputLogRowDirty(row);
      return;
    }
    if (field.dataset.inputLogField === 'equipment_id') {
      const unit = findInputLogEquipment(field.value);
      const classSelect = row.querySelector('[data-input-log-field="class_filter"]');
      if (unit && classSelect) {
        const resolvedClass = String(unit.class_unit || '').trim();
        classSelect.value = resolvedClass;
        field.innerHTML = inputLogEquipmentOptions(unit.id, resolvedClass);
      }
    }
    if (field.dataset.inputLogField === 'job') {
      const selectedJob = findInputLogJob(field.value);
      const descriptionInput = row.querySelector('[data-input-log-field="job_description"]');
      if (selectedJob && descriptionInput) {
        descriptionInput.value = selectedJob.job_desc || '';
        clearInputLogFieldValidation(descriptionInput);
      }
    }
    if (field.dataset.inputLogField === 'hm_start' || field.dataset.inputLogField === 'hm_finish') {
      if (!updateInlineHmTotal(row)) return;
      void checkInputLogHmAnomaly(row);
    }
    markInputLogRowDirty(row);
  });
  tbody.addEventListener('input', event => {
    const field = event.target.closest('[data-input-log-field]');
    const row = field?.closest('[data-input-log-row]');
    if (!field || !row || field.readOnly || field.dataset.inputLogField === 'class_filter') return;
    clearInputLogFieldValidation(field);
    if (field.dataset.inputLogField === 'hm_start' || field.dataset.inputLogField === 'hm_finish') {
      updateInlineHmTotal(row);
    }
    markInputLogRowDirty(row);
  });
}

async function bukaModalMultiWorkLog() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  if (!(masterProdData.equipment || []).length || !(masterProdData.jobCodes || []).length) {
    await muatMasterDataProduksi();
  }

  const units = [...(masterProdData.equipment || [])]
    .filter(unit => unit.id && unit.kode_alat)
    .sort((a, b) => String(a.kode_alat).localeCompare(String(b.kode_alat), 'id-ID', { numeric: true, sensitivity: 'base' }));
  const shifts = getInputLogShiftChoices();
  const areas = [...new Set(units.map(unit => String(unit.lokasi || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id-ID', { sensitivity: 'base' }));
  const jobs = [...(masterProdData.jobCodes || [])]
    .filter(job => job.job_code)
    .sort((a, b) => String(a.job_code).localeCompare(String(b.job_code), 'id-ID', { numeric: true }));

  if (!units.length) return alert('Master List Equipment belum memiliki unit aktif.');
  if (!shifts.length) return alert('Master shift Siang/Malam belum tersedia.');
  if (!areas.length) return alert('Lokasi PIT/Area belum tersedia pada List Equipment.');
  if (!jobs.length) return alert('Master JOB belum tersedia. Tambahkan JOB terlebih dahulu.');

  const shiftOptions = shifts.map(shift => `<option value="${escapeMinePlanning(shift.id)}">${escapeMinePlanning(formatInputShiftLabel(shift.nama_shift))}</option>`).join('');
  const areaOptions = areas.map(area => `<option value="${escapeMinePlanning(area)}">${escapeMinePlanning(area)}</option>`).join('');
  const jobOptions = jobs.map(job => `<option value="${escapeMinePlanning(job.job_code)}">${escapeMinePlanning(job.job_code)} — ${escapeMinePlanning(job.job_desc || '')}</option>`).join('');
  const unitChecklist = units.map(unit => `
    <label data-multi-unit-item data-search="${escapeMinePlanning(`${unit.kode_alat} ${unit.class_unit || ''} ${unit.kelas_alat || ''} ${unit.tipe_alat || ''}`.toLocaleLowerCase('id-ID'))}" style="display:flex;align-items:center;gap:9px;padding:8px 10px;border-bottom:1px solid #e2e8f0;cursor:pointer;background:#fff;">
      <input type="checkbox" name="multiWorkUnit" value="${escapeMinePlanning(unit.id)}" style="width:16px;height:16px;accent-color:#0f766e;" />
      <span style="min-width:0;flex:1;"><strong style="display:block;color:#0f172a;font-size:12px;">${escapeMinePlanning(unit.kode_alat)}</strong><small style="display:block;color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeMinePlanning(unit.class_unit || 'Class belum diisi')} · ${escapeMinePlanning(unit.tipe_alat || unit.kelas_alat || 'Jenis belum diisi')}</small></span>
    </label>`).join('');

  konten.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px;">
      <div><h3 style="margin:0;color:#0f172a;">Multi Work Log</h3><p style="margin:4px 0 0;color:#64748b;font-size:12px;">Buat work log untuk banyak unit dalam satu proses.</p></div>
      <span id="multiWorkSelectedBadge" style="padding:5px 9px;border-radius:999px;background:#e2e8f0;color:#334155;font-size:11px;font-weight:800;">0 unit dipilih</span>
    </div>
    <form id="formMultiWorkLog">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div><label class="label">Hari</label><input id="multiWorkTanggal" type="date" class="input-filter" value="${new Date().toISOString().slice(0, 10)}" required /></div>
        <div><label class="label">Shift</label><select id="multiWorkShift" class="input-filter" required>${shiftOptions}</select></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div><label class="label">PIT / Area</label><select id="multiWorkArea" class="input-filter" required><option value="">Pilih PIT / Area</option>${areaOptions}</select></div>
        <div><label class="label">JOB</label><select id="multiWorkJob" class="input-filter" required><option value="">Pilih JOB</option>${jobOptions}</select></div>
      </div>
      <div style="border:1px solid #cbd5e1;border-radius:8px;overflow:hidden;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;padding:8px;background:#f8fafc;border-bottom:1px solid #cbd5e1;">
          <input id="multiWorkUnitSearch" type="search" class="input-filter" placeholder="Cari kode unit, class, atau tipe..." style="flex:1;" />
          <button id="btnMultiSelectVisible" type="button" class="tombol tombol--kecil">Pilih Semua</button>
          <button id="btnMultiClearUnits" type="button" class="tombol tombol--ghost tombol--kecil">Kosongkan</button>
        </div>
        <div id="multiWorkUnitList" style="max-height:310px;overflow-y:auto;background:#fff;">${unitChecklist}</div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button>
        <button id="btnSubmitMultiWorkLog" type="submit" class="tombol tombol--utama">Buat Multi Work Log</button>
      </div>
    </form>`;
  overlay.hidden = false;

  const list = document.getElementById('multiWorkUnitList');
  const search = document.getElementById('multiWorkUnitSearch');
  const badge = document.getElementById('multiWorkSelectedBadge');
  const checkedUnits = () => [...list.querySelectorAll('input[name="multiWorkUnit"]:checked')];
  const updateBadge = () => { badge.textContent = `${checkedUnits().length} unit dipilih`; };
  list.addEventListener('change', updateBadge);
  search.addEventListener('input', () => {
    const keyword = search.value.trim().toLocaleLowerCase('id-ID');
    list.querySelectorAll('[data-multi-unit-item]').forEach(item => {
      item.hidden = Boolean(keyword && !String(item.dataset.search || '').includes(keyword));
    });
  });
  document.getElementById('btnMultiSelectVisible').addEventListener('click', () => {
    list.querySelectorAll('[data-multi-unit-item]:not([hidden]) input[name="multiWorkUnit"]').forEach(input => { input.checked = true; });
    updateBadge();
  });
  document.getElementById('btnMultiClearUnits').addEventListener('click', () => {
    list.querySelectorAll('input[name="multiWorkUnit"]').forEach(input => { input.checked = false; });
    updateBadge();
  });
  document.getElementById('formMultiWorkLog').addEventListener('submit', async event => {
    event.preventDefault();
    const equipmentIds = checkedUnits().map(input => input.value);
    if (!equipmentIds.length) return alert('Pilih minimal satu unit.');
    const submitButton = document.getElementById('btnSubmitMultiWorkLog');
    submitButton.disabled = true;
    submitButton.textContent = 'Membuat log...';
    try {
      const response = await fetch(getProdApiUrl('/api/admin/production/logs/batch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify({
          tanggal: document.getElementById('multiWorkTanggal').value,
          shift_id: document.getElementById('multiWorkShift').value,
          equipment_ids: equipmentIds,
          area_name: document.getElementById('multiWorkArea').value,
          job: document.getElementById('multiWorkJob').value,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      tutupModalGenerik();
      await muatProdInputData();
      const createdIds = (result.logs || []).map(log => String(log.id)).filter(Boolean);
      if (createdIds.length) pushInputDataHistory({ type: 'create', ids: createdIds, label: `Tambah ${createdIds.length} Multi Work Log` });
      const skippedMessage = result.skipped ? ` ${result.skipped} unit dilewati karena log pada hari dan shift tersebut sudah tersedia.` : '';
      alert(`${result.inserted || 0} Work Log berhasil dibuat.${skippedMessage}`);
    } catch (error) {
      alert(`Gagal membuat Multi Work Log: ${error.message}`);
      submitButton.disabled = false;
      submitButton.textContent = 'Buat Multi Work Log';
    }
  });
}

async function bukaModalInputDataProduksi() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;

  if (!(masterProdData.equipment || []).length) await muatMasterDataProduksi();
  let operators = [];
  try {
    operators = await loadInputOperators();
  } catch (error) {
    alert(`Dropdown Operator belum dapat dimuat: ${error.message}`);
    return;
  }

  const equipment = [...(masterProdData.equipment || [])]
    .filter(unit => unit.id && unit.kode_alat)
    .sort((a, b) => String(a.kode_alat).localeCompare(String(b.kode_alat), 'id-ID', { numeric: true, sensitivity: 'base' }));
  const classes = [...new Set(equipment.map(unit => String(unit.class_unit || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id-ID', { numeric: true, sensitivity: 'base' }));
  const areas = [...new Set(equipment.map(unit => String(unit.lokasi || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id-ID', { sensitivity: 'base' }));
  const shifts = getInputLogShiftChoices();

  const renderEquipmentOptions = (units, selectedId = '') => '<option value="">Pilih Kode Unit</option>' + units.map(unit => `<option value="${escapeMinePlanning(unit.id)}"${String(unit.id) === String(selectedId) ? ' selected' : ''}>${escapeMinePlanning(unit.kode_alat)}</option>`).join('');
  const shiftOptions = shifts.map(shift => `<option value="${escapeMinePlanning(shift.id)}">${escapeMinePlanning(formatInputShiftLabel(shift.nama_shift))}</option>`).join('');
  const classOptions = '<option value="">Semua Class</option>' + classes.map(value => `<option value="${escapeMinePlanning(value)}">${escapeMinePlanning(value)}</option>`).join('');
  const operatorOptions = '<option value="">Pilih Operator / Driver DT</option>' + operators.map(employee => `<option value="${escapeMinePlanning(employee.id)}">${escapeMinePlanning(employee.nama)} — ${escapeMinePlanning(employee.jabatan || 'Operator')}</option>`).join('');
  const areaOptions = '<option value="">Pilih PIT / Area</option>' + areas.map(value => `<option value="${escapeMinePlanning(value)}">${escapeMinePlanning(value)}</option>`).join('');
  const jobOptions = '<option value="">Pilih JOB</option>' + [...(masterProdData.jobCodes || [])]
    .filter(job => job.job_code)
    .sort((a, b) => String(a.job_code).localeCompare(String(b.job_code), 'id-ID', { numeric: true, sensitivity: 'base' }))
    .map(job => `<option value="${escapeMinePlanning(job.job_code)}">${escapeMinePlanning(job.job_code)} — ${escapeMinePlanning(job.job_desc || '')}</option>`).join('');

  konten.innerHTML = `
    <h3 style="margin-top:0;color:#0f172a;">📝 Tambah Daily Production Work Log</h3>
    <form id="formInputProdLog">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Tanggal Log</label>
          <input type="date" id="ipTanggal" class="input-filter" value="${new Date().toISOString().split('T')[0]}" required />
        </div>
        <div>
          <label class="label">Shift</label>
          <select id="ipShift" class="input-filter" required>${shiftOptions}</select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Class</label>
          <select id="ipClass" class="input-filter">${classOptions}</select>
        </div>
        <div>
          <label class="label">Kode Unit</label>
          <select id="ipEquipment" class="input-filter" required>${renderEquipmentOptions(equipment)}</select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Operator</label>
          <select id="ipOperator" class="input-filter" required>${operatorOptions}</select>
        </div>
        <div>
          <label class="label">PIT / Area</label>
          <select id="ipArea" class="input-filter" required>${areaOptions}</select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">HM Start</label>
          <input type="number" step="0.01" min="0" id="ipHmStart" class="input-filter" placeholder="1250.00" required />
        </div>
        <div>
          <label class="label">HM Akhir</label>
          <input type="number" step="0.01" min="0" id="ipHmFinish" class="input-filter" placeholder="1260.50" required />
        </div>
        <div>
          <label class="label">HM Total</label>
          <input type="number" step="0.01" id="ipHmTotal" class="input-filter" placeholder="Otomatis" readonly aria-readonly="true" />
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1.6fr;gap:10px;margin-bottom:14px;">
        <div>
          <label class="label">JOB</label>
          <select id="ipJob" class="input-filter" required>${jobOptions}</select>
        </div>
        <div>
          <label class="label">Job Description</label>
          <input type="text" id="ipJobDesc" class="input-filter" placeholder="Contoh: Stripping Overburden Seam 3A" required />
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan Work Log</button>
      </div>
    </form>
  `;
  overlay.hidden = false;

  const classSelect = document.getElementById('ipClass');
  const equipmentSelect = document.getElementById('ipEquipment');
  const areaSelect = document.getElementById('ipArea');
  const hmStart = document.getElementById('ipHmStart');
  const hmFinish = document.getElementById('ipHmFinish');
  const hmTotal = document.getElementById('ipHmTotal');
  const jobSelect = document.getElementById('ipJob');
  const jobDescriptionInput = document.getElementById('ipJobDesc');

  classSelect.addEventListener('change', () => {
    const selectedClass = classSelect.value;
    const filtered = selectedClass ? equipment.filter(unit => String(unit.class_unit || '') === selectedClass) : equipment;
    const selectedUnit = equipment.find(unit => String(unit.id) === equipmentSelect.value);
    const selectedId = selectedUnit && (!selectedClass || String(selectedUnit.class_unit || '') === selectedClass)
      ? selectedUnit.id
      : '';
    equipmentSelect.innerHTML = renderEquipmentOptions(filtered, selectedId);
    equipmentSelect.focus();
  });
  equipmentSelect.addEventListener('change', () => {
    const unit = equipment.find(item => String(item.id) === equipmentSelect.value);
    if (!unit) return;
    const resolvedClass = String(unit.class_unit || '').trim();
    classSelect.value = resolvedClass;
    const filtered = resolvedClass ? equipment.filter(item => String(item.class_unit || '') === resolvedClass) : equipment;
    equipmentSelect.innerHTML = renderEquipmentOptions(filtered, unit.id);
    if (unit.lokasi && areas.includes(String(unit.lokasi).trim())) areaSelect.value = String(unit.lokasi).trim();
  });
  jobSelect.addEventListener('change', () => {
    const selectedJob = findInputLogJob(jobSelect.value);
    if (selectedJob) jobDescriptionInput.value = selectedJob.job_desc || '';
  });

  const updateHmTotal = () => {
    if (hmStart.value === '' || hmFinish.value === '') {
      hmFinish.setCustomValidity('');
      hmTotal.value = '';
      return;
    }
    const start = Number(hmStart.value);
    const finish = Number(hmFinish.value);
    hmFinish.setCustomValidity('');
    hmTotal.value = '';
    if (!Number.isFinite(start) || !Number.isFinite(finish)) return;
    if (finish < start) {
      hmFinish.setCustomValidity('HM Akhir tidak boleh lebih kecil dari HM Start.');
      return;
    }
    hmTotal.value = (finish - start).toFixed(2);
  };
  hmStart.addEventListener('input', updateHmTotal);
  hmFinish.addEventListener('input', updateHmTotal);

  document.getElementById('formInputProdLog').addEventListener('submit', async (e) => {
    e.preventDefault();
    updateHmTotal();
    if (!e.currentTarget.reportValidity()) return;
    const bodyData = {
      tanggal: document.getElementById('ipTanggal').value,
      shift_id: document.getElementById('ipShift').value,
      equipment_id: document.getElementById('ipEquipment').value,
      operator_id: document.getElementById('ipOperator').value,
      area_name: document.getElementById('ipArea').value,
      job: document.getElementById('ipJob').value.trim(),
      job_description: document.getElementById('ipJobDesc').value,
      hm_start: document.getElementById('ipHmStart').value,
      hm_finish: document.getElementById('ipHmFinish').value,
      status: 'submitted'
    };

    try {
      const createdLog = await sendInputLogWithHmConfirmation('/api/admin/production/logs', 'POST', bodyData);
      tutupModalGenerik();
      await muatProdInputData();
      if (createdLog?.id) pushInputDataHistory({ type: 'create', ids: [String(createdLog.id)], label: 'Tambah Work Log' });
    } catch (err) {
      alert('Gagal menyimpan Work Log: ' + err.message);
    }
  });
}

function exportWorkLogExcelV2() {
  if (!window.XLSX) {
    alert('Library Excel belum siap. Refresh dashboard lalu coba kembali.');
    return;
  }

  const renderedRows = [...document.querySelectorAll('#tbodyProdInputData [data-input-log-row]')];
  if (!renderedRows.length) {
    alert('Tidak ada Work Log yang sesuai filter untuk diekspor.');
    return;
  }

  const getField = (row, name) => row.querySelector(`[data-input-log-field="${name}"]`);
  const getSelectedText = field => {
    if (!field) return '';
    if (field.tagName === 'SELECT') return field.selectedOptions[0]?.textContent?.trim() || '';
    return String(field.value || '').trim();
  };
  const getNumber = field => {
    if (!field || field.value === '') return '';
    const value = Number(field.value);
    return Number.isFinite(value) ? value : '';
  };

  const rows = renderedRows.map(row => ({
    tanggal: String(getField(row, 'tanggal')?.value || '').trim(),
    shift: getSelectedText(getField(row, 'shift_id')),
    kodeUnit: getSelectedText(getField(row, 'equipment_id')),
    classUnit: String(getField(row, 'class_filter')?.value || '').trim(),
    operator: getSelectedText(getField(row, 'operator_id')),
    area: String(getField(row, 'area_name')?.value || '').trim(),
    hmStart: getNumber(getField(row, 'hm_start')),
    hmFinish: getNumber(getField(row, 'hm_finish')),
    hmTotal: getNumber(getField(row, 'total_hm')),
    job: String(getField(row, 'job')?.value || '').trim(),
    jobDescription: String(getField(row, 'job_description')?.value || '').trim(),
  }));

  const worksheetData = [
    ['TANGGAL', 'SHIFT', 'KODE UNIT', 'CLASS', 'OPERATOR', 'PIT / AREA', 'HM', '', '', 'JOB', 'JOB DESCRIPTION'],
    ['', '', '', '', '', '', 'START', 'AKHIR', 'TOTAL', '', ''],
    ...rows.map(row => [
      row.tanggal,
      row.shift,
      row.kodeUnit,
      row.classUnit,
      row.operator,
      row.area,
      row.hmStart,
      row.hmFinish,
      row.hmTotal,
      row.job,
      row.jobDescription,
    ]),
  ];

  try {
    const worksheet = window.XLSX.utils.aoa_to_sheet(worksheetData);
    worksheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
      { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
      { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } },
      { s: { r: 0, c: 4 }, e: { r: 1, c: 4 } },
      { s: { r: 0, c: 5 }, e: { r: 1, c: 5 } },
      { s: { r: 0, c: 6 }, e: { r: 0, c: 8 } },
      { s: { r: 0, c: 9 }, e: { r: 1, c: 9 } },
      { s: { r: 0, c: 10 }, e: { r: 1, c: 10 } },
    ];
    worksheet['!cols'] = [
      { wch: 14 }, { wch: 11 }, { wch: 18 }, { wch: 16 }, { wch: 28 },
      { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 34 },
    ];
    worksheet['!autofilter'] = { ref: `A2:K${rows.length + 2}` };
    for (let rowIndex = 2; rowIndex < rows.length + 2; rowIndex += 1) {
      for (let columnIndex = 6; columnIndex <= 8; columnIndex += 1) {
        const address = window.XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
        if (worksheet[address]?.t === 'n') worksheet[address].z = '0.00';
      }
    }

    const workbook = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Production Logs');
    window.XLSX.writeFile(workbook, `OMOS_Daily_Work_Log_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (error) {
    console.error('[Input Data] Export Excel gagal.', error);
    alert(`Export Excel gagal: ${error.message}`);
  }
}

// Kompatibilitas untuk pemanggilan lama. Seluruh jalur tetap memakai exporter V2.
function exportDataProduksiExcel() {
  return exportWorkLogExcelV2();
}

function pilihFileImportWorkLog() {
  const input = document.getElementById('inputImportWorkLogExcel');
  if (!input) return;
  input.value = '';
  input.onchange = () => importWorkLogExcel(input.files?.[0]);
  input.click();
}

function normalizeWorkLogImportText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function workLogExcelDateToIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && window.XLSX?.SSF) {
    const parsed = window.XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const text = normalizeWorkLogImportText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (match) return `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
  return '';
}

function parseWorkLogImportNumber(value) {
  if (value === '' || value === null || value === undefined) return NaN;
  if (typeof value === 'number') return value;
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
  return Number(normalized);
}

function resolveWorkLogImportOperator(value) {
  const display = normalizeWorkLogImportText(value);
  const name = display.split(/\s+[—–]\s+/)[0].trim();
  const matches = cachedInputOperators.filter(employee => String(employee.nama || '').trim().toLocaleLowerCase('id-ID') === name.toLocaleLowerCase('id-ID'));
  return matches.length === 1 ? matches[0] : null;
}

function resolveWorkLogImportShift(value) {
  const label = formatInputShiftLabel(value).toLocaleLowerCase('id-ID');
  return getInputLogShiftChoices().find(shift => String(shift.category || shift.nama_shift || '').toLocaleLowerCase('id-ID') === label) || null;
}

function resolveWorkLogImportJob(value) {
  const text = normalizeWorkLogImportText(value);
  const code = text.split(/\s+[—–]\s+/)[0].trim();
  return findInputLogJob(code);
}

async function importWorkLogExcel(file) {
  if (!file) return;
  if (!window.XLSX) return alert('Library Excel belum siap. Refresh dashboard lalu coba kembali.');
  if (inputDataDrafts.size) return alert('Simpan atau abaikan perubahan Work Log yang masih tertunda sebelum melakukan import Excel.');

  const importButton = document.getElementById('btnImportWorkLogExcel');
  try {
    if (importButton) {
      importButton.disabled = true;
      importButton.textContent = 'Membaca Excel...';
    }
    if (!(masterProdData.equipment || []).length || !(masterProdData.jobCodes || []).length) await muatMasterDataProduksi();
    await loadInputOperators({ force: true });

    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, raw: true });
    const sheetName = workbook.SheetNames.includes('Production Logs') ? 'Production Logs' : workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const matrix = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const headerRowIndex = matrix.findIndex(row => {
      const cells = row.map(value => normalizeWorkLogImportText(value).toLocaleUpperCase('id-ID'));
      return cells.includes('TANGGAL') && cells.includes('SHIFT') && cells.includes('KODE UNIT') && cells.includes('HM');
    });
    if (headerRowIndex < 0) throw new Error('Header tidak sesuai. Gunakan file yang dihasilkan dari tombol Export Excel pada Input Data.');
    const subHeader = (matrix[headerRowIndex + 1] || []).map(value => normalizeWorkLogImportText(value).toLocaleUpperCase('id-ID'));
    if (subHeader[6] !== 'START' || subHeader[7] !== 'AKHIR' || subHeader[8] !== 'TOTAL') {
      throw new Error('Sub-header HM harus berurutan: START, AKHIR, TOTAL.');
    }

    const sourceRows = matrix.slice(headerRowIndex + 2)
      .map((values, index) => ({ values, excelRow: headerRowIndex + index + 3 }))
      .filter(row => row.values.some(value => normalizeWorkLogImportText(value) !== ''));
    if (!sourceRows.length) throw new Error('File tidak memiliki baris Work Log untuk diimport.');
    if (sourceRows.length > 500) throw new Error('Maksimal 500 Work Log dalam satu file import. Pecah file menjadi beberapa bagian.');

    const equipment = masterProdData.equipment || [];
    const areaSet = new Set(equipment.map(unit => normalizeWorkLogImportText(unit.lokasi).toLocaleLowerCase('id-ID')).filter(Boolean));
    const preparedRows = [];
    const validationErrors = [];
    const fileKeys = new Set();

    sourceRows.forEach(({ values, excelRow }) => {
      const date = workLogExcelDateToIso(values[0]);
      const shift = resolveWorkLogImportShift(values[1]);
      const unitCode = normalizeWorkLogImportText(values[2]);
      const unit = equipment.find(item => String(item.kode_alat || '').trim().toLocaleLowerCase('id-ID') === unitCode.toLocaleLowerCase('id-ID'));
      const classValue = normalizeWorkLogImportText(values[3]);
      const operator = resolveWorkLogImportOperator(values[4]);
      const area = normalizeWorkLogImportText(values[5]);
      const hmStart = parseWorkLogImportNumber(values[6]);
      const hmFinish = parseWorkLogImportNumber(values[7]);
      const job = resolveWorkLogImportJob(values[9]);
      const jobDescription = normalizeWorkLogImportText(values[10] || job?.job_desc || '');
      const errors = [];
      if (!date) errors.push('Tanggal tidak valid');
      if (!shift) errors.push('Shift harus Siang atau Malam');
      if (!unit) errors.push(`Kode Unit "${unitCode || '-'}" tidak ditemukan`);
      if (unit && classValue && String(unit.class_unit || '').trim().toLocaleLowerCase('id-ID') !== classValue.toLocaleLowerCase('id-ID')) errors.push('Class tidak sesuai Kode Unit');
      if (!operator) errors.push('Operator tidak ditemukan atau nama tidak unik');
      if (!area || !areaSet.has(area.toLocaleLowerCase('id-ID'))) errors.push('PIT / Area tidak ditemukan pada List Equipment');
      if (!Number.isFinite(hmStart) || hmStart < 0) errors.push('HM Start tidak valid');
      if (!Number.isFinite(hmFinish) || hmFinish < 0) errors.push('HM Akhir tidak valid');
      if (Number.isFinite(hmStart) && Number.isFinite(hmFinish) && hmFinish < hmStart) errors.push('HM Akhir lebih kecil dari HM Start');
      if (!job) errors.push('JOB tidak ditemukan pada master');
      if (!jobDescription) errors.push('Job Description wajib diisi');
      const uniqueKey = unit && shift && date ? `${date}|${shift.id}|${unit.id}` : '';
      if (uniqueKey && fileKeys.has(uniqueKey)) errors.push('Duplikat Kode Unit pada tanggal dan shift yang sama di file');
      if (uniqueKey) fileKeys.add(uniqueKey);

      if (errors.length) validationErrors.push(`Baris ${excelRow}: ${errors.join(', ')}`);
      else preparedRows.push({
        excelRow,
        payload: {
          tanggal: date,
          shift_id: shift.id,
          equipment_id: unit.id,
          operator_id: operator.id,
          area_name: area,
          job: job.job_code,
          job_description: jobDescription,
          hm_start: hmStart,
          hm_finish: hmFinish,
          status: 'submitted',
        }
      });
    });

    if (validationErrors.length) {
      throw new Error(`Validasi gagal pada ${validationErrors.length} baris:\n${validationErrors.slice(0, 12).join('\n')}${validationErrors.length > 12 ? `\n...dan ${validationErrors.length - 12} baris lainnya.` : ''}`);
    }
    if (!confirm(`Import ${preparedRows.length} Work Log dari file "${file.name}"?\n\nHM Total akan dihitung ulang oleh sistem. Data duplikat dan anomali HM tetap mengikuti validasi Hybrid.`)) return;

    const createdIds = [];
    const failures = [];
    for (let index = 0; index < preparedRows.length; index += 1) {
      const row = preparedRows[index];
      if (importButton) importButton.textContent = `Import ${index + 1}/${preparedRows.length}...`;
      try {
        const created = await sendInputLogWithHmConfirmation('/api/admin/production/logs', 'POST', row.payload);
        if (created?.id) createdIds.push(String(created.id));
      } catch (error) {
        failures.push(`Baris ${row.excelRow}: ${error.message}`);
      }
    }

    if (createdIds.length) {
      pushInputDataHistory({ type: 'create', ids: createdIds, label: `Import ${createdIds.length} Work Log` });
      const importedDates = preparedRows.filter((_, index) => !failures.some(message => message.startsWith(`Baris ${preparedRows[index].excelRow}:`))).map(row => row.payload.tanggal);
      const firstImportedDate = importedDates.sort()[0];
      if (firstImportedDate) {
        const [year, month] = firstImportedDate.split('-');
        const yearSelect = document.getElementById('slicerInputTahun');
        const monthSelect = document.getElementById('slicerInputBulan');
        if (yearSelect) yearSelect.value = year;
        if (monthSelect) monthSelect.value = month;
      }
      await muatProdInputData();
    }

    const summary = `${createdIds.length} Work Log berhasil diimport.${failures.length ? `\n${failures.length} baris gagal:\n${failures.slice(0, 10).join('\n')}${failures.length > 10 ? `\n...dan ${failures.length - 10} lainnya.` : ''}` : ''}`;
    alert(summary);
  } catch (error) {
    console.error('[Input Data] Import Excel gagal.', error);
    alert(`Import Excel gagal:\n${error.message}`);
  } finally {
    if (importButton) {
      importButton.disabled = false;
      importButton.textContent = '⬆ Import Excel';
    }
  }
}

// -------------------------------------------------------------
// 2. INPUT FUEL
// -------------------------------------------------------------
let cachedFuelLogs = [];
let cachedFuelPeriods = [];
let fuelPeriodInitialized = false;
let fuelDraftRecoveryPrompted = false;
let fuelBulkDeleteMode = false;
let fuelHistoryApplying = false;
let fuelNavigationBypass = false;
let fuelBeforeUnloadBypass = false;
const fuelDeleteSelection = new Set();
const fuelUndoStack = [];
const fuelRedoStack = [];
const fuelEditStarts = new WeakMap();

function getFuelDraftStorageKey() {
  const account = localStorage.getItem('admin_email') || localStorage.getItem('user_email') || 'default';
  return `omos:fuel-input-drafts:${account}`;
}

function readFuelDrafts() {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(getFuelDraftStorageKey()) || '{}') || {})); }
  catch { return new Map(); }
}

let fuelDrafts = readFuelDrafts();

function persistFuelDrafts() {
  localStorage.setItem(getFuelDraftStorageKey(), JSON.stringify(Object.fromEntries(fuelDrafts)));
  updateFuelSaveUi();
}

function clearFuelDrafts() {
  fuelDrafts.clear();
  localStorage.removeItem(getFuelDraftStorageKey());
  updateFuelSaveUi();
}

function showFuelUnsavedDialog(contextLabel) {
  return new Promise(resolve => {
    document.getElementById('fuelUnsavedOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'fuelUnsavedOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `<div role="dialog" aria-modal="true" style="width:min(440px,100%);background:#fff;border-radius:14px;padding:22px;box-shadow:0 24px 65px rgba(15,23,42,.3);border:1px solid #cbd5e1;"><div style="font-size:18px;font-weight:800;color:#0f172a;">Perubahan Fuel belum disimpan</div><p style="margin:8px 0 18px;color:#475569;font-size:13px;line-height:1.5;">Terdapat ${fuelDrafts.size} Log Fuel yang berubah sebelum ${escapeMinePlanning(contextLabel)}. Simpan data sekarang?</p><div style="display:flex;justify-content:flex-end;gap:9px;"><button type="button" data-fuel-unsaved="discard" class="tombol">Abaikan</button><button type="button" data-fuel-unsaved="save" class="tombol tombol--utama">Ya, Simpan Data</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-fuel-unsaved]').forEach(button => button.addEventListener('click', () => { const action = button.dataset.fuelUnsaved; overlay.remove(); resolve(action); }, { once: true }));
  });
}

async function requestFuelNavigation(callback, contextLabel = 'beralih ke tab lain') {
  if (!fuelDrafts.size) return callback();
  const action = await showFuelUnsavedDialog(contextLabel);
  if (action === 'save') await simpanPerubahanFuel(); else clearFuelDrafts();
  if (fuelDrafts.size) return;
  fuelNavigationBypass = true;
  try { callback(); } finally { fuelNavigationBypass = false; }
}

function setupFuelUnsavedGuards() {
  if (document.documentElement.dataset.fuelUnsavedGuards) return;
  document.documentElement.dataset.fuelUnsavedGuards = 'true';
  document.addEventListener('click', event => {
    const target = event.target.closest('.sidebar__tab[data-tab]');
    const tab = document.getElementById('tab-prodInputFuel');
    if (!target || fuelNavigationBypass || !tab || tab.hidden || !fuelDrafts.size || target.dataset.tab === 'prodInputFuel') return;
    event.preventDefault(); event.stopImmediatePropagation();
    requestFuelNavigation(() => target.click());
  }, true);
  window.addEventListener('beforeunload', event => {
    if (fuelBeforeUnloadBypass || !fuelDrafts.size) return;
    event.preventDefault(); event.returnValue = '';
  });
}

function updateFuelSaveUi(message = '') {
  const button = document.getElementById('btnSimpanFuel');
  const count = fuelDrafts.size;
  if (button) {
    button.disabled = count === 0;
    button.textContent = count ? `Simpan Perubahan (${count})` : 'Simpan Perubahan';
  }
  const badge = document.getElementById('counterSlicerInputFuel');
  if (badge && message) badge.title = message;
}

function captureFuelRow(row) {
  const fields = {};
  row.querySelectorAll('[data-fuel-field]').forEach(field => { fields[field.dataset.fuelField] = field.value; });
  return { fields, updatedAt: new Date().toISOString() };
}

function fuelSnapshotsEqual(left, right) {
  return JSON.stringify(left?.fields || {}) === JSON.stringify(right?.fields || {});
}

function updateFuelHistoryButtons() {
  const undo = document.getElementById('btnUndoFuel');
  const redo = document.getElementById('btnRedoFuel');
  if (undo) undo.disabled = fuelUndoStack.length === 0;
  if (redo) redo.disabled = fuelRedoStack.length === 0;
}

function pushFuelHistory(action) {
  if (fuelHistoryApplying || !action) return;
  fuelUndoStack.push(action);
  if (fuelUndoStack.length > 100) fuelUndoStack.shift();
  fuelRedoStack.length = 0;
  updateFuelHistoryButtons();
}

function applyFuelDraftSnapshot(logId, snapshot) {
  fuelDrafts.set(String(logId), { fields: { ...(snapshot?.fields || {}) }, updatedAt: new Date().toISOString() });
  persistFuelDrafts();
  terapkanSlicerInputFuel();
}

async function mutateFuelHistoryLogs(ids, restore) {
  const response = await fetch(getProdApiUrl(restore ? '/api/admin/production/fuel/batch/restore' : '/api/admin/production/fuel/batch'), {
    method: restore ? 'PATCH' : 'DELETE',
    headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
    body: JSON.stringify({ ids }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  if (typeof invalidateFuelDetailCache === 'function') invalidateFuelDetailCache();
  await muatProdInputFuel();
}

async function applyFuelHistory(action, direction) {
  if (action.type === 'edit') return applyFuelDraftSnapshot(action.logId, direction === 'undo' ? action.before : action.after);
  const undo = direction === 'undo';
  const restore = action.type === 'delete' ? undo : !undo;
  await mutateFuelHistoryLogs(action.ids, restore);
  if (action.type === 'delete') {
    if (restore && action.drafts) Object.entries(action.drafts).forEach(([id, draft]) => fuelDrafts.set(id, draft));
    else action.ids.forEach(id => fuelDrafts.delete(String(id)));
  } else if (action.type === 'create' && !restore) {
    action.ids.forEach(id => fuelDrafts.delete(String(id)));
  }
  persistFuelDrafts();
}

async function undoFuelAction() {
  if (!fuelUndoStack.length || fuelHistoryApplying) return;
  const action = fuelUndoStack.pop(); fuelHistoryApplying = true; updateFuelHistoryButtons();
  try { await applyFuelHistory(action, 'undo'); fuelRedoStack.push(action); }
  catch (error) { fuelUndoStack.push(action); alert(`Undo gagal: ${error.message}`); }
  finally { fuelHistoryApplying = false; updateFuelHistoryButtons(); }
}

async function redoFuelAction() {
  if (!fuelRedoStack.length || fuelHistoryApplying) return;
  const action = fuelRedoStack.pop(); fuelHistoryApplying = true; updateFuelHistoryButtons();
  try { await applyFuelHistory(action, 'redo'); fuelUndoStack.push(action); }
  catch (error) { fuelRedoStack.push(action); alert(`Redo gagal: ${error.message}`); }
  finally { fuelHistoryApplying = false; updateFuelHistoryButtons(); }
}

async function muatProdInputFuel() {
  const tbody = document.getElementById('tbodyProdInputFuel');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="16" class="tabel__kosong">Memuat data bahan bakar...</td></tr>';
  try {
    const yearSelect = document.getElementById('slicerFuelTahun');
    const monthSelect = document.getElementById('slicerFuelBulan');
    if (!fuelPeriodInitialized) {
      const today = new Date();
      if (yearSelect) yearSelect.value = String(today.getFullYear());
      if (monthSelect) monthSelect.value = String(today.getMonth() + 1).padStart(2, '0');
      fuelPeriodInitialized = true;
      const periodsResponse = await fetch(getProdApiUrl('/api/admin/production/fuel-periods'), { headers: { ...getProdAuthHeaders() } });
      if (periodsResponse.ok) cachedFuelPeriods = await periodsResponse.json();
    }
    if (!(masterProdData.equipment || []).length) await muatMasterDataProduksi();
    await loadInputOperators({ force: true }).catch(() => {});
    const params = new URLSearchParams();
    if (yearSelect?.value) params.set('year', yearSelect.value);
    if (yearSelect?.value && monthSelect?.value) params.set('month', monthSelect.value);
    const res = await fetch(getProdApiUrl(`/api/admin/production/fuel${params.size ? `?${params}` : ''}`), { headers: { ...getProdAuthHeaders() } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    cachedFuelLogs = Array.isArray(data.logs) ? data.logs : [];
    isiDropdownSlicerInputFuel();
    terapkanSlicerInputFuel();
    bindFuelInlineEditing();
    updateFuelSaveUi();
    updateFuelHistoryButtons();
    if (fuelDrafts.size && !fuelDraftRecoveryPrompted) {
      fuelDraftRecoveryPrompted = true;
      const action = await showFuelUnsavedDialog('melanjutkan setelah halaman dimuat ulang');
      if (action === 'save') await simpanPerubahanFuel();
      else {
        clearFuelDrafts();
        terapkanSlicerInputFuel();
      }
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="16" class="teks-error">Gagal memuat data fuel: ${err.message}</td></tr>`;
  }
}

function isiDropdownSlicerInputFuel() {
  const logs = cachedFuelLogs;

  // Slicer Utama Tahun
  const selTahun = document.getElementById('slicerFuelTahun');
  if (selTahun) {
    const curVal = selTahun.value;
    const currentYear = String(new Date().getFullYear());
    const years = Array.from(new Set([currentYear, ...cachedFuelPeriods.map(item => String(item.year || '')).filter(Boolean), ...logs.map(l => l.tanggal ? l.tanggal.split('-')[0] : '').filter(Boolean)])).sort((a, b) => Number(b) - Number(a));
    if (years.length > 0) {
      selTahun.innerHTML = '<option value="">Semua Tahun</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
      if (curVal && years.includes(curVal)) {
        selTahun.value = curVal;
      } else if (!curVal && years.includes(currentYear)) {
        selTahun.value = currentYear;
      }
    }
  }

  // Slicer Kode Unit
  const selKode = document.getElementById('slicerFuelKode');
  if (selKode) {
    const curVal = selKode.value;
    const list = Array.from(new Set(logs.map(l => l.kode_alat).filter(Boolean))).sort();
    selKode.innerHTML = '<option value="">Semua Kode Unit</option>' + list.map(k => `<option value="${k}">${k}</option>`).join('');
    if (curVal && list.includes(curVal)) selKode.value = curVal;
  }

  // Slicer Shift
  const selShift = document.getElementById('slicerFuelShift');
  if (selShift) {
    const curVal = selShift.value;
    const list = Array.from(new Set(logs.map(l => l.nama_shift).filter(Boolean))).sort();
    selShift.innerHTML = '<option value="">Semua Shift</option>' + list.map(s => `<option value="${s}">${s}</option>`).join('');
    if (curVal && list.includes(curVal)) selShift.value = curVal;
  }

  // Slicer Operator
  const selOp = document.getElementById('slicerFuelOperator');
  if (selOp) {
    const curVal = selOp.value;
    const list = Array.from(new Set(logs.map(l => l.nama_operator).filter(Boolean))).sort();
    selOp.innerHTML = '<option value="">Semua Operator</option>' + list.map(o => `<option value="${o}">${o}</option>`).join('');
    if (curVal && list.includes(curVal)) selOp.value = curVal;
  }
}

function resetSlicerInputFuel() {
  const selTahun = document.getElementById('slicerFuelTahun');
  const selBulan = document.getElementById('slicerFuelBulan');
  const inpTanggal = document.getElementById('slicerFuelTanggal');
  const selKode = document.getElementById('slicerFuelKode');
  const selShift = document.getElementById('slicerFuelShift');
  const selOp = document.getElementById('slicerFuelOperator');
  const selEf = document.getElementById('slicerFuelEfisiensi');

  if (selTahun) selTahun.value = '';
  if (selBulan) selBulan.value = '';
  if (inpTanggal) inpTanggal.value = '';
  if (selKode) selKode.value = '';
  if (selShift) selShift.value = '';
  if (selOp) selOp.value = '';
  if (selEf) selEf.value = '';

  void muatProdInputFuel();
}

function terapkanSlicerInputFuel() {
  const tbody = document.getElementById('tbodyProdInputFuel');
  const counterBadge = document.getElementById('counterSlicerInputFuel');
  if (!tbody) return;

  const tahunVal = document.getElementById('slicerFuelTahun')?.value || '';
  const bulanVal = document.getElementById('slicerFuelBulan')?.value || '';
  const tglVal = document.getElementById('slicerFuelTanggal')?.value || '';
  const kodeVal = document.getElementById('slicerFuelKode')?.value || '';
  const shiftVal = document.getElementById('slicerFuelShift')?.value || '';
  const opVal = document.getElementById('slicerFuelOperator')?.value || '';
  const efVal = document.getElementById('slicerFuelEfisiensi')?.value || '';

  if (typeof simpanSesiUserOMOS === 'function') {
    simpanSesiUserOMOS({
      slicers: {
        slicerFuelTahun: tahunVal,
        slicerFuelBulan: bulanVal,
        slicerFuelTanggal: tglVal,
        slicerFuelKode: kodeVal,
        slicerFuelShift: shiftVal,
        slicerFuelOperator: opVal,
        slicerFuelEfisiensi: efVal
      }
    });
  }

  let logs = [...cachedFuelLogs];

  if (tahunVal) {
    logs = logs.filter(l => l.tanggal && l.tanggal.startsWith(tahunVal));
  }
  if (bulanVal) {
    logs = logs.filter(l => {
      if (!l.tanggal) return false;
      const parts = l.tanggal.split('T')[0].split('-');
      return parts.length >= 2 && parts[1] === bulanVal;
    });
  }
  if (tglVal) {
    logs = logs.filter(l => l.tanggal && l.tanggal.startsWith(tglVal));
  }
  if (kodeVal) {
    logs = logs.filter(l => l.kode_alat === kodeVal);
  }
  if (shiftVal) {
    logs = logs.filter(l => l.nama_shift === shiftVal);
  }
  if (opVal) {
    logs = logs.filter(l => l.nama_operator === opVal);
  }
  if (efVal) {
    if (efVal === 'Boros') {
      logs = logs.filter(l => parseFloat(l.fuel_per_hm) > 45);
    } else if (efVal === 'Efisien') {
      logs = logs.filter(l => parseFloat(l.fuel_per_hm) <= 45);
    }
  }

  if (counterBadge) {
    counterBadge.textContent = `Total Log Fuel: ${logs.length}`;
  }

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="tabel__kosong">Tidak ada data fuel yang sesuai filter.</td></tr>';
    syncFuelBulkDeleteUi();
    return;
  }

  tbody.innerHTML = logs.map(row => {
    const resolvedClass = resolveInputLogEquipmentClass(row.equipment_id, row.class_unit);
    const efficiency = Number(row.fuel_per_hm || 0) > 45 ? 'Boros (Anomali)' : 'Efisien';
    return `<tr data-fuel-row data-fuel-id="${escapeMinePlanning(row.id)}">
      <td data-fuel-delete-column${fuelBulkDeleteMode ? '' : ' hidden'}><input type="checkbox" data-fuel-select value="${escapeMinePlanning(row.id)}" onchange="toggleFuelSelection('${escapeMinePlanning(row.id)}',this.checked)" /></td>
      <td><input type="date" data-fuel-field="tanggal" value="${escapeMinePlanning(String(row.tanggal || '').split('T')[0])}" required /></td>
      <td><select data-fuel-field="shift_id" required>${inputLogShiftOptions(row.shift_id)}</select></td>
      <td><select data-fuel-field="equipment_id" required>${inputLogEquipmentOptions(row.equipment_id, resolvedClass)}</select></td>
      <td><select data-fuel-field="class_filter">${inputLogClassOptions(resolvedClass)}</select></td>
      <td><select data-fuel-field="operator_id">${inputLogOperatorOptions(row.operator_id)}</select></td>
      <td><input type="number" step="0.01" min="0" data-fuel-field="hm_start" value="${escapeMinePlanning(row.hm_start ?? '')}" required /></td>
      <td><input type="number" step="0.01" min="0" data-fuel-field="hm_finish" value="${escapeMinePlanning(row.hm_finish ?? '')}" required /></td>
      <td><input type="number" step="0.01" data-fuel-field="total_hm" value="${escapeMinePlanning(row.total_hm ?? '')}" readonly /></td>
      <td><input type="number" step="0.01" min="0" data-fuel-field="fuel_filled" value="${escapeMinePlanning(row.fuel_filled ?? '')}" required /></td>
      <td><input type="number" step="0.01" min="0" data-fuel-field="fuel_remaining" value="${escapeMinePlanning(row.fuel_remaining ?? '')}" required /></td>
      <td><input type="number" step="0.01" data-fuel-field="fuel_consumption" value="${escapeMinePlanning(row.fuel_consumption ?? '')}" readonly /></td>
      <td><input type="number" step="0.01" data-fuel-field="fuel_per_hm" value="${escapeMinePlanning(row.fuel_per_hm ?? '')}" readonly /></td>
      <td><span data-fuel-efficiency style="background:${efficiency === 'Boros (Anomali)' ? '#fee2e2;color:#991b1b' : '#dcfce7;color:#15803d'};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;">${efficiency}</span></td>
      <td><input type="text" data-fuel-field="remark" value="${escapeMinePlanning(row.remark || '')}" placeholder="Keterangan" /></td>
    </tr>`;
  }).join('');
  applyFuelDraftsToRows();
  syncFuelBulkDeleteUi();
}

function updateFuelCalculatedFields(row) {
  const get = name => row.querySelector(`[data-fuel-field="${name}"]`);
  const hmStart = Number(get('hm_start')?.value);
  const hmFinish = Number(get('hm_finish')?.value);
  const fuelFilled = Number(get('fuel_filled')?.value);
  const fuelRemaining = Number(get('fuel_remaining')?.value);
  const totalHm = Number.isFinite(hmStart) && Number.isFinite(hmFinish) && hmFinish >= hmStart ? Number((hmFinish - hmStart).toFixed(2)) : 0;
  const consumption = Number.isFinite(fuelFilled) && Number.isFinite(fuelRemaining) ? Math.max(0, Number((fuelFilled - fuelRemaining).toFixed(2))) : 0;
  const perHm = totalHm > 0 && Number.isFinite(fuelFilled) ? Number((fuelFilled / totalHm).toFixed(2)) : 0;
  if (get('total_hm')) get('total_hm').value = totalHm.toFixed(2);
  if (get('fuel_consumption')) get('fuel_consumption').value = consumption.toFixed(2);
  if (get('fuel_per_hm')) get('fuel_per_hm').value = perHm.toFixed(2);
  const label = row.querySelector('[data-fuel-efficiency]');
  if (label) {
    const boros = perHm > 45;
    label.textContent = boros ? 'Boros (Anomali)' : 'Efisien';
    label.style.cssText = `background:${boros ? '#fee2e2;color:#991b1b' : '#dcfce7;color:#15803d'};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:bold;`;
  }
  return { valid: Number.isFinite(hmStart) && Number.isFinite(hmFinish) && hmFinish >= hmStart && Number.isFinite(fuelFilled) && fuelFilled >= 0 && Number.isFinite(fuelRemaining) && fuelRemaining >= 0 };
}

function markFuelRowDirty(row) {
  if (!row || fuelHistoryApplying) return;
  const id = String(row.dataset.fuelId || '');
  if (!id) return;
  fuelDrafts.set(id, captureFuelRow(row));
  row.dataset.saveState = 'dirty';
  persistFuelDrafts();
}

function applyFuelDraftsToRows() {
  document.querySelectorAll('[data-fuel-row]').forEach(row => {
    const draft = fuelDrafts.get(String(row.dataset.fuelId));
    if (!draft?.fields) return;
    Object.entries(draft.fields).forEach(([name, value]) => {
      const field = row.querySelector(`[data-fuel-field="${name}"]`);
      if (field) field.value = value;
    });
    updateFuelCalculatedFields(row);
    row.dataset.saveState = 'dirty';
  });
}

function bindFuelInlineEditing() {
  const tbody = document.getElementById('tbodyProdInputFuel');
  if (!tbody || tbody.dataset.fuelEditingBound) return;
  tbody.dataset.fuelEditingBound = 'true';
  tbody.addEventListener('focusin', event => {
    const field = event.target.closest('[data-fuel-field]');
    const row = field?.closest('[data-fuel-row]');
    if (!field || !row || field.readOnly || fuelHistoryApplying) return;
    fuelEditStarts.set(field, captureFuelRow(row));
  });
  tbody.addEventListener('focusout', event => {
    const field = event.target.closest('[data-fuel-field]');
    const row = field?.closest('[data-fuel-row]');
    const before = field ? fuelEditStarts.get(field) : null;
    if (!field || !row || !before || fuelHistoryApplying) return;
    fuelEditStarts.delete(field);
    const after = captureFuelRow(row);
    if (!fuelSnapshotsEqual(before, after)) pushFuelHistory({ type: 'edit', logId: String(row.dataset.fuelId), before, after, label: `Edit ${field.dataset.fuelField}` });
  });
  const handleField = event => {
    const field = event.target.closest('[data-fuel-field]');
    const row = field?.closest('[data-fuel-row]');
    if (!field || !row || field.readOnly) return;
    if (field.dataset.fuelField === 'class_filter') {
      const equipmentSelect = row.querySelector('[data-fuel-field="equipment_id"]');
      const selectedUnit = findInputLogEquipment(equipmentSelect.value);
      const keep = selectedUnit && (!field.value || String(selectedUnit.class_unit || '') === field.value) ? selectedUnit.id : '';
      equipmentSelect.innerHTML = inputLogEquipmentOptions(keep, field.value);
      equipmentSelect.focus();
    }
    if (field.dataset.fuelField === 'equipment_id') {
      const unit = findInputLogEquipment(field.value);
      const classSelect = row.querySelector('[data-fuel-field="class_filter"]');
      if (unit && classSelect) classSelect.value = String(unit.class_unit || '');
    }
    updateFuelCalculatedFields(row);
    markFuelRowDirty(row);
  };
  tbody.addEventListener('change', handleField);
  tbody.addEventListener('input', handleField);
}

async function persistFuelDraft(logId, draft) {
  const fields = draft?.fields || {};
  const required = ['tanggal', 'shift_id', 'equipment_id', 'hm_start', 'hm_finish', 'fuel_filled', 'fuel_remaining'];
  const missing = required.filter(name => fields[name] === undefined || fields[name] === null || String(fields[name]).trim() === '');
  if (missing.length) throw new Error(`Kolom wajib belum lengkap: ${missing.join(', ')}`);
  const response = await fetch(getProdApiUrl(`/api/admin/production/fuel/${encodeURIComponent(logId)}`), {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify(fields),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function simpanPerubahanFuel() {
  if (!fuelDrafts.size) return;
  const failures = [];
  const createdIds = [];
  let saved = 0;
  for (const [id, draft] of [...fuelDrafts.entries()]) {
    try {
      const result = await persistFuelDraft(id, draft);
      if (String(id).startsWith('new:') && result?.id) createdIds.push(String(result.id));
      fuelDrafts.delete(id); saved += 1;
    }
    catch (error) { failures.push(`Log ${id}: ${error.message}`); }
  }
  persistFuelDrafts();
  if (saved) {
    if (createdIds.length) pushFuelHistory({ type: 'create', ids: createdIds, label: `Tambah ${createdIds.length} Pengisian Fuel` });
    if (typeof invalidateFuelDetailCache === 'function') invalidateFuelDetailCache();
    await muatProdInputFuel();
  }
  if (failures.length) alert(`${saved} Log Fuel tersimpan.\n${failures.length} gagal:\n${failures.slice(0, 8).join('\n')}`);
  else alert(`${saved} perubahan Log Fuel berhasil disimpan.`);
}

function syncFuelBulkDeleteUi() {
  const bar = document.getElementById('fuelBulkDeleteBar');
  document.querySelectorAll('[data-fuel-delete-column]').forEach(element => { element.hidden = !fuelBulkDeleteMode; });
  if (bar) { bar.hidden = !fuelBulkDeleteMode; bar.style.display = fuelBulkDeleteMode ? 'flex' : 'none'; }
  const toggle = document.getElementById('btnToggleDeleteFuelLogs');
  if (toggle) toggle.textContent = fuelBulkDeleteMode ? 'Tutup Mode Hapus' : 'Hapus Log Fuel';
  const visible = [...document.querySelectorAll('[data-fuel-select]')].filter(input => !input.closest('tr')?.hidden);
  visible.forEach(input => { input.checked = fuelDeleteSelection.has(String(input.value)); });
  const selected = visible.filter(input => input.checked).length;
  const count = document.getElementById('fuelDeleteSelectedCount');
  const button = document.getElementById('btnDeleteSelectedFuel');
  const all = document.getElementById('fuelSelectAll');
  if (count) count.textContent = `${fuelDeleteSelection.size} Log Fuel dipilih`;
  if (button) button.disabled = fuelDeleteSelection.size === 0;
  if (all) { all.checked = visible.length > 0 && selected === visible.length; all.indeterminate = selected > 0 && selected < visible.length; }
}

function toggleFuelBulkDeleteMode() { fuelBulkDeleteMode = !fuelBulkDeleteMode; if (!fuelBulkDeleteMode) fuelDeleteSelection.clear(); syncFuelBulkDeleteUi(); }
function cancelFuelBulkDelete() { fuelBulkDeleteMode = false; fuelDeleteSelection.clear(); syncFuelBulkDeleteUi(); }
function toggleFuelSelection(id, checked) { if (checked) fuelDeleteSelection.add(String(id)); else fuelDeleteSelection.delete(String(id)); syncFuelBulkDeleteUi(); }
function toggleSelectAllFuel(checked) { document.querySelectorAll('[data-fuel-select]').forEach(input => checked ? fuelDeleteSelection.add(String(input.value)) : fuelDeleteSelection.delete(String(input.value))); syncFuelBulkDeleteUi(); }

async function deleteSelectedFuelLogs() {
  const ids = [...fuelDeleteSelection];
  if (!ids.length || !confirm(`Hapus ${ids.length} Log Fuel terpilih?`)) return;
  const drafts = Object.fromEntries(ids.filter(id => fuelDrafts.has(id)).map(id => [id, fuelDrafts.get(id)]));
  try {
    await mutateFuelHistoryLogs(ids, false);
    ids.forEach(id => fuelDrafts.delete(id)); persistFuelDrafts();
    fuelDeleteSelection.clear(); fuelBulkDeleteMode = false;
    pushFuelHistory({ type: 'delete', ids, drafts, label: `Hapus ${ids.length} Log Fuel` });
    alert(`${ids.length} Log Fuel berhasil dihapus.`);
  } catch (error) { alert(`Gagal menghapus Log Fuel: ${error.message}`); }
}

function exportFuelExcel() {
  if (!window.XLSX) return alert('Library Excel belum siap. Refresh dashboard lalu coba kembali.');
  const rows = [...document.querySelectorAll('#tbodyProdInputFuel [data-fuel-row]')];
  if (!rows.length) return alert('Tidak ada Log Fuel yang sesuai filter untuk diekspor.');
  const field = (row, name) => row.querySelector(`[data-fuel-field="${name}"]`);
  const text = element => element?.tagName === 'SELECT' ? (element.selectedOptions[0]?.textContent?.trim() || '') : String(element?.value || '').trim();
  const number = element => element?.value === '' ? '' : (Number.isFinite(Number(element?.value)) ? Number(element.value) : '');
  const headers = ['Tanggal', 'Shift', 'Kode Unit', 'Class', 'Operator', 'HM Start', 'HM Akhir', 'HM Total', 'Solar Isi (L)', 'Sisa Solar (L)', 'Konsumsi (L)', 'Fuel / HM (L/HM)', 'Keterangan'];
  const values = rows.map(row => ['tanggal', 'shift_id', 'equipment_id', 'class_filter', 'operator_id'].map(name => text(field(row, name))).concat(['hm_start', 'hm_finish', 'total_hm', 'fuel_filled', 'fuel_remaining', 'fuel_consumption', 'fuel_per_hm'].map(name => number(field(row, name))).concat(text(field(row, 'remark')))));
  const worksheet = window.XLSX.utils.aoa_to_sheet([headers, ...values]);
  worksheet['!cols'] = [14, 12, 18, 16, 28, 12, 12, 12, 14, 15, 14, 16, 34].map(wch => ({ wch }));
  worksheet['!autofilter'] = { ref: `A1:M${values.length + 1}` };
  for (let r = 2; r <= values.length + 1; r += 1) for (let c = 5; c <= 11; c += 1) { const cell = worksheet[window.XLSX.utils.encode_cell({ r: r - 1, c })]; if (cell?.t === 'n') cell.z = '0.00'; }
  const workbook = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(workbook, worksheet, 'Fuel Logs');
  window.XLSX.writeFile(workbook, `OMOS_Fuel_Log_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function pilihFileImportFuel() { const input = document.getElementById('inputImportFuelExcel'); if (!input) return; input.value = ''; input.onchange = () => importFuelExcel(input.files?.[0]); input.click(); }

async function importFuelExcel(file) {
  if (!file) return;
  if (!window.XLSX) return alert('Library Excel belum siap. Refresh dashboard lalu coba kembali.');
  if (fuelDrafts.size) return alert('Simpan atau abaikan perubahan Fuel yang tertunda sebelum import.');
  try {
    if (!(masterProdData.equipment || []).length) await muatMasterDataProduksi();
    await loadInputOperators({ force: true }).catch(() => {});
    const workbook = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames.includes('Fuel Logs') ? 'Fuel Logs' : workbook.SheetNames[0]];
    const matrix = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
    const headerIndex = matrix.findIndex(row => row.map(value => normalizeWorkLogImportText(value).toLocaleUpperCase('id-ID')).includes('KODE UNIT'));
    if (headerIndex < 0) throw new Error('Header tidak sesuai. Gunakan format Export Excel dari Input Fuel.');
    const rows = matrix.slice(headerIndex + 1).map((values, index) => ({ values, excelRow: headerIndex + index + 2 })).filter(row => row.values.some(value => normalizeWorkLogImportText(value) !== ''));
    if (!rows.length || rows.length > 500) throw new Error(rows.length ? 'Maksimal 500 Log Fuel per file.' : 'File tidak memiliki data Fuel.');
    const errors = []; const payloads = []; const keys = new Set();
    rows.forEach(({ values, excelRow }) => {
      const tanggal = workLogExcelDateToIso(values[0]); const shift = resolveWorkLogImportShift(values[1]);
      const code = normalizeWorkLogImportText(values[2]); const unit = (masterProdData.equipment || []).find(item => String(item.kode_alat || '').trim().toLowerCase() === code.toLowerCase());
      const classValue = normalizeWorkLogImportText(values[3]); const operator = resolveWorkLogImportOperator(values[4]);
      const hmStart = parseWorkLogImportNumber(values[5]); const hmFinish = parseWorkLogImportNumber(values[6]); const filled = parseWorkLogImportNumber(values[8]); const remaining = parseWorkLogImportNumber(values[9]);
      const rowErrors = [];
      if (!tanggal) rowErrors.push('Tanggal tidak valid'); if (!shift) rowErrors.push('Shift tidak valid'); if (!unit) rowErrors.push('Kode Unit tidak ditemukan');
      if (unit && classValue && String(unit.class_unit || '').trim().toLowerCase() !== classValue.toLowerCase()) rowErrors.push('Class tidak sesuai Kode Unit');
      if (normalizeWorkLogImportText(values[4]) && !operator) rowErrors.push('Operator tidak ditemukan');
      if (![hmStart, hmFinish, filled, remaining].every(Number.isFinite) || hmStart < 0 || hmFinish < hmStart || filled < 0 || remaining < 0) rowErrors.push('Nilai HM atau Fuel tidak valid');
      const key = unit && shift && tanggal ? `${tanggal}|${shift.id}|${unit.id}` : ''; if (key && keys.has(key)) rowErrors.push('Duplikat unit/tanggal/shift dalam file'); if (key) keys.add(key);
      if (rowErrors.length) errors.push(`Baris ${excelRow}: ${rowErrors.join(', ')}`);
      else payloads.push({ excelRow, data: { tanggal, shift_id: shift.id, equipment_id: unit.id, operator_id: operator?.id || null, hm_start: hmStart, hm_finish: hmFinish, fuel_filled: filled, fuel_remaining: remaining, remark: normalizeWorkLogImportText(values[12]) } });
    });
    if (errors.length) throw new Error(`Validasi gagal:\n${errors.slice(0, 12).join('\n')}${errors.length > 12 ? `\n...dan ${errors.length - 12} baris lainnya.` : ''}`);
    if (!confirm(`Import ${payloads.length} Log Fuel dari "${file.name}"? Nilai konsumsi dan Fuel/HM dihitung ulang sistem.`)) return;
    const createdIds = []; const failures = [];
    for (const item of payloads) {
      const response = await fetch(getProdApiUrl('/api/admin/production/fuel'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify(item.data) });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.id) createdIds.push(String(result.id)); else failures.push(`Baris ${item.excelRow}: ${result.error || `HTTP ${response.status}`}`);
    }
    if (createdIds.length) { pushFuelHistory({ type: 'create', ids: createdIds, label: `Import ${createdIds.length} Log Fuel` }); await muatProdInputFuel(); }
    alert(`${createdIds.length} Log Fuel berhasil diimport.${failures.length ? `\n${failures.length} gagal:\n${failures.slice(0, 10).join('\n')}` : ''}`);
  } catch (error) { alert(`Import Fuel gagal:\n${error.message}`); }
}

function bukaModalInputFuel() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;

  const equipOptions = inputLogEquipmentOptions('');
  const shiftOptions = inputLogShiftOptions('');
  const operatorOptions = inputLogOperatorOptions('');

  konten.innerHTML = `
    <h3 style="margin-top:0;color:#0f172a;">⛽ Input Pengisian Bahan Bakar Solar</h3>
    <form id="formInputFuel">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Tanggal</label>
          <input type="date" id="ifTanggal" class="input-filter" value="${new Date().toISOString().split('T')[0]}" required />
        </div>
        <div>
          <label class="label">Shift</label>
          <select id="ifShift" class="input-filter">${shiftOptions}</select>
        </div>
      </div>
      <div style="margin-bottom:10px;">
        <label class="label">Unit Alat Berat</label>
        <select id="ifEquipment" class="input-filter" required>${equipOptions}</select>
      </div>
      <div style="margin-bottom:10px;">
        <label class="label">Operator / Driver DT</label>
        <select id="ifOperator" class="input-filter">${operatorOptions}</select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">HM Start</label>
          <input type="number" step="0.1" id="ifHmStart" class="input-filter" placeholder="100.0" required />
        </div>
        <div>
          <label class="label">HM Finish</label>
          <input type="number" step="0.1" id="ifHmFinish" class="input-filter" placeholder="110.0" required />
        </div>
      </div>
      <div style="margin-bottom:14px;">
        <label class="label">Keterangan</label>
        <input type="text" id="ifFuelRemark" class="input-filter" placeholder="Contoh: Pengisian di Fuel Bay 1" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div>
          <label class="label">BBM Solar Diisi (Liter)</label>
          <input type="number" step="1" id="ifFuelFilled" class="input-filter" placeholder="250" required />
        </div>
        <div>
          <label class="label">Sisa Solar Tangki (Liter)</label>
          <input type="number" step="1" id="ifFuelRemaining" class="input-filter" placeholder="30" required />
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan Log Fuel</button>
      </div>
    </form>
  `;
  overlay.hidden = false;

  document.getElementById('formInputFuel').addEventListener('submit', async (e) => {
    e.preventDefault();
    const bodyData = {
      tanggal: document.getElementById('ifTanggal').value,
      shift_id: document.getElementById('ifShift').value,
      equipment_id: document.getElementById('ifEquipment').value,
      operator_id: document.getElementById('ifOperator').value || null,
      hm_start: document.getElementById('ifHmStart').value,
      hm_finish: document.getElementById('ifHmFinish').value,
      fuel_filled: document.getElementById('ifFuelFilled').value,
      fuel_remaining: document.getElementById('ifFuelRemaining').value,
      remark: document.getElementById('ifFuelRemark').value
    };

    try {
      const res = await fetch(getProdApiUrl('/api/admin/production/fuel'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify(bodyData)
      });
      const created = await res.json().catch(() => ({}));
      if (res.ok) {
        tutupModalGenerik();
        await muatProdInputFuel();
        if (created?.id) pushFuelHistory({ type: 'create', ids: [String(created.id)], label: 'Tambah Log Fuel' });
      } else {
        throw new Error(created.error || `HTTP ${res.status}`);
      }
    } catch (err) {
      alert('Gagal menyimpan fuel log: ' + err.message);
    }
  });
}

// =============================================================
// INPUT FUEL CARD EXPERIENCE (v2)
// One active List Equipment unit = one lazily loaded card.
// =============================================================
let fuelCardPayload = { cards: [], groups: [], summary: {} };
let fuelCardReloadTimer = null;
const fuelOpenCards = new Set();
const fuelCollapsedGroups = new Set();
const fuelDetailCache = new Map();
let fuelDefaultCollapseInitialized = false;

function nextCalendarDate(dateValue) {
  const clean = String(dateValue || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) return getLocalDateInputValue();
  const [year, month, day] = clean.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

function fuelInlineDraftKey() {
  return `new:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

function getFuelInlineDrafts(equipmentId) {
  return [...fuelDrafts.entries()]
    .filter(([id, draft]) => String(id).startsWith('new:') && String(draft?.fields?.equipment_id || '') === String(equipmentId))
    .map(([id, draft]) => ({ id, fields: draft.fields || {} }));
}

function invalidateFuelDetailCache(equipmentId = '') {
  if (!equipmentId) return fuelDetailCache.clear();
  [...fuelDetailCache.keys()].filter(key => key.endsWith(`:${equipmentId}`)).forEach(key => fuelDetailCache.delete(key));
}

function scheduleFuelCardReload() {
  clearTimeout(fuelCardReloadTimer);
  fuelCardReloadTimer = setTimeout(() => muatProdInputFuel(), 280);
}

function fuelMetric(value, digits = 2, suffix = '') {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number)
    ? `${number.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`
    : '—';
}

function fuelMonthName(month) {
  return ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][Number(month) - 1] || '';
}

function currentFuelPeriod() {
  return {
    year: document.getElementById('slicerFuelTahun')?.value || String(new Date().getFullYear()),
    month: document.getElementById('slicerFuelBulan')?.value || String(new Date().getMonth() + 1).padStart(2, '0'),
  };
}

function syncFuelCardFilterOptions() {
  const jenisSelect = document.getElementById('slicerFuelJenis');
  const classSelect = document.getElementById('slicerFuelClass');
  const equipment = masterProdData.equipment || [];
  if (jenisSelect) {
    const current = jenisSelect.value;
    const values = [...new Set(equipment.map(unit => String(unit.kelas_alat || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'id-ID'));
    jenisSelect.innerHTML = '<option value="">Semua Jenis</option>' + values.map(value => inputLogOption(value, value, current)).join('');
    if (values.includes(current)) jenisSelect.value = current;
  }
  if (classSelect) {
    const current = classSelect.value;
    const selectedJenis = jenisSelect?.value || '';
    const values = [...new Set(equipment.filter(unit => !selectedJenis || unit.kelas_alat === selectedJenis).map(unit => String(unit.class_unit || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'id-ID',{numeric:true}));
    classSelect.innerHTML = '<option value="">Semua Class</option>' + values.map(value => inputLogOption(value, value, current)).join('');
    if (values.includes(current)) classSelect.value = current;
  }
}

function renderFuelKpis(summary = {}) {
  const host = document.getElementById('fuelKpiGrid');
  if (!host) return;
  const variance = Number(summary.variance_fuel);
  const varianceClass = Number.isFinite(variance) ? (variance > 0 ? 'is-danger' : 'is-good') : '';
  host.innerHTML = `
    <article class="fuel-kpi-card"><span>Fuel Actual</span><strong>${fuelMetric(summary.total_fuel, 0)}</strong><small>Liter periode aktif</small></article>
    <article class="fuel-kpi-card"><span>Fuel Target</span><strong>${fuelMetric(summary.target_fuel, 0)}</strong><small>Fuel Rate × ΔHM</small></article>
    <article class="fuel-kpi-card ${varianceClass}"><span>Variance</span><strong>${fuelMetric(summary.variance_fuel, 0)}</strong><small>${fuelMetric(summary.variance_pct, 1, '%')}</small></article>
    <article class="fuel-kpi-card"><span>Weighted Fuel/HM</span><strong>${fuelMetric(summary.weighted_fuel_per_hm, 2)}</strong><small>Liter/HM</small></article>
    <article class="fuel-kpi-card"><span>Weighted Fuel/KM</span><strong>${fuelMetric(summary.weighted_fuel_per_km, 2)}</strong><small>Liter/KM unit mobile</small></article>
    <article class="fuel-kpi-card ${Number(summary.anomaly_units) ? 'is-warning' : 'is-good'}"><span>Data Alerts</span><strong>${Number(summary.anomaly_units || 0)}</strong><small>${Number(summary.units_with_logs || 0)} dari ${Number(summary.total_units || 0)} unit terisi</small></article>`;
}

function fuelConnectionBadge(card) {
  if (card.anomaly_count > 0) return '<span class="fuel-status-badge is-warning">Perlu diperiksa</span>';
  if (card.log_count > 0) return '<span class="fuel-status-badge is-connected">Terkoneksi</span>';
  return '<span class="fuel-status-badge is-empty">Belum ada data</span>';
}

function renderFuelCardGroups() {
  const host = document.getElementById('fuelCardGroups');
  if (!host) return;
  const cards = fuelCardPayload.cards || [];
  document.getElementById('counterSlicerInputFuel').textContent = `${cards.length} unit`;
  if (!cards.length) {
    host.innerHTML = '<div class="fuel-empty-state"><strong>Tidak ada unit yang sesuai filter.</strong><span>Ubah filter Jenis Alat, Class, atau status.</span></div>';
    return;
  }
  const grouped = new Map();
  cards.forEach(card => {
    const key = card.kelas_alat || 'Jenis Alat Belum Diisi';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(card);
  });
  host.innerHTML = [...grouped.entries()].map(([group, units]) => {
    const collapsed = fuelCollapsedGroups.has(group);
    const groupFuel = units.reduce((sum, unit) => sum + Number(unit.total_fuel || 0), 0);
    return `<section class="fuel-type-group${collapsed ? ' is-collapsed' : ''}" data-fuel-group="${escapeMinePlanning(group)}">
      <button type="button" class="fuel-type-header" onclick="toggleFuelTypeGroup('${escapeMinePlanning(group).replace(/'/g, '&#39;')}')">
        <span><b>${collapsed ? '▶' : '▼'} ${escapeMinePlanning(group)}</b><small>${units.length} unit • ${fuelMetric(groupFuel,0)} Liter</small></span>
        <span>${units.filter(unit => unit.anomaly_count > 0).length} alert</span>
      </button>
      <div class="fuel-unit-list"${collapsed ? ' hidden' : ''}>${units.map(renderFuelUnitCard).join('')}</div>
    </section>`;
  }).join('');
  fuelOpenCards.forEach(id => { if (cards.some(card => String(card.id) === String(id))) void loadFuelCardDetails(id); });
  syncFuelBulkDeleteUi();
}

function renderFuelUnitCard(card) {
  const isOpen = fuelOpenCards.has(String(card.id));
  const variance = Number(card.variance_pct);
  const varianceTone = Number.isFinite(variance) ? (variance > 20 ? 'is-danger' : variance > 0 ? 'is-warning' : 'is-good') : '';
  return `<article class="fuel-unit-card${isOpen ? ' is-open' : ''}" data-fuel-card="${escapeMinePlanning(card.id)}">
    <header class="fuel-unit-card__header" onclick="toggleFuelUnitCard('${escapeMinePlanning(card.id)}')">
      <div class="fuel-unit-identity">
        <span class="fuel-unit-icon">${card.supports_distance ? '🚚' : '⚙'}</span>
        <span><strong>${escapeMinePlanning(card.kode_alat || '—')}</strong><small>${escapeMinePlanning(card.class_unit || 'Class belum diisi')} • ${escapeMinePlanning(card.tipe_alat || 'Model belum diisi')}</small></span>
      </div>
      <div class="fuel-unit-metrics">
        <span><small>Fuel</small><b>${fuelMetric(card.total_fuel,0)} L</b></span>
        <span><small>Std. Fuel Rate</small><b>${fuelMetric(card.fuel_rate_lph,2,' L/HM')}</b></span>
        <span><small>Ltr/HM</small><b>${fuelMetric(card.weighted_fuel_per_hm,2)}</b></span>
        <span><small>${card.supports_distance ? 'Ltr/KM' : 'Target'}</small><b>${card.supports_distance ? fuelMetric(card.weighted_fuel_per_km,2) : fuelMetric(card.target_fuel,0,' L')}</b></span>
        <span class="${varianceTone}"><small>Variance</small><b>${fuelMetric(card.variance_pct,1,'%')}</b></span>
      </div>
      <div class="fuel-unit-status">${fuelConnectionBadge(card)}<b>${isOpen ? '▲' : '▼'}</b></div>
    </header>
    <div class="fuel-unit-card__body"${isOpen ? '' : ' hidden'}>
      <div class="fuel-card-loading">Memuat histori ${escapeMinePlanning(card.kode_alat || '')}…</div>
    </div>
  </article>`;
}

function toggleFuelTypeGroup(group) {
  if (fuelCollapsedGroups.has(group)) fuelCollapsedGroups.delete(group); else fuelCollapsedGroups.add(group);
  renderFuelCardGroups();
}

async function toggleFuelUnitCard(equipmentId) {
  const id = String(equipmentId);
  const cardElement = document.querySelector(`[data-fuel-card="${CSS.escape(id)}"]`);
  if (fuelOpenCards.has(id)) {
    fuelOpenCards.delete(id);
    cardElement?.classList.remove('is-open');
    const body = cardElement?.querySelector('.fuel-unit-card__body');
    if (body) body.hidden = true;
    const arrow = cardElement?.querySelector('.fuel-unit-status > b'); if (arrow) arrow.textContent = '▼';
    return;
  }
  fuelOpenCards.add(id);
  cardElement?.classList.add('is-open');
  const body = cardElement?.querySelector('.fuel-unit-card__body'); if (body) body.hidden = false;
  const arrow = cardElement?.querySelector('.fuel-unit-status > b'); if (arrow) arrow.textContent = '▲';
  await loadFuelCardDetails(id);
}

function fuelTrendSvg(logs) {
  const values = logs.map(log => Number(log.fuel_per_hm)).filter(value => Number.isFinite(value) && value >= 0).slice(-20);
  if (values.length < 2) return '<span class="fuel-trend-empty">Tren tersedia setelah minimal 2 rasio valid.</span>';
  const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1;
  const points = values.map((value,index) => `${(index/(values.length-1))*180},${44-((value-min)/range)*36}`).join(' ');
  return `<svg class="fuel-mini-trend" viewBox="0 0 180 52" role="img" aria-label="Tren Fuel per HM"><polyline points="${points}" fill="none" stroke="#0f766e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

async function loadFuelCardDetails(equipmentId) {
  const card = (fuelCardPayload.cards || []).find(item => String(item.id) === String(equipmentId));
  const element = document.querySelector(`[data-fuel-card="${CSS.escape(String(equipmentId))}"]`);
  const body = element?.querySelector('.fuel-unit-card__body');
  if (!card || !body || body.hidden) return;
  const period = currentFuelPeriod();
  const key = `${period.year}-${period.month}:${equipmentId}`;
  try {
    let payload = fuelDetailCache.get(key);
    if (!payload) {
      const params = new URLSearchParams({ year: period.year, month: period.month, equipment_id: String(equipmentId) });
      const response = await fetch(getProdApiUrl(`/api/admin/production/fuel?${params}`), { headers: { ...getProdAuthHeaders() } });
      payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      fuelDetailCache.set(key, payload);
    }
    body.innerHTML = renderFuelCardDetail(card, payload.logs || [], payload.summary || {});
    applyFuelDraftsToRows();
    bindFuelInlineEditing();
    syncFuelBulkDeleteUi();
  } catch (error) {
    body.innerHTML = `<div class="fuel-card-error">Gagal memuat detail: ${escapeMinePlanning(error.message)}</div>`;
  }
}

function renderFuelCardDetail(card, logs, summary) {
  const inlineDrafts = getFuelInlineDrafts(card.id);
  const persistedRows = logs.map(log => renderFuelLogCardRow(card, log)).join('');
  const pendingRows = inlineDrafts.map(draft => renderFuelInlineRowV2(card, draft.id, draft.fields)).join('');
  const rows = persistedRows || pendingRows ? `${persistedRows}${pendingRows}` : `<tr><td colspan="13" class="fuel-card-empty-row">Belum ada pengisian pada ${fuelMonthName(currentFuelPeriod().month)} ${currentFuelPeriod().year}. Tekan + Insert Data untuk mulai mengisi.</td></tr>`;
  return `<div class="fuel-card-toolbar">
      <div class="fuel-card-trend"><span><b>Weighted ${fuelMetric(summary.weightedFuelPerHm,2)} L/HM</b><small>${logs.length} transaksi • ${fuelMetric(summary.totalFuelFilled,0)} Liter</small></span>${fuelTrendSvg(logs)}</div>
      <div><button class="tombol tombol--ghost" onclick="event.stopPropagation();tambahFuelInlineRow('${escapeMinePlanning(card.id)}')">+ Insert Data</button></div>
    </div>
    <div class="fuel-card-table-wrap"><table class="fuel-card-table">
      <thead><tr><th data-fuel-delete-column${fuelBulkDeleteMode ? '' : ' hidden'}>Pilih</th><th>Tanggal</th><th>Shift</th><th>HM</th><th>ΔHM</th><th>KM</th><th>ΔKM</th><th>Fuel (L)</th><th>Ltr/HM</th><th>Ltr/KM</th><th>Variance</th><th>Status</th><th>Keterangan</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th colspan="7">Weighted Summary — ${escapeMinePlanning(card.kode_alat)}</th><th>${fuelMetric(summary.totalFuelFilled,0)}</th><th>${fuelMetric(summary.weightedFuelPerHm,2)}</th><th>${card.supports_distance ? fuelMetric(summary.weightedFuelPerKm,2) : 'N/A'}</th><th colspan="3">ΔHM ${fuelMetric(summary.totalHm,2)} • ΔKM ${fuelMetric(summary.totalDistance,2)}</th></tr></tfoot>
    </table></div>`;
}

function renderFuelLogCardRow(card, log) {
  const warnings = Array.isArray(log.computed_warnings) ? log.computed_warnings : [];
  const status = log.computed_status || (warnings.length ? 'warning' : 'normal');
  const statusText = status === 'critical' ? 'Anomali' : status === 'warning' ? 'Periksa' : 'Normal';
  const previousHm = log.previous_hm ?? '';
  const previousKm = log.previous_km ?? '';
  return `<tr data-fuel-row data-fuel-id="${escapeMinePlanning(log.id)}" data-equipment-id="${escapeMinePlanning(card.id)}" data-previous-hm="${escapeMinePlanning(previousHm)}" data-previous-km="${escapeMinePlanning(previousKm)}" data-fuel-rate="${escapeMinePlanning(card.fuel_rate_lph ?? '')}" data-supports-distance="${card.supports_distance ? 'true' : 'false'}" data-anomaly="${escapeMinePlanning(status)}">
    <td data-fuel-delete-column${fuelBulkDeleteMode ? '' : ' hidden'}><input type="checkbox" data-fuel-select value="${escapeMinePlanning(log.id)}" onchange="toggleFuelSelection('${escapeMinePlanning(log.id)}',this.checked)" /></td>
    <td><input data-fuel-field="equipment_id" type="hidden" value="${escapeMinePlanning(card.id)}"/><input data-fuel-field="tanggal" type="date" value="${escapeMinePlanning(String(log.tanggal || '').split('T')[0])}" required/></td>
    <td><select data-fuel-field="shift_id" required>${inputLogShiftOptions(log.shift_id)}</select></td>
    <td><input data-fuel-field="hm_reading" type="number" min="0" step="0.01" value="${escapeMinePlanning(log.hm_reading ?? '')}" required/></td>
    <td><output data-fuel-output="hm_delta">${fuelMetric(log.hm_delta,2)}</output></td>
    <td><input data-fuel-field="odometer_reading" type="number" min="0" step="0.01" value="${escapeMinePlanning(log.odometer_reading ?? '')}" placeholder="${card.supports_distance ? 'Wajib' : 'Opsional'}"/></td>
    <td><output data-fuel-output="distance_km">${fuelMetric(log.distance_km,2)}</output></td>
    <td><input data-fuel-field="fuel_filled" type="number" min="0.01" step="0.01" value="${escapeMinePlanning(log.fuel_filled ?? '')}" required/></td>
    <td><output data-fuel-output="fuel_per_hm">${fuelMetric(log.fuel_per_hm,2)}</output></td>
    <td><output data-fuel-output="fuel_per_km">${card.supports_distance ? fuelMetric(log.fuel_per_km,2) : 'N/A'}</output></td>
    <td><output data-fuel-output="variance_pct" class="${Number(log.variance_pct) > 20 ? 'is-danger' : ''}">${fuelMetric(log.variance_pct,1,'%')}</output></td>
    <td><div class="fuel-row-status"><span class="fuel-row-anomaly is-${escapeMinePlanning(status)}" title="${escapeMinePlanning(warnings.join(', '))}">${statusText}</span><select data-fuel-approval onchange="setFuelApproval('${escapeMinePlanning(log.id)}',this.value)"><option value="draft"${log.approval_status === 'draft' ? ' selected' : ''}>Draft</option><option value="submitted"${log.approval_status === 'submitted' ? ' selected' : ''}>Submitted</option><option value="verified"${log.approval_status === 'verified' ? ' selected' : ''}>Verified</option><option value="rejected"${log.approval_status === 'rejected' ? ' selected' : ''}>Rejected</option></select><button type="button" onclick="bukaFuelAudit('${escapeMinePlanning(log.id)}')" title="Audit trail">↗</button></div></td>
    <td><input data-fuel-field="fuel_ticket_no" type="text" value="${escapeMinePlanning(log.fuel_ticket_no || '')}" placeholder="Ticket"/><input data-fuel-field="remark" type="text" value="${escapeMinePlanning(log.remark || '')}" placeholder="Keterangan"/><input data-fuel-field="is_meter_reset" type="hidden" value="${log.is_meter_reset ? 'true' : 'false'}"/><input data-fuel-field="meter_reset_reason" type="hidden" value="${escapeMinePlanning(log.meter_reset_reason || '')}"/></td>
  </tr>`;
}

function renderFuelInlineRow(card, draftId, fields) {
  const values = fields || {};
  return `<tr class="fuel-inline-new-row" data-fuel-row data-fuel-id="${escapeMinePlanning(draftId)}" data-equipment-id="${escapeMinePlanning(card.id)}" data-previous-hm="" data-previous-km="" data-fuel-rate="${escapeMinePlanning(card.fuel_rate_lph ?? '')}" data-supports-distance="${card.supports_distance ? 'true' : 'false'}">
    <td data-fuel-delete-column hidden></td>
    <td><input data-fuel-field="equipment_id" type="hidden" value="${escapeMinePlanning(card.id)}"/><input data-fuel-field="tanggal" type="date" value="${escapeMinePlanning(values.tanggal || getLocalDateInputValue())}" required/></td>
    <td><select data-fuel-field="shift_id" required>${inputLogShiftOptions(values.shift_id || '')}</select></td>
    <td><input data-fuel-field="hm_reading" type="number" min="0" step="0.01" value="${escapeMinePlanning(values.hm_reading ?? '')}" placeholder="Isi HM" required/></td>
    <td><output data-fuel-output="hm_delta">â€”</output></td>
    <td><input data-fuel-field="odometer_reading" type="number" min="0" step="0.01" value="${escapeMinePlanning(values.odometer_reading ?? '')}" placeholder="${card.supports_distance ? 'Wajib' : 'Opsional'}"/></td>
    <td><output data-fuel-output="distance_km">â€”</output></td>
    <td><input data-fuel-field="fuel_filled" type="number" min="0.01" step="0.01" value="${escapeMinePlanning(values.fuel_filled ?? '')}" placeholder="Isi Liter" required/></td>
    <td><output data-fuel-output="fuel_per_hm">â€”</output></td>
    <td><output data-fuel-output="fuel_per_km">${card.supports_distance ? 'â€”' : 'N/A'}</output></td>
    <td><output data-fuel-output="variance_pct">â€”</output></td>
    <td><span class="fuel-row-anomaly is-normal">Baru</span></td>
    <td><input data-fuel-field="fuel_ticket_no" type="text" value="${escapeMinePlanning(values.fuel_ticket_no || '')}" placeholder="Ticket"/><input data-fuel-field="remark" type="text" value="${escapeMinePlanning(values.remark || '')}" placeholder="Keterangan"/><input data-fuel-field="is_meter_reset" type="hidden" value="false"/><input data-fuel-field="meter_reset_reason" type="hidden" value=""/><button class="fuel-inline-cancel" type="button" onclick="hapusFuelInlineRow('${escapeMinePlanning(draftId)}')" title="Batalkan baris baru">×</button></td>
  </tr>`;
}

function renderFuelInlineRowV2(card, draftId, fields) {
  const values = fields || {};
  return `<tr class="fuel-inline-new-row" data-fuel-row data-fuel-id="${escapeMinePlanning(draftId)}" data-equipment-id="${escapeMinePlanning(card.id)}" data-previous-hm="" data-previous-km="" data-fuel-rate="${escapeMinePlanning(card.fuel_rate_lph ?? '')}" data-supports-distance="${card.supports_distance ? 'true' : 'false'}">
    <td data-fuel-delete-column hidden></td>
    <td><input data-fuel-field="equipment_id" type="hidden" value="${escapeMinePlanning(card.id)}"/><div class="fuel-inline-date"><input data-fuel-field="tanggal" type="date" value="${escapeMinePlanning(values.tanggal || getLocalDateInputValue())}" required/><button class="fuel-inline-cancel" type="button" onclick="hapusFuelInlineRow('${escapeMinePlanning(draftId)}')" title="Batalkan baris baru" aria-label="Batalkan baris baru">&minus;</button></div></td>
    <td><select data-fuel-field="shift_id" required>${inputLogShiftOptions(values.shift_id || '')}</select></td>
    <td><input data-fuel-field="hm_reading" type="number" min="0" step="0.01" value="${escapeMinePlanning(values.hm_reading ?? '')}" placeholder="Isi HM" required/></td>
    <td><output data-fuel-output="hm_delta">&nbsp;</output></td>
    <td><input data-fuel-field="odometer_reading" type="number" min="0" step="0.01" value="${escapeMinePlanning(values.odometer_reading ?? '')}" placeholder="${card.supports_distance ? 'Wajib' : 'Opsional'}"/></td>
    <td><output data-fuel-output="distance_km">&nbsp;</output></td>
    <td><input data-fuel-field="fuel_filled" type="number" min="0.01" step="0.01" value="${escapeMinePlanning(values.fuel_filled ?? '')}" placeholder="Isi Liter" required/></td>
    <td><output data-fuel-output="fuel_per_hm">&nbsp;</output></td>
    <td><output data-fuel-output="fuel_per_km">&nbsp;</output></td>
    <td><output data-fuel-output="variance_pct">&nbsp;</output></td>
    <td><span class="fuel-row-anomaly is-normal">Baru</span></td>
    <td><input data-fuel-field="fuel_ticket_no" type="text" value="${escapeMinePlanning(values.fuel_ticket_no || '')}" placeholder="Ticket"/><input data-fuel-field="remark" type="text" value="${escapeMinePlanning(values.remark || '')}" placeholder="Keterangan"/><input data-fuel-field="is_meter_reset" type="hidden" value="false"/><input data-fuel-field="meter_reset_reason" type="hidden" value=""/></td>
  </tr>`;
}

function tambahFuelInlineRow(equipmentId) {
  const card = (fuelCardPayload.cards || []).find(item => String(item.id) === String(equipmentId));
  const period = currentFuelPeriod();
  const payload = fuelDetailCache.get(`${period.year}-${period.month}:${equipmentId}`);
  if (!card || !payload) return void loadFuelCardDetails(equipmentId);
  const latest = (payload.logs || []).reduce((candidate, log) => !candidate || String(log.tanggal || '') > String(candidate.tanggal || '') ? log : candidate, null);
  const draftId = fuelInlineDraftKey();
  fuelDrafts.set(draftId, { fields: {
    equipment_id: String(equipmentId), tanggal: nextCalendarDate(latest?.tanggal), shift_id: '',
    hm_reading: '', odometer_reading: '', fuel_filled: '', fuel_ticket_no: '', remark: '',
    is_meter_reset: 'false', meter_reset_reason: '',
  }, updatedAt: new Date().toISOString() });
  persistFuelDrafts();
  const body = document.querySelector(`[data-fuel-card="${CSS.escape(String(equipmentId))}"] .fuel-unit-card__body`);
  if (!body) return;
  body.innerHTML = renderFuelCardDetail(card, payload.logs || [], payload.summary || {});
  bindFuelInlineEditing();
  body.querySelector(`[data-fuel-id="${CSS.escape(draftId)}"] [data-fuel-field="hm_reading"]`)?.focus();
}

function hapusFuelInlineRow(draftId) {
  const row = document.querySelector(`[data-fuel-id="${CSS.escape(String(draftId))}"]`);
  const equipmentId = row?.dataset.equipmentId;
  fuelDrafts.delete(String(draftId));
  persistFuelDrafts();
  if (equipmentId) void loadFuelCardDetails(equipmentId);
}

async function muatProdInputFuel() {
  const host = document.getElementById('fuelCardGroups');
  if (!host) return;
  host.innerHTML = '<div class="fuel-loading-state">Memuat kartu unit dan kalkulasi Fuel…</div>';
  try {
    if (!fuelPeriodInitialized) {
      const today = new Date();
      document.getElementById('slicerFuelTahun').value = String(today.getFullYear());
      document.getElementById('slicerFuelBulan').value = String(today.getMonth() + 1).padStart(2, '0');
      // Halaman selalu dibuka netral. Filter unit terakhir tidak dibawa ke
      // sesi baru agar seluruh kartu unit langsung terlihat.
      const kodeFilter = document.getElementById('slicerFuelKode');
      const jenisFilter = document.getElementById('slicerFuelJenis');
      const classFilter = document.getElementById('slicerFuelClass');
      const statusFilter = document.getElementById('slicerFuelStatus');
      if (kodeFilter) kodeFilter.value = '';
      if (jenisFilter) jenisFilter.value = '';
      if (classFilter) classFilter.value = '';
      if (statusFilter) statusFilter.value = '';
      fuelPeriodInitialized = true;
      const periodsResponse = await fetch(getProdApiUrl('/api/admin/production/fuel-periods'), { headers: { ...getProdAuthHeaders() } });
      if (periodsResponse.ok) cachedFuelPeriods = await periodsResponse.json();
    }
    if (!(masterProdData.equipment || []).length) await muatMasterDataProduksi();
    syncFuelCardFilterOptions();
    const period = currentFuelPeriod();
    const yearSelect = document.getElementById('slicerFuelTahun');
    const years = [...new Set([String(new Date().getFullYear()), ...cachedFuelPeriods.map(item => String(item.year))])].sort((a,b) => Number(b)-Number(a));
    const currentYear = period.year;
    yearSelect.innerHTML = years.map(year => inputLogOption(year, year, currentYear)).join('');
    if (years.includes(currentYear)) yearSelect.value = currentYear;
    const params = new URLSearchParams({ year: yearSelect.value, month: period.month });
    const search = document.getElementById('slicerFuelKode')?.value.trim();
    const jenis = document.getElementById('slicerFuelJenis')?.value;
    const classUnit = document.getElementById('slicerFuelClass')?.value;
    const status = document.getElementById('slicerFuelStatus')?.value;
    if (search) params.set('q', search); if (jenis) params.set('jenis', jenis); if (classUnit) params.set('class_unit', classUnit); if (status) params.set('status', status);
    const response = await fetch(getProdApiUrl(`/api/admin/production/fuel-cards?${params}`), { headers: { ...getProdAuthHeaders() } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    fuelCardPayload = payload;
    if (!fuelDefaultCollapseInitialized) {
      (payload.cards || []).forEach(card => fuelCollapsedGroups.add(card.kelas_alat || 'Jenis Alat Belum Diisi'));
      fuelOpenCards.clear();
      fuelDefaultCollapseInitialized = true;
    }
    cachedFuelLogs = [];
    renderFuelKpis(payload.summary);
    renderFuelCardGroups();
    updateFuelSaveUi(); updateFuelHistoryButtons();
    if (fuelDrafts.size && !fuelDraftRecoveryPrompted) {
      fuelDraftRecoveryPrompted = true;
      const action = await showFuelUnsavedDialog('melanjutkan setelah halaman dimuat ulang');
      if (action === 'save') await simpanPerubahanFuel(); else { clearFuelDrafts(); renderFuelCardGroups(); }
    }
  } catch (error) {
    host.innerHTML = `<div class="fuel-card-error">Gagal memuat kartu Fuel: ${escapeMinePlanning(error.message)}</div>`;
  }
}

function terapkanSlicerInputFuel() { renderFuelCardGroups(); }

function resetSlicerInputFuel() {
  document.getElementById('slicerFuelKode').value = '';
  document.getElementById('slicerFuelJenis').value = '';
  document.getElementById('slicerFuelClass').value = '';
  document.getElementById('slicerFuelStatus').value = '';
  void muatProdInputFuel();
}

function updateFuelCalculatedFields(row) {
  const value = name => {
    const raw = row.querySelector(`[data-fuel-field="${name}"]`)?.value;
    return raw === '' || raw == null ? null : Number(raw);
  };
  const hm = value('hm_reading'); const km = value('odometer_reading'); const fuel = value('fuel_filled');
  const previousHm = row.dataset.previousHm === '' ? null : Number(row.dataset.previousHm);
  const previousKm = row.dataset.previousKm === '' ? null : Number(row.dataset.previousKm);
  const rate = row.dataset.fuelRate === '' ? null : Number(row.dataset.fuelRate);
  const reset = row.querySelector('[data-fuel-field="is_meter_reset"]')?.value === 'true';
  const hmDelta = !reset && hm !== null && previousHm !== null && hm > previousHm ? hm - previousHm : null;
  const distance = !reset && km !== null && previousKm !== null && km > previousKm ? km - previousKm : null;
  const perHm = hmDelta > 0 && fuel !== null ? fuel / hmDelta : null;
  const perKm = distance > 0 && fuel !== null ? fuel / distance : null;
  const target = hmDelta > 0 && Number.isFinite(rate) ? rate * hmDelta : null;
  const variancePct = target > 0 && fuel !== null ? (fuel-target)/target*100 : null;
  const output = (name,text) => { const targetOutput=row.querySelector(`[data-fuel-output="${name}"]`); if(targetOutput) targetOutput.textContent=text; };
  const display = (value, digits = 2, suffix = '') => value === null || value === undefined ? '' : fuelMetric(value, digits, suffix);
  output('hm_delta',display(hmDelta)); output('distance_km',display(distance)); output('fuel_per_hm',display(perHm)); output('fuel_per_km',row.dataset.supportsDistance === 'true' ? display(perKm) : ''); output('variance_pct',display(variancePct,1,'%'));
  const invalid = hm === null || fuel === null || fuel <= 0 || (!reset && previousHm !== null && hm <= previousHm) || (row.dataset.supportsDistance === 'true' && km === null);
  row.dataset.validationError = invalid ? 'true' : 'false';
  return { valid: !invalid };
}

function applyFuelDraftsToRows() {
  document.querySelectorAll('#fuelCardGroups [data-fuel-row]').forEach(row => {
    const draft = fuelDrafts.get(String(row.dataset.fuelId));
    if (!draft?.fields) return;
    Object.entries(draft.fields).forEach(([name,value]) => { const field=row.querySelector(`[data-fuel-field="${name}"]`); if(field) field.value=value; });
    updateFuelCalculatedFields(row); row.dataset.saveState='dirty';
  });
}

function bindFuelInlineEditing() {
  const host = document.getElementById('fuelCardGroups');
  if (!host || host.dataset.fuelEditingBound) return;
  host.dataset.fuelEditingBound='true';
  host.addEventListener('focusin',event => { const field=event.target.closest('[data-fuel-field]'); const row=field?.closest('[data-fuel-row]'); if(field&&row&&!field.readOnly) fuelEditStarts.set(field,captureFuelRow(row)); });
  host.addEventListener('focusout',event => { const field=event.target.closest('[data-fuel-field]'); const row=field?.closest('[data-fuel-row]'); const before=field?fuelEditStarts.get(field):null; if(!field||!row||!before)return; fuelEditStarts.delete(field); const after=captureFuelRow(row); if(!String(row.dataset.fuelId || '').startsWith('new:') && !fuelSnapshotsEqual(before,after)) pushFuelHistory({type:'edit',logId:String(row.dataset.fuelId),before,after,label:`Edit ${field.dataset.fuelField}`}); });
  const handle=event => { const field=event.target.closest('[data-fuel-field]'); const row=field?.closest('[data-fuel-row]'); if(!field||!row||field.readOnly)return; updateFuelCalculatedFields(row); markFuelRowDirty(row); };
  host.addEventListener('input',handle); host.addEventListener('change',handle);
}

async function persistFuelDraft(logId,draft) {
  const fields=draft?.fields||{};
  const required=['tanggal','shift_id','equipment_id','hm_reading','fuel_filled'];
  const missing=required.filter(name=>fields[name]===undefined||fields[name]===null||String(fields[name]).trim()==='');
  if(missing.length) throw new Error(`Kolom wajib belum lengkap: ${missing.join(', ')}`);
  const isNew = String(logId).startsWith('new:');
  const response=await fetch(getProdApiUrl(isNew ? '/api/admin/production/fuel' : `/api/admin/production/fuel/${encodeURIComponent(logId)}`),{method:isNew ? 'POST' : 'PATCH',headers:{'Content-Type':'application/json',...getProdAuthHeaders()},body:JSON.stringify({...fields,source_type:'manual'})});
  const data=await response.json().catch(()=>({})); if(!response.ok) throw new Error(data.error||`HTTP ${response.status}`); return data;
}

async function setFuelApproval(logId,status) {
  try {
    const response=await fetch(getProdApiUrl(`/api/admin/production/fuel/${encodeURIComponent(logId)}/approval`),{method:'PATCH',headers:{'Content-Type':'application/json',...getProdAuthHeaders()},body:JSON.stringify({status})});
    const data=await response.json().catch(()=>({})); if(!response.ok) throw new Error(data.error||`HTTP ${response.status}`);
    invalidateFuelDetailCache(); await muatProdInputFuel();
  } catch(error){ alert(`Gagal mengubah approval: ${error.message}`); }
}

async function bukaFuelAudit(logId) {
  const overlay=document.getElementById('modalOverlay'); const konten=document.getElementById('modalKonten'); if(!overlay||!konten)return;
  konten.innerHTML='<div class="fuel-loading-state">Memuat audit trail…</div>'; overlay.hidden=false;
  try {
    const response=await fetch(getProdApiUrl(`/api/admin/production/fuel/${encodeURIComponent(logId)}/audit`),{headers:{...getProdAuthHeaders()}});
    const logs=await response.json(); if(!response.ok) throw new Error(logs.error||`HTTP ${response.status}`);
    konten.innerHTML=`<h3>Audit Trail Fuel</h3><div class="fuel-audit-list">${logs.length?logs.map(item=>`<article><b>${escapeMinePlanning(item.action)}</b><span>${new Date(item.changed_at).toLocaleString('id-ID')}</span><small>${escapeMinePlanning(item.changed_by_name||'Sistem')}</small></article>`).join(''):'<p>Belum ada riwayat audit.</p>'}</div><div style="text-align:right;margin-top:14px"><button class="tombol" onclick="tutupModalGenerik()">Tutup</button></div>`;
  }catch(error){konten.innerHTML=`<div class="fuel-card-error">${escapeMinePlanning(error.message)}</div>`;}
}

async function exportFuelExcel() {
  if(!window.XLSX)return alert('Library Excel belum siap.');
  try{
    const period=currentFuelPeriod(); const response=await fetch(getProdApiUrl(`/api/admin/production/fuel?year=${period.year}&month=${period.month}`),{headers:{...getProdAuthHeaders()}}); const payload=await response.json(); if(!response.ok)throw new Error(payload.error||`HTTP ${response.status}`);
    const headers=['Tanggal','Shift','Kode Unit','Jenis Alat','Class','Tipe Model','HM Reading','KM Reading','Fuel Diisikan (L)','Ltr/Jam','Ltr/Km','Target Fuel (L)','Variance (%)','Approval','Fuel Ticket','Keterangan'];
    const values=(payload.logs||[]).map(log=>[String(log.tanggal||'').split('T')[0],formatInputShiftLabel(log.nama_shift),log.kode_alat,log.kelas_alat,log.class_unit,log.tipe_alat,log.hm_reading,log.odometer_reading??'',log.fuel_filled,log.fuel_per_hm??'',log.fuel_per_km??'',log.target_fuel??'',log.variance_pct??'',log.approval_status||'draft',log.fuel_ticket_no||'',log.remark||'']);
    const sheet=XLSX.utils.aoa_to_sheet([headers,...values]); sheet['!cols']=[13,10,16,16,16,24,12,12,16,12,12,16,14,14,18,32].map(wch=>({wch})); sheet['!autofilter']={ref:`A1:P${values.length+1}`};
    const book=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book,sheet,'Fuel Logs'); XLSX.writeFile(book,`OMOS_Fuel_Card_${period.year}-${period.month}.xlsx`);
  }catch(error){alert(`Export Fuel gagal: ${error.message}`);}
}

async function importFuelExcel(file) {
  if(!file)return; if(!window.XLSX)return alert('Library Excel belum siap.'); if(fuelDrafts.size)return alert('Simpan atau abaikan draft sebelum import.');
  try{
    if(!(masterProdData.equipment||[]).length)await muatMasterDataProduksi();
    const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true,raw:true}); const sheet=workbook.Sheets[workbook.SheetNames.includes('Fuel Logs')?'Fuel Logs':workbook.SheetNames[0]]; const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});
    const headerIndex=matrix.findIndex(row=>row.map(value=>normalizeWorkLogImportText(value).toUpperCase()).includes('KODE UNIT')); if(headerIndex<0)throw new Error('Gunakan format Export terbaru dari Input Fuel.');
    const rows=matrix.slice(headerIndex+1).map((values,index)=>({values,excelRow:headerIndex+index+2})).filter(row=>row.values.some(value=>normalizeWorkLogImportText(value)!=='')); if(!rows.length||rows.length>500)throw new Error(rows.length?'Maksimal 500 baris per import.':'File tidak memiliki data.');
    const errors=[]; const payloads=[]; const keys=new Set();
    rows.forEach(({values,excelRow})=>{const tanggal=workLogExcelDateToIso(values[0]);const shift=resolveWorkLogImportShift(values[1]);const code=normalizeWorkLogImportText(values[2]);const unit=(masterProdData.equipment||[]).find(item=>String(item.kode_alat||'').trim().toLowerCase()===code.toLowerCase());const hm=parseWorkLogImportNumber(values[6]);const km=normalizeWorkLogImportText(values[7])===''?null:parseWorkLogImportNumber(values[7]);const fuel=parseWorkLogImportNumber(values[8]);const rowErrors=[];if(!tanggal)rowErrors.push('Tanggal tidak valid');if(!shift)rowErrors.push('Shift tidak valid');if(!unit)rowErrors.push('Unit tidak ditemukan');if(!Number.isFinite(hm)||hm<0)rowErrors.push('HM tidak valid');if(km!==null&&(!Number.isFinite(km)||km<0))rowErrors.push('KM tidak valid');if(!Number.isFinite(fuel)||fuel<=0)rowErrors.push('Fuel harus > 0');const key=unit&&shift&&tanggal?`${tanggal}|${shift.id}|${unit.id}`:'';if(key&&keys.has(key))rowErrors.push('Duplikat unit/tanggal/shift dalam file');if(key)keys.add(key);if(rowErrors.length)errors.push(`Baris ${excelRow}: ${rowErrors.join(', ')}`);else payloads.push({excelRow,data:{tanggal,shift_id:shift.id,equipment_id:unit.id,hm_reading:hm,odometer_reading:km,fuel_filled:fuel,fuel_ticket_no:normalizeWorkLogImportText(values[14]),remark:normalizeWorkLogImportText(values[15]),source_type:'import'}});});
    if(errors.length)throw new Error(`Validasi gagal:\n${errors.slice(0,12).join('\n')}${errors.length>12?`\n...dan ${errors.length-12} baris lainnya.`:''}`);if(!confirm(`Import ${payloads.length} pengisian Fuel dari "${file.name}"?\n\nFormula rasio dan anomaly akan dihitung ulang oleh sistem.`))return;
    const createdIds=[];const failures=[];for(const item of payloads){const response=await fetch(getProdApiUrl('/api/admin/production/fuel'),{method:'POST',headers:{'Content-Type':'application/json',...getProdAuthHeaders()},body:JSON.stringify(item.data)});const result=await response.json().catch(()=>({}));if(response.ok&&result.id)createdIds.push(String(result.id));else failures.push(`Baris ${item.excelRow}: ${result.error||`HTTP ${response.status}`}`);}if(createdIds.length){pushFuelHistory({type:'create',ids:createdIds,label:`Import ${createdIds.length} Fuel`});invalidateFuelDetailCache();await muatProdInputFuel();}alert(`${createdIds.length} berhasil diimport.${failures.length?`\n${failures.length} gagal:\n${failures.slice(0,10).join('\n')}`:''}`);
  }catch(error){alert(`Import Fuel gagal:\n${error.message}`);}
}

function bukaModalInputFuel(preselectedEquipmentId='') {
  const overlay=document.getElementById('modalOverlay');const konten=document.getElementById('modalKonten');if(!overlay||!konten)return;
  const equipmentOptions=inputLogEquipmentOptions(preselectedEquipmentId);const shiftOptions=inputLogShiftOptions('');
  konten.innerHTML=`<h3 style="margin-top:0">⛽ Pengisian Fuel Aktual</h3><p class="fuel-modal-note">HM dan KM adalah pembacaan counter aktual pada saat pengisian. Sistem menghitung selisih terhadap pembacaan sebelumnya.</p><form id="formInputFuelCard">
    <div class="fuel-modal-grid"><label>Tanggal<input id="ifcTanggal" type="date" value="${getLocalDateInputValue()}" required/></label><label>Shift<select id="ifcShift" required>${shiftOptions}</select></label><label class="is-wide">Kode Unit<select id="ifcEquipment" required>${equipmentOptions}</select></label><label>HM Aktual<input id="ifcHm" type="number" min="0" step="0.01" required/></label><label>KM/Odometer<input id="ifcKm" type="number" min="0" step="0.01" placeholder="Unit mobile"/></label><label>Fuel Diisikan (Liter)<input id="ifcFuel" type="number" min="0.01" step="0.01" required/></label><label>Fuel Ticket<input id="ifcTicket" type="text" placeholder="Nomor voucher/ticket"/></label><label class="is-wide">Keterangan<input id="ifcRemark" type="text" placeholder="Lokasi dispenser atau catatan pengisian"/></label><label class="is-wide fuel-reset-check"><input id="ifcReset" type="checkbox" onchange="document.getElementById('ifcResetReason').disabled=!this.checked"/> Reset/penggantian HM atau odometer</label><label class="is-wide">Alasan reset<input id="ifcResetReason" type="text" disabled placeholder="Wajib jika counter di-reset"/></label><label class="is-wide">URL Lampiran<input id="ifcAttachment" type="url" placeholder="Opsional: tautan foto voucher/meter"/></label></div>
    <div class="fuel-modal-actions"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Pengisian</button></div></form>`;
  overlay.hidden=false;
  document.getElementById('formInputFuelCard').addEventListener('submit',async event=>{event.preventDefault();const bodyData={tanggal:document.getElementById('ifcTanggal').value,shift_id:document.getElementById('ifcShift').value,equipment_id:document.getElementById('ifcEquipment').value,hm_reading:document.getElementById('ifcHm').value,odometer_reading:document.getElementById('ifcKm').value||null,fuel_filled:document.getElementById('ifcFuel').value,fuel_ticket_no:document.getElementById('ifcTicket').value,remark:document.getElementById('ifcRemark').value,is_meter_reset:document.getElementById('ifcReset').checked,meter_reset_reason:document.getElementById('ifcResetReason').value,attachment_url:document.getElementById('ifcAttachment').value,source_type:'manual'};try{const response=await fetch(getProdApiUrl('/api/admin/production/fuel'),{method:'POST',headers:{'Content-Type':'application/json',...getProdAuthHeaders()},body:JSON.stringify(bodyData)});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||`HTTP ${response.status}`);tutupModalGenerik();if(result.id)pushFuelHistory({type:'create',ids:[String(result.id)],label:'Tambah Pengisian Fuel'});invalidateFuelDetailCache();fuelOpenCards.add(String(bodyData.equipment_id));await muatProdInputFuel();}catch(error){alert(`Gagal menyimpan Fuel: ${error.message}`);}});
}

// -------------------------------------------------------------
// 3. STANDBY
// -------------------------------------------------------------
async function muatProdStandby() {
  const tbody = document.getElementById('tbodyProdStandby');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="tabel__kosong">Memuat log standby...</td></tr>';

  try {
    if (!(masterProdData.equipment || []).length || !(masterProdData.shifts || []).length || !(masterProdData.standbyCodes || []).length) {
      await muatMasterDataProduksi();
    }

    const selTahun = document.getElementById('slicerStandbyTahun');
    const selBulan = document.getElementById('slicerStandbyBulan');
    if (!standbyPeriodInitialized) {
      const today = new Date();
      if (selTahun) selTahun.value = String(today.getFullYear());
      if (selBulan) selBulan.value = String(today.getMonth() + 1).padStart(2, '0');
      standbyPeriodInitialized = true;
    }

    const periodParams = new URLSearchParams();
    const selectedYear = selTahun?.value || '';
    const selectedMonth = selBulan?.value || '';
    if (selectedYear) periodParams.set('year', selectedYear);
    if (selectedYear && selectedMonth) periodParams.set('month', selectedMonth);
    const periodQuery = periodParams.toString();

    const res = await fetch(getProdApiUrl(`/api/admin/production/standby${periodQuery ? `?${periodQuery}` : ''}`), {
      headers: { ...getProdAuthHeaders() }
    });
    if (!res.ok) throw new Error(`Standby HTTP ${res.status}`);
    const data = await res.json();
    cachedStandbyLogs = Array.isArray(data.logs) ? data.logs : [];

    isiDropdownSlicerStandby();
    bindStandbyInlineEditing();
    terapkanSlicerStandby();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="teks-error">Gagal memuat standby logs: ${err.message}</td></tr>`;
  }
}

function isiDropdownSlicerStandby() {
  const logs = cachedStandbyLogs;

  // Slicer Utama Tahun
  const selTahun = document.getElementById('slicerStandbyTahun');
  if (selTahun) {
    const curVal = selTahun.value;
    const years = Array.from(new Set(logs.map(l => l.tanggal ? String(l.tanggal).split('T')[0].split('-')[0] : '').filter(Boolean))).sort((a, b) => Number(b) - Number(a));
    if (years.length > 0 || curVal) {
      selTahun.innerHTML = '<option value="">Semua Tahun</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
      if (curVal && years.includes(curVal)) selTahun.value = curVal;
    }
  }

  // Slicer Kode Unit
  const selKode = document.getElementById('slicerStandbyKode');
  if (selKode) {
    const curVal = selKode.value;
    const list = Array.from(new Set(logs.map(l => l.kode_alat).filter(Boolean))).sort();
    selKode.innerHTML = '<option value="">Semua Kode Unit</option>' + list.map(k => `<option value="${k}">${k}</option>`).join('');
    if (curVal && list.includes(curVal)) selKode.value = curVal;
  }

  // Slicer Shift
  const selShift = document.getElementById('slicerStandbyShift');
  if (selShift) {
    const curVal = selShift.value;
    const list = dayNightShifts();
    selShift.innerHTML = '<option value="">Semua Shift</option>' + list.map(s => {
      const isSiang = String(s.nama_shift || '').toLowerCase().includes('siang');
      return `<option value="${s.id}"${String(s.id) === curVal ? ' selected' : ''}>${isSiang ? 'Siang' : 'Malam'}</option>`;
    }).join('');
    if (curVal && list.some(s => String(s.id) === curVal)) selShift.value = curVal;
  }
}

function terapkanSlicerStandby() {
  const tbody = document.getElementById('tbodyProdStandby');
  const counter = document.getElementById('counterSlicerStandby');
  if (!tbody) return;

  const tglVal = document.getElementById('slicerStandbyTanggal')?.value || '';
  const kodeVal = document.getElementById('slicerStandbyKode')?.value || '';
  const shiftVal = document.getElementById('slicerStandbyShift')?.value || '';

  let logs = [...cachedStandbyLogs];
  if (tglVal) logs = logs.filter(l => (l.tanggal ? String(l.tanggal).split('T')[0] : '') === tglVal);
  if (kodeVal) logs = logs.filter(l => l.kode_alat === kodeVal);
  if (shiftVal) logs = logs.filter(l => String(l.shift_id) === shiftVal);

  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="tabel__kosong">Belum ada log standby unit.</td></tr>';
  } else {
    tbody.innerHTML = logs.map(row => {
      const resolvedClass = standbyResolveEquipmentClass(row.equipment_id, row.class_unit);
      return `
      <tr data-standby-log-row data-log-id="${escapeMinePlanning(row.id)}">
        <td><input type="date" data-standby-field="tanggal" value="${escapeMinePlanning(String(row.tanggal || '').split('T')[0])}" required /></td>
        <td><select data-standby-field="shift_id" required>${standbyShiftOptions(row.shift_id)}</select></td>
        <td><select data-standby-field="equipment_id" required>${standbyEquipmentOptions(row.equipment_id, resolvedClass)}</select></td>
        <td><select data-standby-field="class_filter" required>${standbyClassOptions(resolvedClass)}</select></td>
        <td><select data-standby-field="standby_code_id" required>${standbyCodeOptions(row.standby_code_id)}</select></td>
        <td data-standby-kategori>${escapeMinePlanning(row.kategori_standby || '')}</td>
        <td><input type="text" inputmode="numeric" data-standby-field="start_time" value="${escapeMinePlanning(toTimeValue(row.start_time))}" placeholder="HH:MM" required /></td>
        <td><input type="text" inputmode="numeric" data-standby-field="finish_time" value="${escapeMinePlanning(toTimeValue(row.finish_time))}" placeholder="HH:MM" required /></td>
        <td class="prod-standby-number"><input type="number" step="0.01" min="0" data-standby-field="total_standby_hours" value="${escapeMinePlanning(row.total_standby_hours ?? '')}" readonly aria-readonly="true" /> Jam</td>
      </tr>
    `}).join('');
    applyStandbyDraftsToRenderedRows();
  }

  if (counter) counter.textContent = `Total Log Standby: ${logs.length}`;
  renderChartStandbyFromLogs(logs);
}

function resetSlicerStandby() {
  const selTahun = document.getElementById('slicerStandbyTahun');
  const selBulan = document.getElementById('slicerStandbyBulan');
  const inpTanggal = document.getElementById('slicerStandbyTanggal');
  const selKode = document.getElementById('slicerStandbyKode');
  const selShift = document.getElementById('slicerStandbyShift');

  if (selTahun) selTahun.value = '';
  if (selBulan) selBulan.value = '';
  if (inpTanggal) inpTanggal.value = '';
  if (selKode) selKode.value = '';
  if (selShift) selShift.value = '';

  void muatProdStandby();
}

function renderChartStandbyFromLogs(logs) {
  const paretoMap = {};
  (logs || []).forEach(l => {
    const kategori = l.kategori_standby || 'Lainnya';
    paretoMap[kategori] = (paretoMap[kategori] || 0) + parseFloat(l.total_standby_hours || 0);
  });
  const pareto = Object.entries(paretoMap)
    .map(([kategori, total_hours]) => ({ kategori, total_hours }))
    .sort((a, b) => b.total_hours - a.total_hours);
  renderChartStandby(pareto);
}

// =========================================================
// EDITING INLINE TABEL STANDBY (sinkron ke database)
// =========================================================
function dayNightShifts() {
  const shifts = masterProdData.shifts || [];
  const siang = shifts.find(s => String(s.nama_shift || '').toLowerCase().includes('siang'));
  const malam = shifts.find(s => String(s.nama_shift || '').toLowerCase().includes('malam'));
  return [siang, malam].filter(Boolean);
}

function standbyShiftOptions(selectedValue) {
  const list = dayNightShifts();
  return '<option value="">Pilih Shift</option>' + list.map(s => {
    const isSiang = String(s.nama_shift || '').toLowerCase().includes('siang');
    return `<option value="${s.id}"${String(s.id) === String(selectedValue) ? ' selected' : ''}>${isSiang ? 'Siang' : 'Malam'}</option>`;
  }).join('');
}

function standbyClassOptions(selectedValue) {
  const classes = [...new Set((masterProdData.equipment || []).map(unit => String(unit.class_unit || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'id-ID', { numeric: true, sensitivity: 'base' }));
  return '<option value="">Semua Class</option>' + classes.map(value => `<option value="${escapeMinePlanning(value)}"${String(value) === String(selectedValue) ? ' selected' : ''}>${escapeMinePlanning(value)}</option>`).join('');
}

function standbyEquipmentOptions(selectedValue, classFilter = '') {
  const units = (masterProdData.equipment || [])
    .filter(u => u.id && u.kode_alat && (!classFilter || String(u.class_unit || '').trim() === classFilter))
    .sort((a, b) => String(a.kode_alat).localeCompare(String(b.kode_alat), 'id-ID', { numeric: true, sensitivity: 'base' }));
  return '<option value="">Pilih Kode Unit</option>' + units.map(u => `<option value="${u.id}"${String(u.id) === String(selectedValue) ? ' selected' : ''}>${escapeMinePlanning(u.kode_alat)}</option>`).join('');
}

function standbyFindEquipment(equipmentId) {
  return (masterProdData.equipment || []).find(unit => String(unit.id) === String(equipmentId || '')) || null;
}

function standbyResolveEquipmentClass(equipmentId, fallbackClass = '') {
  const unit = standbyFindEquipment(equipmentId);
  return String(unit?.class_unit || fallbackClass || '').trim();
}

function standbyCodeOptions(selectedValue) {
  const codes = masterProdData.standbyCodes || [];
  return '<option value="">Pilih Kode Standby</option>' + codes.map(c => `<option value="${c.id}"${String(c.id) === String(selectedValue) ? ' selected' : ''}>${escapeMinePlanning(c.kode)} - ${escapeMinePlanning(c.kategori)}</option>`).join('');
}

function toTimeValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!isNaN(d.getTime())) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const t = String(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  return t ? `${String(Number(t[1])).padStart(2, '0')}:${t[2]}` : '';
}

function toHourMinuteValue(value) {
  if (!value) return null;
  const t = String(value).match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (t) return Number(t[1]) + Number(t[2]) / 60;
  const d = new Date(value);
  if (!isNaN(d.getTime())) return d.getHours() + d.getMinutes() / 60;
  return null;
}

function computeStandbyHours(start, finish) {
  const s = toHourMinuteValue(start);
  const f = toHourMinuteValue(finish);
  if (s == null || f == null) return 0;
  let diff = f - s;
  if (diff < 0) diff += 24;
  return Math.max(0, parseFloat(diff.toFixed(2)));
}

function combineDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return timeStr || '';
  return `${String(dateStr).split('T')[0]}T${String(timeStr).padStart(5, '0')}`;
}

function formatStandbyTime24h(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 4);
  if (!digits) return '';
  if (digits.length <= 2) return digits;
  return digits.slice(0, 2) + ':' + digits.slice(2, 4);
}

function finalizeStandbyTime(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return '';
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const STANDBY_TIME_ALLOWED_KEYS = /^(Backspace|Delete|Tab|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|Enter)$/;

function bindStandbyTimeInput(el) {
  if (!el || el._standbyTimeBound) return;
  el._standbyTimeBound = true;
  el.addEventListener('input', () => {
    const f = formatStandbyTime24h(el.value);
    if (f !== el.value) el.value = f;
  });
  el.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || STANDBY_TIME_ALLOWED_KEYS.test(e.key) || /^\d$/.test(e.key)) return;
    e.preventDefault();
  });
  el.addEventListener('blur', () => { el.value = finalizeStandbyTime(el.value); });
}

function captureStandbyRowDraft(row) {
  const fields = {};
  row.querySelectorAll('[data-standby-field]').forEach(field => {
    fields[field.dataset.standbyField] = field.value;
  });
  return fields;
}

function updateStandbyRowTotal(row) {
  const start = row.querySelector('[data-standby-field="start_time"]')?.value;
  const finish = row.querySelector('[data-standby-field="finish_time"]')?.value;
  const totalInput = row.querySelector('[data-standby-field="total_standby_hours"]');
  if (!totalInput) return;
  totalInput.value = (start && finish) ? computeStandbyHours(start, finish) : '';
}

function markStandbyRowDirty(row) {
  const logId = row.dataset.logId;
  standbyDrafts.set(String(logId), captureStandbyRowDraft(row));
  row.dataset.saveState = 'dirty';
  updateStandbySaveIndicator();
}

function applyStandbyDraftsToRenderedRows() {
  document.querySelectorAll('[data-standby-log-row]').forEach(row => {
    const draft = standbyDrafts.get(String(row.dataset.logId));
    if (!draft) return;
    const fields = draft.fields || draft;
    const classSelect = row.querySelector('[data-standby-field="class_filter"]');
    const equipmentSelect = row.querySelector('[data-standby-field="equipment_id"]');
    if (classSelect) classSelect.value = fields.class_filter || '';
    if (equipmentSelect) equipmentSelect.innerHTML = standbyEquipmentOptions(fields.equipment_id || '', fields.class_filter || '');
    Object.entries(fields).forEach(([name, value]) => {
      const field = row.querySelector(`[data-standby-field="${name}"]`);
      if (field) field.value = value ?? '';
    });
    const code = (masterProdData.standbyCodes || []).find(c => String(c.id) === String(fields.standby_code_id));
    const katCell = row.querySelector('[data-standby-kategori]');
    if (katCell) katCell.textContent = code?.kategori || '';
    updateStandbyRowTotal(row);
    row.dataset.saveState = 'dirty';
  });
  updateStandbySaveIndicator();
}

function updateStandbySaveIndicator(message = '') {
  const button = document.getElementById('btnSimpanPerubahanStandby');
  const status = document.getElementById('statusSimpanStandby');
  const count = standbyDrafts.size;
  if (button) {
    button.disabled = count === 0;
    button.textContent = count ? `Simpan Perubahan (${count})` : 'Simpan Perubahan';
  }
  if (status) {
    status.textContent = message || (count ? `${count} baris belum disimpan` : 'Tersimpan');
    status.style.color = count ? '#b45309' : '#15803d';
  }
}

function standbyShiftKind(shiftId) {
  const shifts = masterProdData.shifts || [];
  const shift = shifts.find(s => String(s.id) === String(shiftId || ''));
  if (!shift) return '';
  const name = String(shift.nama_shift || '').toLowerCase();
  if (name.includes('siang')) return 'siang';
  if (name.includes('malam')) return 'malam';
  return '';
}

function convertTimeForShift(timeStr, kind) {
  const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return timeStr || '';
  let h = Number(m[1]);
  const min = Number(m[2]);
  if (kind === 'siang') {
    h = h % 12; // 22:00 -> 10:00, 23:00 -> 11:00, 12:00 -> 00:00
  } else if (kind === 'malam') {
    if (h < 12) h += 12; // 10:00 -> 22:00, 11:00 -> 23:00
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function syncStandbyRowTime(row, fieldName) {
  const shiftSelect = row.querySelector('[data-standby-field="shift_id"]');
  const kind = standbyShiftKind(shiftSelect && shiftSelect.value);
  const fields = fieldName ? [fieldName] : ['start_time', 'finish_time'];
  fields.forEach(name => {
    const f = row.querySelector(`[data-standby-field="${name}"]`);
    if (!f) return;
    f.value = finalizeStandbyTime(f.value);
    if (kind) f.value = convertTimeForShift(f.value, kind);
  });
  updateStandbyRowTotal(row);
}

function bindStandbyInlineEditing() {
  const tbody = document.getElementById('tbodyProdStandby');
  if (!tbody || standbyInlineBound) return;
  standbyInlineBound = true;
  tbody.addEventListener('focusin', event => {
    const field = event.target.closest('[data-standby-field]');
    const row = field?.closest('[data-standby-log-row]');
    if (!field || !row || field.readOnly) return;
    row._standbyBefore = captureStandbyRowDraft(row);
  });
  tbody.addEventListener('focusout', event => {
    const field = event.target.closest('[data-standby-field]');
    const row = field ? field.closest('[data-standby-log-row]') : null;
    if (!field || !row) return;
    if (field.dataset.standbyField === 'start_time' || field.dataset.standbyField === 'finish_time') {
      syncStandbyRowTime(row, field.dataset.standbyField);
      markStandbyRowDirty(row);
    }
  });
  tbody.addEventListener('change', event => {
    const field = event.target.closest('[data-standby-field]');
    const row = field?.closest('[data-standby-log-row]');
    if (!field || !row) return;
    const fName = field.dataset.standbyField;
    if (fName === 'class_filter') {
      const equipmentSelect = row.querySelector('[data-standby-field="equipment_id"]');
      if (equipmentSelect) {
        const currentUnit = standbyFindEquipment(equipmentSelect.value);
        const currentUnitMatches = currentUnit && String(currentUnit.class_unit || '').trim() === field.value;
        const selectedUnitId = currentUnitMatches ? currentUnit.id : '';
        equipmentSelect.innerHTML = standbyEquipmentOptions(selectedUnitId, field.value);
        equipmentSelect.focus();
      }
      markStandbyRowDirty(row);
      return;
    }
    if (fName === 'equipment_id') {
      const unit = standbyFindEquipment(field.value);
      const classSelect = row.querySelector('[data-standby-field="class_filter"]');
      if (unit && classSelect) {
        const resolvedClass = String(unit.class_unit || '').trim();
        classSelect.value = resolvedClass;
        field.innerHTML = standbyEquipmentOptions(unit.id, resolvedClass);
      }
    }
    if (fName === 'standby_code_id') {
      const code = (masterProdData.standbyCodes || []).find(c => String(c.id) === String(field.value));
      const katCell = row.querySelector('[data-standby-kategori]');
      if (katCell) katCell.textContent = code?.kategori || '';
    }
    if (fName === 'shift_id') {
      syncStandbyRowTime(row);
      markStandbyRowDirty(row);
      return;
    }
    if (fName === 'start_time' || fName === 'finish_time') {
      syncStandbyRowTime(row, fName);
      markStandbyRowDirty(row);
      return;
    }
    markStandbyRowDirty(row);
  });
  tbody.addEventListener('input', event => {
    const field = event.target.closest('[data-standby-field]');
    const row = field?.closest('[data-standby-log-row]');
    if (!field || !row || field.readOnly) return;
    if (field.dataset.standbyField === 'start_time' || field.dataset.standbyField === 'finish_time') {
      const formatted = formatStandbyTime24h(field.value);
      if (formatted !== field.value) field.value = formatted;
      updateStandbyRowTotal(row);
    }
    markStandbyRowDirty(row);
  });

  // Batasi kolom jam Mask ke digit + navigasi; nilai selalu format 24h HH:MM
  const isTimeField = el => el && (el.dataset?.standbyField === 'start_time' || el.dataset?.standbyField === 'finish_time');
  tbody.addEventListener('keydown', e => {
    const field = e.target.closest('[data-standby-field]');
    if (!isTimeField(field)) return;
    if (e.ctrlKey || e.metaKey || e.altKey || STANDBY_TIME_ALLOWED_KEYS.test(e.key) || /^\d$/.test(e.key)) return;
    e.preventDefault();
  });
}

function buildStandbyPayload(draft) {
  const fields = draft || {};
  const required = ['tanggal', 'shift_id', 'equipment_id', 'standby_code_id', 'start_time', 'finish_time'];
  const missing = required.filter(f => !String(fields[f] || '').trim());
  if (missing.length) throw new Error('Masih ada kolom wajib yang belum diisi pada baris standby.');
  return {
    tanggal: fields.tanggal,
    shift_id: fields.shift_id,
    equipment_id: fields.equipment_id,
    standby_code_id: fields.standby_code_id,
    description: fields.description || '',
    start_time: combineDateTime(fields.tanggal, fields.start_time),
    finish_time: combineDateTime(fields.tanggal, fields.finish_time),
    total_standby_hours: computeStandbyHours(fields.start_time, fields.finish_time),
  };
}

async function persistStandbyDraft(logId, draft) {
  const payload = buildStandbyPayload(draft);
  const res = await fetch(getProdApiUrl(`/api/admin/production/standby/${encodeURIComponent(logId)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
    body: JSON.stringify(payload),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
  const cached = cachedStandbyLogs.find(l => String(l.id) === String(logId));
  if (cached) {
    Object.assign(cached, result);
    const code = (masterProdData.standbyCodes || []).find(c => String(c.id) === String(result.standby_code_id));
    const eq = (masterProdData.equipment || []).find(e => String(e.id) === String(result.equipment_id));
    const sh = dayNightShifts().find(s => String(s.id) === String(result.shift_id));
    if (code) cached.kategori_standby = code.kategori;
    if (eq) cached.kode_alat = eq.kode_alat;
    if (sh) cached.nama_shift = sh.nama_shift;
  }
  return result;
}

async function simpanPerubahanStandby() {
  document.querySelectorAll('[data-standby-log-row][data-save-state="dirty"]').forEach(row => {
    standbyDrafts.set(String(row.dataset.logId), captureStandbyRowDraft(row));
  });
  if (!standbyDrafts.size) {
    updateStandbySaveIndicator();
    return true;
  }
  const saveButton = document.getElementById('btnSimpanPerubahanStandby');
  if (saveButton) saveButton.disabled = true;
  updateStandbySaveIndicator('Menyimpan perubahan...');
  const failures = [];
  let savedCount = 0;
  for (const [logId, draft] of [...standbyDrafts.entries()]) {
    try {
      await persistStandbyDraft(logId, draft);
      standbyDrafts.delete(logId);
      savedCount += 1;
    } catch (error) {
      failures.push({ logId, message: error.message });
    }
  }
  if (failures.length) {
    updateStandbySaveIndicator(`${failures.length} baris gagal disimpan`);
    alert(`${failures.length} baris standby gagal disimpan:\n` + failures.map(f => `- ${f.message}`).join('\n'));
    return false;
  }
  updateStandbySaveIndicator(`${savedCount} baris berhasil disimpan`);
  setTimeout(() => updateStandbySaveIndicator(), 1400);
  terapkanSlicerStandby();
  return true;
}

function renderChartStandby(paretoData) {
  const ctxPareto = document.getElementById('chartParetoStandby');
  const ctxPie = document.getElementById('chartPieStandby');
  if (!ctxPareto || !ctxPie) return;

  const labels = paretoData.map(p => p.kategori);
  const values = paretoData.map(p => parseFloat(p.total_hours));

  if (chartParetoObj) chartParetoObj.destroy();
  if (chartPieStandbyObj) chartPieStandbyObj.destroy();

  chartParetoObj = new Chart(ctxPareto, {
    type: 'bar',
    data: {
      labels: labels.length ? labels : ['Waiting Truck', 'Rain', 'Refueling'],
      datasets: [{
        label: 'Jam Standby',
        data: values.length ? values : [12.5, 8.0, 4.2],
        backgroundColor: '#f97316'
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  chartPieStandbyObj = new Chart(ctxPie, {
    type: 'pie',
    data: {
      labels: labels.length ? labels : ['Waiting Truck', 'Rain', 'Refueling'],
      datasets: [{
        data: values.length ? values : [12.5, 8.0, 4.2],
        backgroundColor: ['#f97316', '#3b82f6', '#10b981', '#a855f7']
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

function bukaModalInputStandbyLegacy() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;

  const equipOptions = (masterProdData.equipment || []).map(e => `<option value="${e.id}">${e.kode_alat} (${e.kelas_alat})</option>`).join('');
  const stbOptions = (masterProdData.standbyCodes || []).map(s => `<option value="${s.id}">${s.kode} - ${s.kategori}</option>`).join('');
  const shiftOptions = dayNightShifts().map(s => {
    const isSiang = String(s.nama_shift || '').toLowerCase().includes('siang');
    return `<option value="${s.id}">${isSiang ? 'Siang' : 'Malam'}</option>`;
  }).join('');

  konten.innerHTML = `
    <h3 style="margin-top:0;color:#0f172a;">⏱️ Catat Log Standby Unit</h3>
    <form id="formInputStandby">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Tanggal</label>
          <input type="date" id="isTanggal" class="input-filter" value="${new Date().toISOString().split('T')[0]}" required />
        </div>
        <div>
          <label class="label">Shift</label>
          <select id="isShift" class="input-filter">${shiftOptions}</select>
        </div>
      </div>
      <div style="margin-bottom:10px;">
        <label class="label">Unit Alat Berat</label>
        <select id="isEquipment" class="input-filter" required>${equipOptions}</select>
      </div>
      <div style="margin-bottom:10px;">
        <label class="label">Alasan / Kode Standby</label>
        <select id="isStandbyCode" class="input-filter" required>${stbOptions}</select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
        <div>
           <label class="label">Jam Mulai</label>
          <input type="text" id="isStart" class="input-filter" inputmode="numeric" placeholder="HH:MM" required />
        </div>
        <div>
          <label class="label">Jam Selesai</label>
          <input type="text" id="isFinish" class="input-filter" inputmode="numeric" placeholder="HH:MM" required />
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button>
        <button type="submit" class="tombol tombol--utama">Simpan Standby Log</button>
      </div>
    </form>
  `;
  overlay.hidden = false;

  bindStandbyTimeInput(document.getElementById('isStart'));
  bindStandbyTimeInput(document.getElementById('isFinish'));

  document.getElementById('formInputStandby').addEventListener('submit', async (e) => {
     e.preventDefault();
    const isTanggal = document.getElementById('isTanggal').value;
    const isShiftId = document.getElementById('isShift').value;
    const kind = standbyShiftKind(isShiftId);
    const sTime = convertTimeForShift(finalizeStandbyTime(document.getElementById('isStart').value), kind);
    const fTime = convertTimeForShift(finalizeStandbyTime(document.getElementById('isFinish').value), kind);
    const bodyData = {
      tanggal: isTanggal,
      shift_id: isShiftId,
      equipment_id: document.getElementById('isEquipment').value,
      standby_code_id: document.getElementById('isStandbyCode').value,
      start_time: combineDateTime(isTanggal, sTime),
      finish_time: combineDateTime(isTanggal, fTime)
    };

    try {
      const res = await fetch(getProdApiUrl('/api/admin/production/standby'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify(bodyData)
      });
      if (res.ok) {
        tutupModalGenerik();
        muatProdStandby();
      }
    } catch (err) {
      alert('Gagal menyimpan standby log: ' + err.message);
    }
  });
}

// =============================================================
// STANDBY V2 — operational day 06:00, two shifts, review & audit
// =============================================================
let standbyV2Data = { logs: [], slices: [], active: [], controls: [], dataQuality: [], pareto: { byCode: [], byUnit: [] }, summary: {}, period: null };
// Unit yang dipilih dari tombol Input Unit hanya merupakan baris kerja di UI.
// Map ini sengaja tidak dikirim ke backend agar tidak membentuk event/jam Standby semu.
const standbyDisplayedUnits = new Map();

function standbyDisplayedUnitKey(operationalDate, shiftId, equipmentId) {
  return [operationalDate, shiftId, equipmentId].map(value => String(value || '').trim()).join('::');
}

function standbyShiftKindFromName(name) {
  return /siang/i.test(String(name || '')) ? 'siang' : 'malam';
}

function standbyDateRange(fromValue, toValue) {
  const from = new Date(`${fromValue}T12:00:00`);
  const to = new Date(`${toValue}T12:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return [];
  const result = [];
  for (const cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) {
    result.push(getLocalDateInputValue(cursor));
  }
  return result;
}
let standbyEditSaving = false;
let standbyNavigationBypass = false;
let standbyBulkDeleteMode = false;
const standbyDeleteSelection = new Set();

function getStandbyDraftStorageKey() {
  const account = localStorage.getItem('admin_email') || localStorage.getItem('user_email') || 'default';
  return `omos:standby-edit-session:${account}`;
}

function readStandbyDrafts() {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(getStandbyDraftStorageKey()) || '{}') || {})); }
  catch { return new Map(); }
}

let standbyEditDrafts = readStandbyDrafts();

function persistStandbyDrafts() {
  if (standbyEditDrafts.size) localStorage.setItem(getStandbyDraftStorageKey(), JSON.stringify(Object.fromEntries(standbyEditDrafts)));
  else localStorage.removeItem(getStandbyDraftStorageKey());
  updateStandbyEditSessionUi();
}

function updateStandbyEditSessionUi(message = '') {
  const bar = document.getElementById('standbyEditSessionBar');
  const title = document.getElementById('standbyEditSessionTitle');
  const note = document.getElementById('standbyEditSessionMessage');
  const button = document.getElementById('btnSimpanSesiStandby');
  if (!bar) return;
  bar.hidden = standbyEditDrafts.size === 0;
  if (title) title.textContent = `${standbyEditDrafts.size} record berubah dalam sesi ini`;
  if (note) note.textContent = message || 'Anda dapat lanjut membuka unit lain. Seluruh perubahan akan disimpan bersama dan dikirim ulang untuk review.';
  if (button) {
    button.disabled = standbyEditSaving || standbyEditDrafts.size === 0;
    button.textContent = standbyEditSaving ? 'Menyimpan Sesiâ€¦' : `Simpan Sesi (${standbyEditDrafts.size})`;
  }
}

function showStandbyUnsavedDialog(contextLabel) {
  return new Promise(resolve => {
    document.getElementById('standbyUnsavedOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'standbyUnsavedOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `<div role="dialog" aria-modal="true" class="standby-unsaved-dialog"><h3>Perubahan Standby belum disimpan</h3><p>Terdapat ${standbyEditDrafts.size} record yang berubah sebelum ${escapeMinePlanning(contextLabel)}.</p><div><button type="button" class="tombol tombol--ghost" data-standby-unsaved="stay">Kembali Mengedit</button><button type="button" class="tombol" data-standby-unsaved="discard">Abaikan</button><button type="button" class="tombol tombol--utama" data-standby-unsaved="save">Simpan Sesi</button></div></div>`;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-standby-unsaved]').forEach(button => button.addEventListener('click', () => { const action = button.dataset.standbyUnsaved; overlay.remove(); resolve(action); }, { once: true }));
  });
}

function setupStandbyUnsavedGuards() {
  if (document.documentElement.dataset.standbyUnsavedGuards) return;
  document.documentElement.dataset.standbyUnsavedGuards = 'true';
  document.addEventListener('click', async event => {
    const target = event.target.closest('.sidebar__tab[data-tab]');
    const tab = document.getElementById('tab-prodStandby');
    if (!target || standbyNavigationBypass || !tab || tab.hidden || !standbyEditDrafts.size || target.dataset.tab === 'prodStandby') return;
    event.preventDefault(); event.stopImmediatePropagation();
    const action = await showStandbyUnsavedDialog('beralih ke tab lain');
    if (action === 'stay') return;
    if (action === 'save') await simpanSesiStandby(); else { standbyEditDrafts.clear(); persistStandbyDrafts(); }
    if (standbyEditDrafts.size) return;
    standbyNavigationBypass = true;
    try { target.click(); } finally { standbyNavigationBypass = false; }
  }, true);
  window.addEventListener('beforeunload', event => {
    if (!standbyEditDrafts.size) return;
    event.preventDefault(); event.returnValue = '';
  });
}

function standbyV2PreviousDate() {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return getLocalDateInputValue(date);
}

function standbyV2Time(value) {
  if (!value) return 'Berjalan';
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)).replace('.', ':');
}

function standbyV2DateTime(value) {
  if (!value) return 'Berjalan';
  return new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

function standbyV2Hours(value) {
  return Number(value || 0).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function standbyV2ReviewBadge(status) {
  const labels = { pending: 'Belum Direview', approved: 'Disetujui', returned: 'Dikembalikan' };
  return `<span class="standby-review-status is-${escapeMinePlanning(status || 'pending')}">${escapeMinePlanning(labels[status] || status || 'Belum Direview')}</span>`;
}

function standbyV2LifecycleBadge(status) {
  const labels = { open: 'Berjalan', confirmed: 'Tercatat', reclassified: 'Reclassified ke BD', cancelled: 'Dibatalkan' };
  return `<span class="standby-lifecycle is-${escapeMinePlanning(status || 'confirmed')}">${escapeMinePlanning(labels[status] || status)}</span>`;
}

async function muatProdStandby() {
  const workspace = document.getElementById('standbyUnitWorkspace');
  if (!workspace) return;
  workspace.innerHTML = '<div class="standby-loading">Memuat standby per unit…</div>';
  try {
    if (!(masterProdData.equipment || []).length || !(masterProdData.standbyCodes || []).length) await muatMasterDataProduksi();
    const from = document.getElementById('slicerStandbyFrom');
    const to = document.getElementById('slicerStandbyTo');
    if (!from.value) from.value = standbyV2PreviousDate();
    if (!to.value) to.value = from.value;
    const params = new URLSearchParams({ from: from.value, to: to.value });
    const response = await fetch(getProdApiUrl(`/api/admin/production/standby?${params}`), { headers: { ...getProdAuthHeaders() } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    standbyV2Data = data;
    cachedStandbyLogs = data.logs || [];
    populateStandbyV2Filters();
    renderStandbyActivePanel();
    renderStandbyWorkspace();
    updateStandbyEditSessionUi();
  } catch (error) {
    workspace.innerHTML = `<div class="teks-error">Gagal memuat Standby: ${escapeMinePlanning(error.message)}</div>`;
  }
}

function setStandbySelectOptions(element, values, allLabel, currentValue) {
  if (!element) return;
  element.innerHTML = `<option value="">${escapeMinePlanning(allLabel)}</option>` + values.map(item => {
    const value = typeof item === 'object' ? item.value : item;
    const label = typeof item === 'object' ? item.label : item;
    return `<option value="${escapeMinePlanning(value)}"${String(value) === String(currentValue) ? ' selected' : ''}>${escapeMinePlanning(label)}</option>`;
  }).join('');
}

function populateStandbyV2Filters() {
  const shiftEl = document.getElementById('slicerStandbyShiftV2');
  const jenisEl = document.getElementById('slicerStandbyJenis');
  const codeEl = document.getElementById('slicerStandbyCodeV2');
  setStandbySelectOptions(shiftEl, dayNightShifts().map(shift => ({ value: shift.id, label: /siang/i.test(shift.nama_shift) ? 'Shift Siang' : 'Shift Malam' })), 'Semua Shift', shiftEl?.value);
  const types = [...new Set((masterProdData.equipment || []).map(unit => unit.kelas_alat).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'id-ID'));
  setStandbySelectOptions(jenisEl, types, 'Semua Jenis', jenisEl?.value);
  const codes = (masterProdData.standbyCodes || []).map(code => ({ value: code.id, label: `${code.kode} · ${code.kategori}${code.is_system ? ' · Sistem' : ''}` }));
  setStandbySelectOptions(codeEl, codes, 'Semua Kode', codeEl?.value);
  syncStandbyFilterOptions();
}

function syncStandbyFilterOptions() {
  const jenis = document.getElementById('slicerStandbyJenis')?.value || '';
  const classEl = document.getElementById('slicerStandbyClass');
  const unitEl = document.getElementById('slicerStandbyUnit');
  let units = (masterProdData.equipment || []).filter(unit => !jenis || unit.kelas_alat === jenis);
  const classes = [...new Set(units.map(unit => String(unit.class_unit || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id-ID', { numeric: true }));
  const previousClass = classEl?.value || '';
  setStandbySelectOptions(classEl, classes, 'Semua Class', classes.includes(previousClass) ? previousClass : '');
  const selectedClass = classEl?.value || '';
  units = units.filter(unit => !selectedClass || String(unit.class_unit || '').trim() === selectedClass);
  setStandbySelectOptions(unitEl, units.map(unit => ({ value: unit.id, label: unit.kode_alat })), 'Semua Unit', unitEl?.value);
}

function filteredStandbyV2Slices() {
  const shift = document.getElementById('slicerStandbyShiftV2')?.value || '';
  const jenis = document.getElementById('slicerStandbyJenis')?.value || '';
  const unitClass = document.getElementById('slicerStandbyClass')?.value || '';
  const unit = document.getElementById('slicerStandbyUnit')?.value || '';
  const code = document.getElementById('slicerStandbyCodeV2')?.value || '';
  const review = document.getElementById('slicerStandbyReview')?.value || '';
  return (standbyV2Data.slices || []).filter(row =>
    (!shift || String(row.shift_id) === shift) && (!jenis || row.kelas_alat === jenis) &&
    (!unitClass || String(row.class_unit || '') === unitClass) && (!unit || String(row.equipment_id) === unit) &&
    (!code || String(row.standby_code_id) === code) && (!review || row.review_status === review)
  );
}

function filteredStandbyDisplayedUnits() {
  const shift = document.getElementById('slicerStandbyShiftV2')?.value || '';
  const jenis = document.getElementById('slicerStandbyJenis')?.value || '';
  const unitClass = document.getElementById('slicerStandbyClass')?.value || '';
  const unit = document.getElementById('slicerStandbyUnit')?.value || '';
  const from = document.getElementById('slicerStandbyFrom')?.value || '';
  const to = document.getElementById('slicerStandbyTo')?.value || from;
  return [...standbyDisplayedUnits.values()].filter(row =>
    (!from || row.operational_date >= from) && (!to || row.operational_date <= to) &&
    (!shift || String(row.shift_id) === shift) && (!jenis || row.kelas_alat === jenis) &&
    (!unitClass || String(row.class_unit || '') === unitClass) && (!unit || String(row.equipment_id) === unit)
  );
}

function filteredStandbyMohhControls() {
  const shift = document.getElementById('slicerStandbyShiftV2')?.value || '';
  const jenis = document.getElementById('slicerStandbyJenis')?.value || '';
  const unitClass = document.getElementById('slicerStandbyClass')?.value || '';
  const unit = document.getElementById('slicerStandbyUnit')?.value || '';
  return (standbyV2Data.controls || []).filter(row =>
    (!shift || String(row.shift_id) === shift) && (!jenis || row.kelas_alat === jenis) &&
    (!unitClass || String(row.class_unit || '') === unitClass) && (!unit || String(row.equipment_id) === unit)
  );
}

function standbyMohhControlFor(row) {
  return (standbyV2Data.controls || []).find(control =>
    String(control.operational_date) === String(row.operational_date) &&
    String(control.shift_id) === String(row.shift_id) &&
    String(control.equipment_id) === String(row.equipment_id)
  ) || null;
}

function standbyMohhControlForDisplay(row) {
  return standbyMohhControlFor(row) || {
    operational_date: row.operational_date,
    shift_id: row.shift_id,
    equipment_id: row.equipment_id,
    kode_alat: row.kode_alat,
    hmHours: 0,
    hmRecords: 0,
    breakdownHours: 0,
    standbyHours: 0,
    accountedHours: 0,
    targetHours: 12,
    balanceHours: 12,
    requiredStandbyHours: 12,
    status: 'missing_hm',
    issues: [{ code: 'HM_MISSING', message: 'HM Input Data belum tercatat.' }],
    canClose: false,
    closure: null
  };
}

function standbyMohhStatusLabel(status) {
  return ({ balanced: 'MOHH Pas', closed: 'Shift Ditutup', under: 'MOHH Kurang', over: 'MOHH Lebih', missing_hm: 'HM Belum Ada', conflict: 'Konflik Waktu', stale: 'Data Berubah' })[status] || status || 'Belum Dihitung';
}

function standbyMohhControlStrip(control) {
  if (!control) return '<div class="standby-mohh-empty">Kontrol MOHH belum tersedia.</div>';
  const closed = control.closure?.status === 'closed';
  const button = closed
    ? `<button class="tombol tombol--ghost tombol--kecil" type="button" onclick="bukaKembaliShiftStandby('${escapeMinePlanning(control.operational_date)}','${escapeMinePlanning(control.shift_id)}','${escapeMinePlanning(control.equipment_id)}')">Buka Kembali</button>`
    : `<button class="tombol tombol--kecil" type="button" onclick="tutupShiftStandby('${escapeMinePlanning(control.operational_date)}','${escapeMinePlanning(control.shift_id)}','${escapeMinePlanning(control.equipment_id)}')" ${control.canClose ? '' : `disabled title="${escapeMinePlanning((control.issues || []).map(issue => issue.message).join(' '))}"`}>Tutup Shift</button>`;
  return `<div class="standby-mohh-control is-${escapeMinePlanning(control.status)}">
    <div><small>HM Input Data</small><b>${standbyV2Hours(control.hmHours)} Jam</b></div>
    <div><small>Breakdown</small><b>${standbyV2Hours(control.breakdownHours)} Jam</b></div>
    <div><small>Standby</small><b>${standbyV2Hours(control.standbyHours)} Jam</b></div>
    <div><small>Kontrol MOHH</small><b>${standbyV2Hours(control.accountedHours)} / ${standbyV2Hours(control.targetHours)}</b></div>
    <div><small>Selisih</small><b>${Number(control.balanceHours || 0) >= 0 ? '+' : ''}${standbyV2Hours(control.balanceHours)} Jam</b></div>
    <div class="standby-mohh-action"><span>${escapeMinePlanning(standbyMohhStatusLabel(control.status))}</span>${button}</div>
  </div>`;
}

function standbyGroupMap(rows, keyFn) {
  const result = new Map();
  rows.forEach(row => {
    const key = keyFn(row) || 'Tidak Ditetapkan';
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  });
  return result;
}

function standbyViewKey(...parts) {
  return parts.map(part => String(part ?? '').trim()).join('::');
}

function standbyViewScrollContainer() {
  return document.querySelector('main.konten') || document.querySelector('.konten') || document.scrollingElement;
}

function captureStandbyViewSession() {
  const workspace = document.getElementById('standbyUnitWorkspace');
  const filterIds = ['slicerStandbyFrom','slicerStandbyTo','slicerStandbyShiftV2','slicerStandbyJenis','slicerStandbyClass','slicerStandbyUnit','slicerStandbyCodeV2','slicerStandbyReview'];
  const openDetails = [...(workspace?.querySelectorAll('details[open][data-standby-view-key]') || [])];
  const freezeBottom = document.querySelector('.standby-v2-freeze')?.getBoundingClientRect().bottom || 0;
  const anchor = [...openDetails].sort((left, right) => Math.abs(left.getBoundingClientRect().top - freezeBottom) - Math.abs(right.getBoundingClientRect().top - freezeBottom))[0] || null;
  return {
    openKeys: openDetails.map(detail => detail.dataset.standbyViewKey),
    filters: Object.fromEntries(filterIds.map(id => [id, document.getElementById(id)?.value ?? ''])),
    scrollTop: standbyViewScrollContainer()?.scrollTop || 0,
    anchorKey: anchor?.dataset.standbyViewKey || '',
    anchorOffset: anchor ? anchor.getBoundingClientRect().top - freezeBottom : 0
  };
}

async function restoreStandbyViewSession(session) {
  if (!session) return;
  Object.entries(session.filters || {}).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element && [...element.options || []].some(option => option.value === value)) element.value = value;
    else if (element && element.tagName === 'INPUT') element.value = value;
  });
  const keys = new Set(session.openKeys || []);
  document.querySelectorAll('#standbyUnitWorkspace details[data-standby-view-key]').forEach(detail => {
    detail.open = keys.has(detail.dataset.standbyViewKey);
  });
  // Tunggu browser menghitung ulang tinggi seluruh details yang baru dibuka.
  // Tanpa dua frame ini, scrollTop dapat ter-clamp ke tinggi layout yang masih collapsed.
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  document.getElementById('standbyUnitWorkspace')?.getBoundingClientRect();
  const scrollContainer = standbyViewScrollContainer();
  if (scrollContainer) scrollContainer.scrollTop = Number(session.scrollTop || 0);
  await new Promise(resolve => requestAnimationFrame(resolve));
  const anchor = [...document.querySelectorAll('#standbyUnitWorkspace details[data-standby-view-key]')]
    .find(detail => detail.dataset.standbyViewKey === session.anchorKey);
  if (anchor && scrollContainer) {
    const freezeBottom = document.querySelector('.standby-v2-freeze')?.getBoundingClientRect().bottom || 0;
    scrollContainer.scrollTop += anchor.getBoundingClientRect().top - freezeBottom - Number(session.anchorOffset || 0);
  }
  await new Promise(resolve => requestAnimationFrame(resolve));
  syncStandbyBulkDeleteUi();
}

function standbyRowsTableLegacy(rows) {
  return `<div class="standby-table-scroll"><table class="standby-v2-table"><thead><tr><th>Kode Standby</th><th>Kategori</th><th>Mulai</th><th>Selesai</th><th>Jam</th><th>Sumber</th><th>Status</th><th>Review</th></tr></thead><tbody>${rows.map(row => `<tr class="${row.lifecycle_status === 'reclassified' ? 'is-reclassified' : ''}">
    <td><b>${escapeMinePlanning(row.kode_standby || '—')}</b></td><td>${escapeMinePlanning(row.kategori_standby || '—')}<small>${escapeMinePlanning(row.description || '')}</small></td>
    <td>${escapeMinePlanning(standbyV2Time(row.slice_start))}</td><td>${escapeMinePlanning(standbyV2Time(row.slice_finish))}</td>
    <td class="is-number">${standbyV2Hours(row.counted_hours)}${row.lifecycle_status === 'reclassified' ? `<small>Raw ${standbyV2Hours(row.raw_hours)} jam</small>` : ''}</td>
    <td>${row.is_system_generated ? '<span class="standby-source-system">Sistem</span>' : 'Manual'}</td><td>${standbyV2LifecycleBadge(row.lifecycle_status)}</td><td>${standbyV2ReviewBadge(row.review_status)}</td>
  </tr>`).join('')}</tbody></table></div>`;
}

function standbyV2LogById(id) {
  return (standbyV2Data.logs || []).find(log => String(log.id) === String(id));
}

function standbyRowCanEdit(row) {
  const frozen = standbyMohhControlFor(row)?.closure?.status === 'closed';
  return !frozen && !row.is_system_generated && !row.kode_is_system && !row.kode_is_locked && row.lifecycle_status === 'confirmed' && row.review_status !== 'approved';
}

function standbyRowCanDelete(row) {
  return standbyRowCanEdit(row);
}

function standbyDeleteCell(row, id) {
  if (!standbyBulkDeleteMode) return '';
  const allowed = standbyRowCanDelete(row);
  return `<td class="standby-delete-cell">${allowed ? `<input data-standby-select type="checkbox" value="${escapeMinePlanning(id)}" aria-label="Pilih record ${escapeMinePlanning(row.kode_standby || '')}" onchange="toggleStandbySelection('${escapeMinePlanning(id)}',this.checked)"${standbyDeleteSelection.has(id) ? ' checked' : ''}/>` : '<span title="Record terkunci">â€”</span>'}</td>`;
}

function standbyManualCodeEditOptions(selectedId) {
  return (masterProdData.standbyCodes || []).filter(code => !code.is_system && !code.is_locked)
    .map(code => `<option value="${escapeMinePlanning(code.id)}"${String(code.id) === String(selectedId) ? ' selected' : ''}>${escapeMinePlanning(code.kode)} · ${escapeMinePlanning(code.kategori)}</option>`).join('');
}

function standbyEditPayloadFromLog(log) {
  return {
    standby_code_id: String(log?.standby_code_id || ''),
    description: String(log?.description || ''),
    start_time: log?.start_time ? new Date(log.start_time).toISOString() : '',
    finish_time: log?.finish_time ? new Date(log.finish_time).toISOString() : ''
  };
}

function standbyEditPayloadEqual(left, right) {
  return ['standby_code_id','description','start_time','finish_time'].every(key => String(left?.[key] || '') === String(right?.[key] || ''));
}

function renderStandbyTableRow(row, forceEdit = false) {
  const id = String(row.standby_log_id || row.id || '');
  const log = standbyV2LogById(id) || row;
  const draft = standbyEditDrafts.get(id);
  const editing = forceEdit || Boolean(draft);
  const editable = standbyRowCanEdit(row);
  const rowClass = row.lifecycle_status === 'reclassified' ? 'is-reclassified' : '';
  if (editing && editable) {
    const values = draft || standbyEditPayloadFromLog(log);
    const startValue = standbyV2Time(values.start_time);
    const finishValue = standbyV2Time(values.finish_time);
    const duration = values.start_time && values.finish_time ? Math.max(0, (new Date(values.finish_time) - new Date(values.start_time)) / 3600000) : 0;
    return `<tr class="${rowClass}" data-standby-edit-row="${escapeMinePlanning(id)}" data-operational-date="${escapeMinePlanning(row.operational_date)}" data-shift-kind="${escapeMinePlanning(row.shift_kind)}" data-save-state="${draft ? 'dirty' : 'editing'}">${standbyDeleteCell(row, id)}
      <td><select data-standby-edit-field="standby_code_id" onchange="ubahStandbyDraft(this)">${standbyManualCodeEditOptions(values.standby_code_id)}</select></td>
      <td><input data-standby-edit-field="description" value="${escapeMinePlanning(values.description)}" placeholder="Keterangan standby" oninput="ubahStandbyDraft(this)" /></td>
      <td><select data-standby-edit-field="start" onchange="ubahStandbyDraft(this)">${standbyMultiTimeOptions(row.shift_kind, startValue)}</select></td>
      <td><select data-standby-edit-field="finish" onchange="ubahStandbyDraft(this)">${standbyMultiTimeOptions(row.shift_kind, finishValue)}</select></td>
      <td class="is-number"><output data-standby-edit-duration>${standbyV2Hours(duration)}</output></td>
      <td>Manual</td><td>${standbyV2LifecycleBadge(row.lifecycle_status)}</td><td>${standbyV2ReviewBadge(row.review_status)}</td>
      <td class="standby-row-actions"><button class="tombol tombol--ghost tombol--kecil" type="button" onclick="batalkanEditStandbyRow('${escapeMinePlanning(id)}')">Batal</button></td>
    </tr>`;
  }
  let actionTitle = 'Edit record manual';
  if (standbyMohhControlFor(row)?.closure?.status === 'closed') actionTitle = 'Shift sudah ditutup/freeze. Buka kembali shift untuk mengedit.';
  else if (row.is_system_generated || row.kode_is_system || row.kode_is_locked) actionTitle = 'Record sistem bersifat read-only';
  else if (row.review_status === 'approved') actionTitle = 'Kembalikan melalui Review sebelum diedit';
  else if (row.lifecycle_status !== 'confirmed') actionTitle = 'Hanya status Tercatat yang dapat diedit';
  return `<tr class="${rowClass}${standbyDeleteSelection.has(id) ? ' is-delete-selected' : ''}" data-standby-row="${escapeMinePlanning(id)}">${standbyDeleteCell(row, id)}
    <td><b>${escapeMinePlanning(row.kode_standby || '—')}</b></td><td>${escapeMinePlanning(row.kategori_standby || '—')}<small>${escapeMinePlanning(row.description || '')}</small></td>
    <td>${escapeMinePlanning(standbyV2Time(row.slice_start))}</td><td>${escapeMinePlanning(standbyV2Time(row.slice_finish))}</td>
    <td class="is-number">${standbyV2Hours(row.counted_hours)}${row.lifecycle_status === 'reclassified' ? `<small>Raw ${standbyV2Hours(row.raw_hours)} jam</small>` : ''}</td>
    <td>${row.is_system_generated ? '<span class="standby-source-system">Sistem</span>' : 'Manual'}</td><td>${standbyV2LifecycleBadge(row.lifecycle_status)}</td><td>${standbyV2ReviewBadge(row.review_status)}</td>
    <td class="standby-row-actions"><button class="tombol tombol--kecil" type="button" ${editable && !standbyBulkDeleteMode ? `onclick="mulaiEditStandbyRow('${escapeMinePlanning(id)}')"` : 'disabled'} title="${escapeMinePlanning(standbyBulkDeleteMode ? 'Tutup Mode Hapus untuk mengedit' : actionTitle)}">Edit</button></td>
  </tr>`;
}

function standbyRowsTable(rows) {
  const records = rows.filter(row => !row.__display_only);
  if (!records.length) return '<div class="standby-unit-empty"><b>Unit siap diisi</b><span>Belum ada record Standby. Gunakan tombol Insert Standby pada baris unit.</span></div>';
  return `<div class="standby-table-scroll"><table class="standby-v2-table"><thead><tr>${standbyBulkDeleteMode ? '<th class="standby-delete-cell">Pilih</th>' : ''}<th>Kode Standby</th><th>Kategori / Keterangan</th><th>Mulai</th><th>Selesai</th><th>Jam</th><th>Sumber</th><th>Status</th><th>Review</th><th>Aksi</th></tr></thead><tbody>${records.map(row => renderStandbyTableRow(row)).join('')}</tbody></table></div>`;
}

function standbyRenderUnitCard(unitRows) {
  const row = unitRows[0];
  const control = standbyMohhControlForDisplay(row);
  const frozen = control.closure?.status === 'closed';
  const type = row.kelas_alat || 'Tanpa Jenis';
  const unitCode = row.kode_alat || 'Tanpa Kode';
  const insertTitle = frozen ? 'Shift sudah ditutup/freeze. Buka kembali sebelum menambah Standby.' : 'Tambahkan parameter Standby pada unit ini';
  return `<details class="standby-unit-card" data-standby-view-key="${escapeMinePlanning(standbyViewKey('unit', row.operational_date, row.shift_id, row.equipment_id || unitCode))}" ontoggle="syncStandbyBulkDeleteUi()"><summary>
    <div class="standby-unit-summary-label"><b>${escapeMinePlanning(unitCode)}</b><span>${escapeMinePlanning(row.tipe_alat || type)}</span></div>
    <div class="standby-unit-summary-actions"><strong class="is-${escapeMinePlanning(control.status || 'under')}">${escapeMinePlanning(standbyMohhStatusLabel(control.status))} · ${standbyV2Hours(control.accountedHours || 0)}/${standbyV2Hours(control.targetHours || 12)}</strong><button class="tombol tombol--kecil standby-insert-button" type="button" onclick="event.preventDefault();event.stopPropagation();bukaInsertStandbyUnit('${escapeMinePlanning(row.operational_date)}','${escapeMinePlanning(row.shift_id)}','${escapeMinePlanning(row.equipment_id)}')" ${frozen ? 'disabled' : ''} title="${escapeMinePlanning(insertTitle)}">+ Insert Standby</button></div>
  </summary>${standbyMohhControlStrip(control)}${standbyRowsTable(unitRows)}</details>`;
}

function mulaiEditStandbyRow(id) {
  const rowElement = document.querySelector(`[data-standby-row="${CSS.escape(String(id))}"]`);
  const slice = (standbyV2Data.slices || []).find(row => String(row.standby_log_id) === String(id));
  if (!rowElement || !slice || !standbyRowCanEdit(slice)) return;
  rowElement.outerHTML = renderStandbyTableRow(slice, true);
  document.querySelector(`[data-standby-edit-row="${CSS.escape(String(id))}"] [data-standby-edit-field="standby_code_id"]`)?.focus();
}

function ubahStandbyDraft(field) {
  const row = field?.closest('[data-standby-edit-row]');
  if (!row) return;
  const id = String(row.dataset.standbyEditRow);
  const log = standbyV2LogById(id);
  if (!log) return;
  try {
    const startClock = row.querySelector('[data-standby-edit-field="start"]')?.value || '';
    const finishClock = row.querySelector('[data-standby-edit-field="finish"]')?.value || '';
    if (!startClock || !finishClock) throw new Error('Jam mulai dan selesai wajib diisi.');
    const duration = standbyMultiDuration(startClock, finishClock, row.dataset.shiftKind);
    const payload = {
      standby_code_id: row.querySelector('[data-standby-edit-field="standby_code_id"]')?.value || '',
      description: row.querySelector('[data-standby-edit-field="description"]')?.value.trim() || '',
      start_time: standbyMultiTimeToIso(row.dataset.operationalDate, startClock, row.dataset.shiftKind),
      finish_time: standbyMultiTimeToIso(row.dataset.operationalDate, finishClock, row.dataset.shiftKind)
    };
    row.querySelector('[data-standby-edit-duration]').textContent = standbyV2Hours(duration);
    row.dataset.validationError = 'false';
    if (standbyEditPayloadEqual(payload, standbyEditPayloadFromLog(log))) {
      standbyEditDrafts.delete(id); row.dataset.saveState = 'editing';
    } else {
      standbyEditDrafts.set(id, payload); row.dataset.saveState = 'dirty';
    }
    persistStandbyDrafts();
  } catch (error) {
    row.dataset.validationError = 'true';
    updateStandbyEditSessionUi(error.message);
  }
}

function batalkanEditStandbyRow(id) {
  standbyEditDrafts.delete(String(id));
  persistStandbyDrafts();
  const element = document.querySelector(`[data-standby-edit-row="${CSS.escape(String(id))}"]`);
  const slice = (standbyV2Data.slices || []).find(row => String(row.standby_log_id) === String(id));
  if (element && slice) element.outerHTML = renderStandbyTableRow(slice);
}

function batalPerubahanStandby() {
  if (standbyEditDrafts.size && !confirm(`Batalkan ${standbyEditDrafts.size} perubahan Standby dalam sesi ini?`)) return;
  standbyEditDrafts.clear();
  persistStandbyDrafts();
  renderStandbyWorkspace();
}

async function simpanSesiStandby() {
  if (!standbyEditDrafts.size || standbyEditSaving) return;
  const invalid = document.querySelector('[data-standby-edit-row][data-validation-error="true"]');
  if (invalid) { invalid.scrollIntoView({ behavior: 'smooth', block: 'center' }); return updateStandbyEditSessionUi('Perbaiki rentang jam yang ditandai sebelum menyimpan.'); }
  standbyEditSaving = true;
  updateStandbyEditSessionUi();
  const viewSession = captureStandbyViewSession();
  let failureMessage = '';
  try {
    const changes = [...standbyEditDrafts.entries()].map(([id, payload]) => ({ id, ...payload }));
    const response = await fetch(getProdApiUrl('/api/admin/production/standby/session'), {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify({ changes })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    standbyEditDrafts.clear();
    persistStandbyDrafts();
    await muatProdStandby();
    await restoreStandbyViewSession(viewSession);
    alert(`${result.updated || changes.length} perubahan Standby berhasil disimpan dalam satu sesi dan menunggu review.`);
  } catch (error) {
    failureMessage = `Gagal menyimpan: ${error.message}`;
  } finally {
    standbyEditSaving = false;
    updateStandbyEditSessionUi(failureMessage);
  }
}

function visibleStandbyDeleteInputs() {
  return [...document.querySelectorAll('#standbyUnitWorkspace [data-standby-select]')].filter(input => {
    for (let ancestor = input.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.tagName === 'DETAILS' && !ancestor.open) return false;
      if (ancestor.hidden) return false;
    }
    return input.getClientRects().length > 0;
  });
}

function syncStandbyBulkDeleteUi() {
  const bar = document.getElementById('standbyBulkDeleteBar');
  const toggle = document.getElementById('btnToggleDeleteStandbyLogs');
  const count = document.getElementById('standbyDeleteSelectedCount');
  const button = document.getElementById('btnDeleteSelectedStandby');
  const selectAll = document.getElementById('standbySelectAll');
  if (bar) bar.hidden = !standbyBulkDeleteMode;
  if (toggle) toggle.textContent = standbyBulkDeleteMode ? 'Tutup Mode Hapus' : 'Hapus';
  if (count) count.textContent = `${standbyDeleteSelection.size} Standby dipilih`;
  if (button) button.disabled = standbyDeleteSelection.size === 0;
  const visible = visibleStandbyDeleteInputs();
  const checked = visible.filter(input => standbyDeleteSelection.has(String(input.value)));
  visible.forEach(input => { input.checked = standbyDeleteSelection.has(String(input.value)); input.closest('tr')?.classList.toggle('is-delete-selected', input.checked); });
  if (selectAll) {
    selectAll.checked = visible.length > 0 && checked.length === visible.length;
    selectAll.indeterminate = checked.length > 0 && checked.length < visible.length;
    selectAll.disabled = visible.length === 0;
  }
}

async function toggleStandbyBulkDeleteMode() {
  if (!standbyBulkDeleteMode && standbyEditDrafts.size) return alert('Simpan atau batalkan perubahan Standby sebelum membuka Mode Hapus.');
  const viewSession = captureStandbyViewSession();
  standbyBulkDeleteMode = !standbyBulkDeleteMode;
  standbyDeleteSelection.clear();
  renderStandbyWorkspace();
  await restoreStandbyViewSession(viewSession);
}

async function cancelStandbyBulkDelete() {
  const viewSession = captureStandbyViewSession();
  standbyBulkDeleteMode = false;
  standbyDeleteSelection.clear();
  renderStandbyWorkspace();
  await restoreStandbyViewSession(viewSession);
}

function toggleStandbySelection(id, checked) {
  if (checked) standbyDeleteSelection.add(String(id)); else standbyDeleteSelection.delete(String(id));
  syncStandbyBulkDeleteUi();
}

function toggleSelectAllStandby(checked) {
  visibleStandbyDeleteInputs().forEach(input => {
    if (checked) standbyDeleteSelection.add(String(input.value)); else standbyDeleteSelection.delete(String(input.value));
  });
  syncStandbyBulkDeleteUi();
}

async function deleteSelectedStandbyLogs() {
  const ids = [...standbyDeleteSelection];
  if (!ids.length || !confirm(`Hapus ${ids.length} record Standby terpilih?\n\nRecord akan disembunyikan dari laporan dan KPI, tetapi audit penghapusan tetap tersimpan.`)) return;
  const viewSession = captureStandbyViewSession();
  const button = document.getElementById('btnDeleteSelectedStandby');
  if (button) { button.disabled = true; button.textContent = 'Menghapusâ€¦'; }
  try {
    const response = await fetch(getProdApiUrl('/api/admin/production/standby/batch'), {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify({ ids })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    standbyDeleteSelection.clear();
    standbyBulkDeleteMode = false;
    await muatProdStandby();
    await restoreStandbyViewSession(viewSession);
    alert(`${result.deleted || ids.length} record Standby berhasil dihapus.`);
  } catch (error) {
    alert(`Gagal menghapus Standby: ${error.message}`);
    syncStandbyBulkDeleteUi();
  } finally {
    if (button) button.textContent = 'Hapus Terpilih';
  }
}

function renderStandbyWorkspace() {
  const workspace = document.getElementById('standbyUnitWorkspace');
  if (!workspace) return;
  const rows = filteredStandbyV2Slices();
  const actualUnitKeys = new Set(rows.map(row => standbyDisplayedUnitKey(row.operational_date, row.shift_id, row.equipment_id)));
  const displayRows = filteredStandbyDisplayedUnits().filter(row => !actualUnitKeys.has(standbyDisplayedUnitKey(row.operational_date, row.shift_id, row.equipment_id)));
  const workspaceRows = [...rows, ...displayRows];
  const hours = rows.reduce((sum, row) => sum + Number(row.counted_hours || 0), 0);
  const events = new Set(rows.filter(row => Number(row.counted_hours) > 0).map(row => row.standby_log_id));
  const units = new Set(rows.filter(row => Number(row.counted_hours) > 0).map(row => row.equipment_id));
  const pending = new Set(rows.filter(row => row.review_status === 'pending').map(row => row.standby_log_id));
  const reclassified = new Set(rows.filter(row => row.lifecycle_status === 'reclassified').map(row => row.standby_log_id));
  const controls = filteredStandbyMohhControls();
  const mohhReady = controls.filter(control => ['balanced','closed'].includes(control.status)).length;
  const mohhIssues = controls.filter(control => !['balanced','closed'].includes(control.status)).length;
  const kpis = document.getElementById('standbyKpiGrid');
  if (kpis) kpis.innerHTML = `
    <article><small>Total Standby</small><b>${standbyV2Hours(hours)} Jam</b><span>Durasi terhitung sesuai filter</span></article>
    <article><small>Event</small><b>${events.size}</b><span>Record standby terhitung</span></article>
    <article><small>Unit Count</small><b>${units.size}</b><span>Unit unik periode</span></article>
    <article class="is-link"><button class="standby-kpi-link" type="button" onclick="bukaStandbyPendingKpi()" aria-label="Tampilkan ${pending.size} Standby belum direview"><small>Belum Direview</small><b>${pending.size}</b><span>Menunggu validasi <em>Lihat data →</em></span></button></article>
    <article class="is-link"><button class="standby-kpi-link" type="button" onclick="bukaStandbyReclassifiedKpi()" aria-label="Tampilkan ${reclassified.size} Standby yang direklasifikasi ke Breakdown"><small>Reclassified ke BD</small><b>${reclassified.size}</b><span>Tidak masuk jam standby <em>Lihat data →</em></span></button></article>
    <article class="is-link"><button class="standby-kpi-link" type="button" onclick="bukaStandbyDataQuality(true)" aria-label="Tampilkan kontrol MOHH"><small>Kontrol MOHH</small><b>${mohhReady}/${controls.length}</b><span>${mohhIssues} unit-shift perlu koreksi <em>Lihat data →</em></span></button></article>`;
  const reviewBadge = document.getElementById('standbyReviewBadge');
  if (reviewBadge) reviewBadge.textContent = String(pending.size);
  const qualityBadge = document.getElementById('standbyQualityBadge');
  if (qualityBadge) qualityBadge.textContent = String(mohhIssues);
  const from = document.getElementById('slicerStandbyFrom')?.value || standbyV2PreviousDate();
  const to = document.getElementById('slicerStandbyTo')?.value || from;
  const dates = standbyDateRange(from, to);
  const selectedShift = document.getElementById('slicerStandbyShiftV2')?.value || '';
  const shifts = dayNightShifts().filter(shift => !selectedShift || String(shift.id) === selectedShift);
  if (!dates.length || !shifts.length) {
    workspace.innerHTML = '<div class="standby-empty">Periode atau master shift belum tersedia.</div>';
    syncStandbyBulkDeleteUi();
    return;
  }
  workspace.innerHTML = [...dates].sort((a, b) => b.localeCompare(a)).map(date => {
    const dateRows = workspaceRows.filter(row => row.operational_date === date);
    const dateActualRows = rows.filter(row => row.operational_date === date);
    return `<section class="standby-day-group"><header><div><b>${escapeMinePlanning(formatTanggalMining(date))}</b><span>Hari operasional 06:00–06:00</span></div><strong>${standbyV2Hours(dateActualRows.reduce((sum, row) => sum + Number(row.counted_hours || 0), 0))} jam</strong></header>
      ${shifts.map(shift => {
        const shiftRows = dateRows.filter(row => String(row.shift_id) === String(shift.id));
        const shiftActualRows = rows.filter(row => row.operational_date === date && String(row.shift_id) === String(shift.id));
        const shiftName = /siang/i.test(shift.nama_shift || '') ? 'Shift Siang' : 'Shift Malam';
        const typeGroups = [...standbyGroupMap(shiftRows, row => row.kelas_alat || 'Tanpa Jenis').entries()].sort((left, right) => String(left[0]).localeCompare(String(right[0]), 'id-ID'));
        const content = typeGroups.length ? typeGroups.map(([type, typeRows]) => `<details class="standby-type-group" data-standby-view-key="${escapeMinePlanning(standbyViewKey('type', date, shift.id, type))}" ontoggle="syncStandbyBulkDeleteUi()"><summary>${escapeMinePlanning(type)} <span>${new Set(typeRows.map(row => row.equipment_id)).size} unit</span></summary>
          ${[...standbyGroupMap(typeRows, row => row.class_unit || 'Tanpa Class').entries()].sort((left, right) => String(left[0]).localeCompare(String(right[0]), 'id-ID', { numeric: true })).map(([unitClass, classRows]) => `<div class="standby-class-group"><h4>Class ${escapeMinePlanning(unitClass)}</h4>
            ${[...standbyGroupMap(classRows, row => row.equipment_id || row.kode_alat).values()].sort((left, right) => String(left[0]?.kode_alat || '').localeCompare(String(right[0]?.kode_alat || ''), 'id-ID', { numeric: true })).map(unitRows => standbyRenderUnitCard(unitRows)).join('')}
          </div>`).join('')}
        </details>`).join('') : '<div class="standby-shift-empty"><b>Belum ada unit pada shift ini</b><span>Klik Input Unit untuk menampilkan unit yang akan diisi Standby.</span></div>';
        return `<details class="standby-shift-group" data-standby-view-key="${escapeMinePlanning(standbyViewKey('shift', date, shift.id))}" ontoggle="syncStandbyBulkDeleteUi()"><summary><div class="standby-shift-summary-label"><b>${escapeMinePlanning(shiftName)}</b><span>${standbyV2Hours(shiftActualRows.reduce((sum, row) => sum + Number(row.counted_hours || 0), 0))} jam</span></div><button class="tombol tombol--kecil standby-input-unit-button" type="button" onclick="event.preventDefault();event.stopPropagation();bukaInputUnitStandby('${escapeMinePlanning(date)}','${escapeMinePlanning(shift.id)}')">+ Input Unit</button></summary>${content}</details>`;
      }).join('')}
    </section>`;
  }).join('');
  syncStandbyBulkDeleteUi();
}

function renderStandbyActivePanel() {
  const panel = document.getElementById('standbyActivePanel');
  if (!panel) return;
  const active = standbyV2Data.active || [];
  panel.hidden = !active.length;
  panel.innerHTML = active.length ? `<div><b>Standby Aktif Hari Ini</b><span>${active.length} unit masih memiliki jam berjalan, termasuk verifikasi Produksi.</span></div><div class="standby-active-list">${active.map(row => `<span><b>${escapeMinePlanning(row.kode_alat)}</b> · ${escapeMinePlanning(row.kode_standby)} · ${standbyV2Hours(row.raw_duration_hours)} jam</span>`).join('')}</div>` : '';
}

function standbyUnitOpenKeys(operationalDate, shiftId, unit) {
  return [
    standbyViewKey('shift', operationalDate, shiftId),
    standbyViewKey('type', operationalDate, shiftId, unit.kelas_alat || 'Tanpa Jenis'),
    standbyViewKey('unit', operationalDate, shiftId, unit.id || unit.kode_alat)
  ];
}

function standbySplitHourOptions(shiftKind, role, selectedValue, includeEmpty = false) {
  const values = shiftKind === 'siang'
    ? Array.from({ length: role === 'start' ? 12 : 13 }, (_, index) => index + 6)
    : [...Array.from({ length: 6 }, (_, index) => index + 18), ...Array.from({ length: role === 'start' ? 6 : 7 }, (_, index) => index)];
  return `${includeEmpty ? '<option value="">Pilih jam</option>' : ''}${values.map(hour => {
    const value = String(hour).padStart(2, '0');
    return `<option value="${value}"${value === selectedValue ? ' selected' : ''}>${value}</option>`;
  }).join('')}`;
}

function standbySplitMinuteOptions(selectedValue = '00', boundaryOnly = false, includeEmpty = false) {
  const values = boundaryOnly ? [0] : Array.from({ length: 60 }, (_, index) => index);
  return `${includeEmpty && !boundaryOnly ? '<option value="">Pilih menit</option>' : ''}${values.map(minute => {
    const value = String(minute).padStart(2, '0');
    return `<option value="${value}"${value === selectedValue ? ' selected' : ''}>${value}</option>`;
  }).join('')}`;
}

function standbySplitClock(hourElementId, minuteElementId) {
  const hour = document.getElementById(hourElementId)?.value || '';
  const minute = document.getElementById(minuteElementId)?.value || '';
  if (!hour || !minute) throw new Error('Jam dan menit wajib dipilih.');
  return `${hour}:${minute}`;
}

async function bukaInputUnitStandby(operationalDate, shiftId) {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  if (!(masterProdData.equipment || []).length) await muatMasterDataProduksi();
  const shift = dayNightShifts().find(item => String(item.id) === String(shiftId));
  if (!shift) return alert('Master shift tidak ditemukan.');
  const filterType = document.getElementById('slicerStandbyJenis')?.value || '';
  const filterClass = document.getElementById('slicerStandbyClass')?.value || '';
  const filterUnit = document.getElementById('slicerStandbyUnit')?.value || '';
  const units = [...(masterProdData.equipment || [])].filter(unit => unit.id && unit.kode_alat &&
    (!filterType || unit.kelas_alat === filterType) &&
    (!filterClass || String(unit.class_unit || '') === filterClass) &&
    (!filterUnit || String(unit.id) === filterUnit)
  ).sort((left, right) => String(left.kode_alat).localeCompare(String(right.kode_alat), 'id-ID', { numeric: true }));
  if (!units.length) return alert('Tidak ada unit aktif yang sesuai filter halaman.');
  const types = [...new Set(units.map(unit => unit.kelas_alat || 'Tanpa Jenis'))].sort((left, right) => left.localeCompare(right, 'id-ID'));
  const shiftName = /siang/i.test(shift.nama_shift || '') ? 'Shift Siang' : 'Shift Malam';
  const visibleKeys = new Set([
    ...(standbyV2Data.slices || []).filter(row => row.operational_date === operationalDate && String(row.shift_id) === String(shiftId)).map(row => standbyDisplayedUnitKey(operationalDate, shiftId, row.equipment_id)),
    ...standbyDisplayedUnits.keys()
  ]);
  konten.innerHTML = `<div class="standby-inline-modal"><header><div><h3>+ Input Unit</h3><p>${escapeMinePlanning(formatTanggalMining(operationalDate))} · ${escapeMinePlanning(shiftName)}</p></div><button type="button" class="tombol tombol--ghost" onclick="tutupModalGenerik()">Tutup</button></header>
    <div class="standby-inline-info">Pemilihan ini hanya menampilkan unit di tabel. Belum ada jam atau record Standby yang dibuat.</div>
    <form id="formStandbyInputUnit" class="standby-inline-form">
      <label>Jenis Unit *<select id="standbyInputUnitType" required>${types.map(type => `<option value="${escapeMinePlanning(type)}">${escapeMinePlanning(type)}</option>`).join('')}</select></label>
      <label>Kode Unit *<select id="standbyInputUnitCode" required></select></label>
      <div class="standby-inline-actions"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Tampilkan Unit</button></div>
    </form>
  </div>`;
  overlay.hidden = false;
  const typeSelect = document.getElementById('standbyInputUnitType');
  const unitSelect = document.getElementById('standbyInputUnitCode');
  const renderUnitOptions = () => {
    const selectedType = typeSelect.value;
    const available = units.filter(unit => (unit.kelas_alat || 'Tanpa Jenis') === selectedType);
    unitSelect.innerHTML = '<option value="">Pilih kode unit</option>' + available.map(unit => {
      const shown = visibleKeys.has(standbyDisplayedUnitKey(operationalDate, shiftId, unit.id));
      return `<option value="${escapeMinePlanning(unit.id)}">${escapeMinePlanning(unit.kode_alat)} · ${escapeMinePlanning(unit.class_unit || 'Tanpa Class')}${shown ? ' · Sudah tampil' : ''}</option>`;
    }).join('');
  };
  typeSelect.addEventListener('change', renderUnitOptions);
  renderUnitOptions();
  document.getElementById('formStandbyInputUnit').addEventListener('submit', async event => {
    event.preventDefault();
    const unit = units.find(item => String(item.id) === String(unitSelect.value));
    if (!unit) return alert('Pilih kode unit terlebih dahulu.');
    const row = {
      __display_only: true,
      operational_date: operationalDate,
      shift_id: shift.id,
      shift_name: shiftName,
      shift_kind: standbyShiftKindFromName(shiftName),
      equipment_id: unit.id,
      kode_alat: unit.kode_alat,
      kelas_alat: unit.kelas_alat || 'Tanpa Jenis',
      class_unit: unit.class_unit || 'Tanpa Class',
      tipe_alat: unit.tipe_alat || unit.brand || '',
      counted_hours: 0,
      raw_hours: 0
    };
    standbyDisplayedUnits.set(standbyDisplayedUnitKey(operationalDate, shift.id, unit.id), row);
    const viewSession = captureStandbyViewSession();
    viewSession.openKeys = [...new Set([...(viewSession.openKeys || []), ...standbyUnitOpenKeys(operationalDate, shift.id, unit)])];
    tutupModalGenerik();
    renderStandbyWorkspace();
    await restoreStandbyViewSession(viewSession);
  });
}

async function bukaInsertStandbyUnit(operationalDate, shiftId, equipmentId) {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  if (!(masterProdData.equipment || []).length || !(masterProdData.standbyCodes || []).length) await muatMasterDataProduksi();
  const shift = dayNightShifts().find(item => String(item.id) === String(shiftId));
  const unit = (masterProdData.equipment || []).find(item => String(item.id) === String(equipmentId));
  const codes = (masterProdData.standbyCodes || []).filter(code => code.id && !code.is_system && !code.is_locked)
    .sort((left, right) => String(left.kode).localeCompare(String(right.kode), 'id-ID', { numeric: true }));
  if (!shift || !unit) return alert('Shift atau unit tidak ditemukan pada master data.');
  if (!codes.length) return alert('Parameter Standby manual belum tersedia.');
  const control = standbyMohhControlFor({ operational_date: operationalDate, shift_id: shiftId, equipment_id: equipmentId });
  if (control?.closure?.status === 'closed') return alert('Shift unit ini sudah ditutup/freeze. Buka kembali shift sebelum menambah Standby.');
  const shiftName = /siang/i.test(shift.nama_shift || '') ? 'Shift Siang' : 'Shift Malam';
  const shiftKind = standbyShiftKindFromName(shiftName);
  const initialStart = shiftKind === 'siang' ? '06:00' : '18:00';
  const initialFinish = shiftKind === 'siang' ? '07:00' : '19:00';
  const viewSession = captureStandbyViewSession();
  konten.innerHTML = `<div class="standby-inline-modal standby-insert-modal"><header><div><h3>+ Insert Standby</h3><p>${escapeMinePlanning(unit.kode_alat)} · ${escapeMinePlanning(formatTanggalMining(operationalDate))} · ${escapeMinePlanning(shiftName)}</p></div><button type="button" class="tombol tombol--ghost" onclick="tutupModalGenerik()">Tutup</button></header>
    <div class="standby-inline-info">Jam dibatasi sesuai ${escapeMinePlanning(shiftKind === 'siang' ? '06:00–18:00' : '18:00–06:00')} dan akan masuk ke kontrol MOHH setelah disimpan.</div>
    <form id="formInsertStandbyUnit" class="standby-inline-form">
      <label class="is-wide">Parameter Standby *<select id="insertStandbyCode" required><option value="">Pilih parameter Standby</option>${codes.map(code => `<option value="${escapeMinePlanning(code.id)}">${escapeMinePlanning(code.kode)} · ${escapeMinePlanning(code.kategori)}</option>`).join('')}</select></label>
      <div class="standby-inline-time-field"><span>Mulai *</span><div class="standby-time-parts"><label>Jam<select id="insertStandbyStartHour" required>${standbySplitHourOptions(shiftKind, 'start', initialStart.slice(0, 2))}</select></label><label>Menit<select id="insertStandbyStartMinute" required>${standbySplitMinuteOptions(initialStart.slice(3))}</select></label></div></div>
      <div class="standby-inline-time-field"><span>Selesai *</span><div class="standby-time-parts"><label>Jam<select id="insertStandbyFinishHour" required>${standbySplitHourOptions(shiftKind, 'finish', initialFinish.slice(0, 2))}</select></label><label>Menit<select id="insertStandbyFinishMinute" required>${standbySplitMinuteOptions(initialFinish.slice(3))}</select></label></div></div>
      <label class="is-wide">Keterangan <span id="insertStandbyDescriptionHint"></span><textarea id="insertStandbyDescription" rows="3" placeholder="Penyebab, lokasi, atau informasi pendukung"></textarea></label>
      <div id="insertStandbyError" class="standby-multi-error is-wide" role="alert" hidden></div>
      <div class="standby-inline-actions is-wide"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button id="insertStandbySubmit" type="submit" class="tombol tombol--utama">Simpan Standby</button></div>
    </form>
  </div>`;
  overlay.hidden = false;
  const codeSelect = document.getElementById('insertStandbyCode');
  const description = document.getElementById('insertStandbyDescription');
  const descriptionHint = document.getElementById('insertStandbyDescriptionHint');
  const startHour = document.getElementById('insertStandbyStartHour');
  const startMinute = document.getElementById('insertStandbyStartMinute');
  const finishHour = document.getElementById('insertStandbyFinishHour');
  const finishMinute = document.getElementById('insertStandbyFinishMinute');
  const syncBoundaryMinutes = (hourSelect, minuteSelect, role) => {
    const boundaryHour = shiftKind === 'siang' ? '18' : '06';
    const boundaryOnly = role === 'finish' && hourSelect.value === boundaryHour;
    const previous = minuteSelect.value;
    minuteSelect.innerHTML = standbySplitMinuteOptions(boundaryOnly ? '00' : previous, boundaryOnly);
    if (!boundaryOnly && [...minuteSelect.options].some(option => option.value === previous)) minuteSelect.value = previous;
  };
  startHour.addEventListener('change', () => syncBoundaryMinutes(startHour, startMinute, 'start'));
  finishHour.addEventListener('change', () => syncBoundaryMinutes(finishHour, finishMinute, 'finish'));
  const syncDescriptionRule = () => {
    const code = codes.find(item => String(item.id) === String(codeSelect.value));
    description.required = Boolean(code?.requires_description);
    descriptionHint.textContent = code?.requires_description ? '(wajib untuk parameter ini)' : '(opsional)';
  };
  codeSelect.addEventListener('change', syncDescriptionRule);
  syncDescriptionRule();
  document.getElementById('formInsertStandbyUnit').addEventListener('submit', async event => {
    event.preventDefault();
    const errorBox = document.getElementById('insertStandbyError');
    const submit = document.getElementById('insertStandbySubmit');
    errorBox.hidden = true;
    try {
      const startClock = standbySplitClock('insertStandbyStartHour', 'insertStandbyStartMinute');
      const finishClock = standbySplitClock('insertStandbyFinishHour', 'insertStandbyFinishMinute');
      standbyMultiDuration(startClock, finishClock, shiftKind);
      const payload = {
        tanggal: operationalDate,
        shift_id: shift.id,
        equipment_id: unit.id,
        standby_code_id: codeSelect.value,
        start_time: standbyMultiTimeToIso(operationalDate, startClock, shiftKind),
        finish_time: standbyMultiTimeToIso(operationalDate, finishClock, shiftKind),
        description: description.value.trim()
      };
      submit.disabled = true;
      submit.textContent = 'Menyimpan…';
      const response = await fetch(getProdApiUrl('/api/admin/production/standby'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      viewSession.openKeys = [...new Set([...(viewSession.openKeys || []), ...standbyUnitOpenKeys(operationalDate, shift.id, unit)])];
      tutupModalGenerik();
      await muatProdStandby();
      await restoreStandbyViewSession(viewSession);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Simpan Standby';
    }
  });
}

function resetSlicerStandbyV2() {
  ['slicerStandbyShiftV2','slicerStandbyJenis','slicerStandbyClass','slicerStandbyUnit','slicerStandbyCodeV2','slicerStandbyReview'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const previous = standbyV2PreviousDate();
  document.getElementById('slicerStandbyFrom').value = previous;
  document.getElementById('slicerStandbyTo').value = previous;
  void muatProdStandby();
}

function standbyV2ManualCodeOptions() {
  return (masterProdData.standbyCodes || []).filter(code => !code.is_system && !code.is_locked)
    .map(code => `<option value="${escapeMinePlanning(code.id)}">${escapeMinePlanning(code.kode)} · ${escapeMinePlanning(code.kategori)}</option>`).join('');
}

function standbyV2UnitOptions(selected = '') {
  return (masterProdData.equipment || []).filter(unit => unit.id && unit.kode_alat).sort((a, b) => String(a.kode_alat).localeCompare(String(b.kode_alat), 'id-ID', { numeric: true }))
    .map(unit => `<option value="${escapeMinePlanning(unit.id)}"${String(unit.id) === String(selected) ? ' selected' : ''}>${escapeMinePlanning(unit.kelas_alat)} · ${escapeMinePlanning(unit.class_unit || 'Tanpa Class')} · ${escapeMinePlanning(unit.kode_alat)}</option>`).join('');
}

function bukaModalInputStandbySingleLegacy(preselectedEquipmentId = '') {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  const date = document.getElementById('slicerStandbyFrom')?.value || standbyV2PreviousDate();
  konten.innerHTML = `<div class="standby-modal-v2"><h3>⏱️ Catat Standby Unit</h3><p>Waktu dapat melewati shift atau tengah malam; laporan akan membaginya otomatis.</p><form id="formStandbyV2" class="breakdown-form-grid">
    <div class="breakdown-form-field"><label>Tanggal Operasional *</label><input id="svTanggal" type="date" value="${escapeMinePlanning(date)}" required /></div>
    <div class="breakdown-form-field"><label>Shift Awal *</label><select id="svShift" required>${standbyShiftOptions('')}</select></div>
    <div class="breakdown-form-field is-wide"><label>Unit *</label><select id="svUnit" required><option value="">Pilih Unit</option>${standbyV2UnitOptions(preselectedEquipmentId)}</select></div>
    <div class="breakdown-form-field is-wide"><label>Kode Standby *</label><select id="svCode" required><option value="">Pilih Kode Standby</option>${standbyV2ManualCodeOptions()}</select></div>
    <div class="breakdown-form-field"><label>Mulai *</label><input id="svStart" type="datetime-local" value="${escapeMinePlanning(`${date}T06:00`)}" required /></div>
    <div class="breakdown-form-field"><label>Selesai *</label><input id="svFinish" type="datetime-local" value="${escapeMinePlanning(`${date}T07:00`)}" required /></div>
    <div class="breakdown-form-field is-wide"><label>Keterangan</label><textarea id="svDescription" rows="3" placeholder="Penyebab, lokasi, atau informasi pendukung"></textarea></div>
    <div class="breakdown-modal-actions is-wide"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button class="tombol tombol--utama" type="submit">Simpan Standby</button></div>
  </form></div>`;
  overlay.hidden = false;
  document.getElementById('formStandbyV2').addEventListener('submit', async event => {
    event.preventDefault();
    const payload = { tanggal: document.getElementById('svTanggal').value, shift_id: document.getElementById('svShift').value, equipment_id: document.getElementById('svUnit').value, standby_code_id: document.getElementById('svCode').value, start_time: breakdownToIso(document.getElementById('svStart').value), finish_time: breakdownToIso(document.getElementById('svFinish').value), description: document.getElementById('svDescription').value.trim() };
    try {
      const response = await fetch(getProdApiUrl('/api/admin/production/standby'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      tutupModalGenerik(); await muatProdStandby();
    } catch (error) { alert(`Gagal menyimpan Standby: ${error.message}`); }
  });
}

function standbyMultiUnitType(unit) {
  return String(unit?.kelas_alat || '').trim() || 'Tanpa Jenis';
}

function standbyMultiOperationalOffset(timeValue, shiftKind) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(timeValue || '').trim());
  if (!match) throw new Error('Jam harus menggunakan format HH:MM.');
  const hours = Number(match[1]);
  const minutesPart = Number(match[2]);
  if (hours > 23 || minutesPart > 59) throw new Error('Jam tidak valid.');
  const minutes = (hours * 60) + minutesPart;
  if (shiftKind === 'siang') {
    if (minutes < 360 || minutes > 1080) throw new Error('Shift Siang hanya menerima jam 06:00–18:00.');
    return minutes;
  }
  if (minutes >= 1080) return minutes;
  if (minutes <= 360) return minutes + 1440;
  throw new Error('Shift Malam hanya menerima jam 18:00–06:00.');
}

function standbyMultiTimeOptions(shiftKind, selectedValue = '') {
  const firstMinute = shiftKind === 'siang' ? 360 : 1080;
  const lastMinute = shiftKind === 'siang' ? 1080 : 1800;
  const selected = String(selectedValue || '');
  const options = ['<option value="">Pilih jam</option>'];
  for (let minute = firstMinute; minute <= lastMinute; minute += 1) {
    const clockMinute = minute % 1440;
    const hour = String(Math.floor(clockMinute / 60)).padStart(2, '0');
    const minutePart = String(clockMinute % 60).padStart(2, '0');
    const value = `${hour}:${minutePart}`;
    options.push(`<option value="${value}"${value === selected ? ' selected' : ''}>${value}</option>`);
  }
  return options.join('');
}

function standbyMultiAddDate(dateValue, days) {
  const date = new Date(`${dateValue}T12:00:00`);
  date.setDate(date.getDate() + days);
  return getLocalDateInputValue(date);
}

function standbyMultiTimeToIso(dateValue, timeValue, shiftKind) {
  const offset = standbyMultiOperationalOffset(timeValue, shiftKind);
  const calendarDate = offset >= 1440 ? standbyMultiAddDate(dateValue, 1) : dateValue;
  return new Date(`${calendarDate}T${timeValue}:00+07:00`).toISOString();
}

function standbyMultiDuration(startValue, finishValue, shiftKind) {
  const start = standbyMultiOperationalOffset(startValue, shiftKind);
  const finish = standbyMultiOperationalOffset(finishValue, shiftKind);
  if (finish <= start) throw new Error('Jam selesai harus lebih akhir dari jam mulai.');
  return (finish - start) / 60;
}

async function bukaModalInputStandby(preselectedEquipmentId = '') {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  // Selalu refresh master sebelum membuka form. Ini mencegah ID shift/unit lama
  // dari tab yang sudah lama terbuka ikut terkirim setelah master diperbarui.
  await muatMasterDataProduksi();

  const initialEquipmentId = String(
    preselectedEquipmentId || document.getElementById('slicerStandbyUnit')?.value || ''
  );

  const units = [...(masterProdData.equipment || [])]
    .filter(unit => unit.id && unit.kode_alat)
    .sort((a, b) => String(a.kode_alat).localeCompare(String(b.kode_alat), 'id-ID', { numeric: true }));
  const codes = [...(masterProdData.standbyCodes || [])]
    .filter(code => code.id && !code.is_system && !code.is_locked)
    .sort((a, b) => String(a.kode).localeCompare(String(b.kode), 'id-ID', { numeric: true }));
  const shifts = dayNightShifts();
  if (!units.length) return alert('List Equipment belum memiliki unit aktif.');
  if (!codes.length) return alert('Master kode standby manual belum tersedia.');
  if (shifts.length < 2) return alert('Master Shift Siang dan Shift Malam wajib tersedia.');

  const selectedUnitIds = new Set(initialEquipmentId ? [initialEquipmentId] : []);
  const selectedCodeIds = new Set();
  const preselectedUnit = units.find(unit => String(unit.id) === initialEquipmentId);
  const selectedTypes = new Set(preselectedUnit ? [standbyMultiUnitType(preselectedUnit)] : []);
  const cellDrafts = new Map();
  const date = document.getElementById('slicerStandbyFrom')?.value || standbyV2PreviousDate();
  const typeValues = [...new Set(units.map(standbyMultiUnitType))].sort((a, b) => a.localeCompare(b, 'id-ID', { numeric: true }));
  const shiftOptions = shifts.map(shift => `<option value="${escapeMinePlanning(shift.id)}">${/siang/i.test(shift.nama_shift) ? 'Siang (06:00–18:00)' : 'Malam (18:00–06:00)'}</option>`).join('');

  konten.innerHTML = `<div class="standby-multi-modal">
    <header class="standby-multi-head"><div><h3>+ Multi Unit Standby</h3><p>Pilih unit dan kode standby, lalu tetapkan jam yang berlaku massal.</p></div><span id="smSelectionBadge">0 unit · 0 kode</span></header>
    <form id="formStandbyMulti">
      <section class="standby-multi-step"><header><b>1</b><div><strong>Periode Operasional</strong><small>Tanggal dan shift menjadi sumber periode seluruh record.</small></div></header><div class="standby-multi-period">
        <label>Tanggal Operasional *<input id="smDate" type="date" value="${escapeMinePlanning(date)}" required /></label>
        <label>Shift *<select id="smShift" required>${shiftOptions}</select></label>
      </div></section>
      <section class="standby-multi-step"><header><b>2</b><div><strong>Jenis Unit</strong><small>Centang satu atau beberapa jenis unit.</small></div></header><div id="smTypeList" class="standby-check-grid">${typeValues.map(type => `<label><input type="checkbox" name="smType" value="${escapeMinePlanning(type)}"${selectedTypes.has(type) ? ' checked' : ''}/><span>${escapeMinePlanning(type)}</span></label>`).join('')}</div></section>
      <section class="standby-multi-step"><header><b>3</b><div><strong>Kode Unit</strong><small>Daftar unit otomatis mengikuti jenis unit yang dicentang.</small></div></header>
        <div class="standby-check-toolbar"><input id="smUnitSearch" type="search" placeholder="Cari kode, class, tipe atau brand..."/><button id="smSelectAllUnits" class="tombol tombol--kecil" type="button">Pilih Semua Terlihat</button><button id="smClearUnits" class="tombol tombol--ghost tombol--kecil" type="button">Kosongkan</button></div>
        <div id="smUnitSearchFeedback" class="standby-unit-search-feedback" aria-live="polite"></div>
        <div id="smUnitList" class="standby-check-list"></div></section>
      <section class="standby-multi-step"><header><b>4</b><div><strong>Daftar Standby</strong><small>Setiap kode yang dicentang akan muncul pada form jam massal.</small></div></header><div id="smCodeList" class="standby-check-grid">${codes.map(code => `<label><input type="checkbox" name="smCode" value="${escapeMinePlanning(code.id)}"/><span><strong>${escapeMinePlanning(code.kode)}</strong><small>${escapeMinePlanning(code.kategori)}</small></span></label>`).join('')}</div></section>
      <section class="standby-multi-step"><header><b>5</b><div><strong>Form Jam Standby Massal</strong><small>Satu rentang waktu per kode diterapkan otomatis ke seluruh unit terpilih.</small></div></header>
        <div id="smMatrixEmpty" class="standby-empty">Pilih minimal satu kode standby untuk menampilkan form jam.</div><div id="smMatrixWrap" class="standby-bulk-time-wrap" hidden></div></section>
      <label class="standby-multi-note">Keterangan Umum<textarea id="smDescription" rows="2" placeholder="Lokasi, penyebab, atau informasi pendukung untuk seluruh record"></textarea></label>
      <div id="smFormError" class="standby-multi-error" role="alert" hidden></div>
      <div class="standby-multi-actions"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button id="smSubmit" type="submit" class="tombol tombol--utama">Simpan Multi Unit</button></div>
    </form>
  </div>`;
  overlay.hidden = false;

  const typeList = document.getElementById('smTypeList');
  const unitList = document.getElementById('smUnitList');
  const codeList = document.getElementById('smCodeList');
  const matrixWrap = document.getElementById('smMatrixWrap');
  const matrixEmpty = document.getElementById('smMatrixEmpty');
  const search = document.getElementById('smUnitSearch');
  const searchFeedback = document.getElementById('smUnitSearchFeedback');
  const badge = document.getElementById('smSelectionBadge');
  const formError = document.getElementById('smFormError');
  const showFormError = message => {
    formError.textContent = String(message || '');
    formError.hidden = !message;
  };
  const syncCheckedSelections = () => {
    selectedUnitIds.clear();
    unitList.querySelectorAll('input[name="smUnit"]:checked').forEach(input => selectedUnitIds.add(String(input.value)));
    selectedCodeIds.clear();
    codeList.querySelectorAll('input[name="smCode"]:checked').forEach(input => selectedCodeIds.add(String(input.value)));
  };
  const shiftKind = () => {
    const shift = shifts.find(item => String(item.id) === String(document.getElementById('smShift').value));
    return /siang/i.test(shift?.nama_shift || '') ? 'siang' : 'malam';
  };
  const updateBadge = () => { badge.textContent = `${selectedUnitIds.size} unit · ${selectedCodeIds.size} kode · ${selectedUnitIds.size * selectedCodeIds.size} record`; };
  const captureDrafts = () => {
    matrixWrap.querySelectorAll('[data-sm-cell]').forEach(cell => {
      cellDrafts.set(cell.dataset.smCell, {
        startHour: cell.querySelector('[data-sm-start-hour]')?.value || '',
        startMinute: cell.querySelector('[data-sm-start-minute]')?.value || '',
        finishHour: cell.querySelector('[data-sm-finish-hour]')?.value || '',
        finishMinute: cell.querySelector('[data-sm-finish-minute]')?.value || ''
      });
    });
  };
  const clockFromCell = (cell, prefix) => {
    const hour = cell.querySelector(`[data-sm-${prefix}-hour]`)?.value || '';
    const minute = cell.querySelector(`[data-sm-${prefix}-minute]`)?.value || '';
    return hour && minute ? `${hour}:${minute}` : '';
  };
  const updateCellDuration = cell => {
    const output = cell.querySelector('[data-sm-duration]');
    const startHour = cell.querySelector('[data-sm-start-hour]')?.value || '';
    const startMinute = cell.querySelector('[data-sm-start-minute]')?.value || '';
    const finishHour = cell.querySelector('[data-sm-finish-hour]')?.value || '';
    const finishMinute = cell.querySelector('[data-sm-finish-minute]')?.value || '';
    const start = clockFromCell(cell, 'start');
    const finish = clockFromCell(cell, 'finish');
    cell.classList.remove('is-invalid');
    if (![startHour, startMinute, finishHour, finishMinute].some(Boolean)) { output.textContent = 'Kosong'; return; }
    if (!start || !finish) { output.textContent = 'Lengkapi jam dan menit'; cell.classList.add('is-invalid'); return; }
    try { output.textContent = `${standbyV2Hours(standbyMultiDuration(start, finish, shiftKind()))} jam`; }
    catch (error) { output.textContent = error.message; cell.classList.add('is-invalid'); }
  };
  const syncCellBoundaryMinute = cell => {
    const kind = shiftKind();
    const hourSelect = cell.querySelector('[data-sm-finish-hour]');
    const minuteSelect = cell.querySelector('[data-sm-finish-minute]');
    if (!hourSelect || !minuteSelect) return;
    const boundary = hourSelect.value === (kind === 'siang' ? '18' : '06');
    const previous = minuteSelect.value;
    minuteSelect.innerHTML = standbySplitMinuteOptions(boundary ? '00' : previous, boundary, true);
    if (!boundary && [...minuteSelect.options].some(option => option.value === previous)) minuteSelect.value = previous;
  };
  const renderMatrix = () => {
    captureDrafts();
    const selectedCodes = codes.filter(code => selectedCodeIds.has(String(code.id)));
    updateBadge();
    matrixEmpty.hidden = Boolean(selectedCodes.length);
    matrixWrap.hidden = !selectedCodes.length;
    if (matrixWrap.hidden) { matrixWrap.innerHTML = ''; return; }
    matrixWrap.innerHTML = `<div class="standby-bulk-code-grid">${selectedCodes.map(code => {
      const draft = cellDrafts.get(String(code.id)) || { startHour: '', startMinute: '', finishHour: '', finishMinute: '' };
      const kind = shiftKind();
      const finishBoundary = draft.finishHour === (kind === 'siang' ? '18' : '06');
      return `<article class="standby-bulk-code-card" data-sm-cell="${escapeMinePlanning(code.id)}"><header><b>${escapeMinePlanning(code.kode)}</b><small>${escapeMinePlanning(code.kategori)}</small></header><div class="standby-bulk-split-time"><fieldset><legend>Mulai</legend><div><label>Jam<select data-sm-start-hour aria-label="Jam mulai ${escapeMinePlanning(code.kode)}">${standbySplitHourOptions(kind, 'start', draft.startHour, true)}</select></label><label>Menit<select data-sm-start-minute aria-label="Menit mulai ${escapeMinePlanning(code.kode)}">${standbySplitMinuteOptions(draft.startMinute, false, true)}</select></label></div></fieldset><fieldset><legend>Selesai</legend><div><label>Jam<select data-sm-finish-hour aria-label="Jam selesai ${escapeMinePlanning(code.kode)}">${standbySplitHourOptions(kind, 'finish', draft.finishHour, true)}</select></label><label>Menit<select data-sm-finish-minute aria-label="Menit selesai ${escapeMinePlanning(code.kode)}">${standbySplitMinuteOptions(finishBoundary ? '00' : draft.finishMinute, finishBoundary, true)}</select></label></div></fieldset></div><footer><strong data-sm-duration>Kosong</strong><span>Diterapkan ke ${selectedUnitIds.size} unit</span></footer></article>`;
    }).join('')}</div>`;
    matrixWrap.querySelectorAll('[data-sm-cell]').forEach(updateCellDuration);
  };
  const normalizeUnitSearch = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('id-ID').replace(/[^a-z0-9]+/g, ' ').trim();
  const compactUnitSearch = value => normalizeUnitSearch(value).replace(/\s+/g, '');
  const applyUnitSearch = () => {
    const rawKeyword = search.value.trim();
    const keyword = normalizeUnitSearch(rawKeyword);
    const compactKeyword = compactUnitSearch(rawKeyword);
    const tokens = keyword.split(/\s+/).filter(Boolean);
    let visible = 0;
    const items = [...unitList.querySelectorAll('[data-sm-unit-item]')];
    items.forEach(item => {
      const haystack = normalizeUnitSearch(item.dataset.search || '');
      const compactHaystack = compactUnitSearch(item.dataset.search || '');
      const matches = !rawKeyword || tokens.every(token => haystack.includes(token)) || (compactKeyword && compactHaystack.includes(compactKeyword));
      item.hidden = !matches;
      if (matches) visible += 1;
    });
    if (!selectedTypes.size && !rawKeyword) searchFeedback.textContent = 'Pilih Jenis Unit atau langsung ketik kode/class/tipe unit.';
    else if (rawKeyword) searchFeedback.textContent = `${visible} unit ditemukan untuk “${rawKeyword}”${selectedTypes.size ? ' pada jenis terpilih' : ' pada seluruh jenis unit'}.`;
    else searchFeedback.textContent = `${visible} unit tersedia dari ${selectedTypes.size} jenis terpilih.`;
    searchFeedback.classList.toggle('is-empty', Boolean(rawKeyword && visible === 0));
  };
  const renderUnits = () => {
    const hasKeyword = Boolean(search.value.trim());
    const eligible = selectedTypes.size
      ? units.filter(unit => selectedTypes.has(standbyMultiUnitType(unit)))
      : (hasKeyword ? units : []);
    const eligibleIds = new Set(eligible.map(unit => String(unit.id)));
    if (selectedTypes.size) [...selectedUnitIds].forEach(id => { if (!eligibleIds.has(id)) selectedUnitIds.delete(id); });
    unitList.innerHTML = eligible.length ? eligible.map(unit => `<label data-sm-unit-item data-search="${escapeMinePlanning(`${unit.kode_alat} ${unit.kelas_alat || ''} ${unit.class_unit || ''} ${unit.tipe_alat || ''} ${unit.brand || ''}`)}"><input type="checkbox" name="smUnit" value="${escapeMinePlanning(unit.id)}"${selectedUnitIds.has(String(unit.id)) ? ' checked' : ''}/><span><strong>${escapeMinePlanning(unit.kode_alat)}</strong><small>${escapeMinePlanning(standbyMultiUnitType(unit))} · ${escapeMinePlanning(unit.class_unit || 'Tanpa Class')} · ${escapeMinePlanning(unit.tipe_alat || unit.brand || '')}</small></span></label>`).join('') : '<div class="standby-empty">Pilih Jenis Unit atau ketik kata kunci pencarian.</div>';
    applyUnitSearch();
    renderMatrix();
  };

  typeList.addEventListener('change', event => {
    if (!event.target.matches('input[name="smType"]')) return;
    showFormError('');
    if (event.target.checked) selectedTypes.add(event.target.value); else selectedTypes.delete(event.target.value);
    renderUnits();
  });
  unitList.addEventListener('change', event => {
    if (!event.target.matches('input[name="smUnit"]')) return;
    showFormError('');
    let addedType = false;
    if (event.target.checked) {
      selectedUnitIds.add(String(event.target.value));
      const unit = units.find(item => String(item.id) === String(event.target.value));
      const unitType = standbyMultiUnitType(unit);
      if (unit && !selectedTypes.has(unitType)) {
        selectedTypes.add(unitType);
        addedType = true;
        const typeCheckbox = [...typeList.querySelectorAll('input[name="smType"]')].find(input => input.value === unitType);
        if (typeCheckbox) typeCheckbox.checked = true;
      }
    } else selectedUnitIds.delete(String(event.target.value));
    if (addedType) renderUnits(); else renderMatrix();
  });
  codeList.addEventListener('change', event => {
    if (!event.target.matches('input[name="smCode"]')) return;
    showFormError('');
    if (event.target.checked) selectedCodeIds.add(String(event.target.value)); else selectedCodeIds.delete(String(event.target.value));
    renderMatrix();
  });
  search.addEventListener('input', () => {
    if (selectedTypes.size) applyUnitSearch();
    else renderUnits();
  });
  document.getElementById('smSelectAllUnits').addEventListener('click', () => {
    unitList.querySelectorAll('[data-sm-unit-item]:not([hidden]) input[name="smUnit"]').forEach(input => { input.checked = true; selectedUnitIds.add(String(input.value)); });
    renderMatrix();
  });
  document.getElementById('smClearUnits').addEventListener('click', () => { selectedUnitIds.clear(); renderUnits(); });
  document.getElementById('smShift').addEventListener('change', () => {
    cellDrafts.clear();
    matrixWrap.innerHTML = '';
    renderMatrix();
  });
  matrixWrap.addEventListener('input', event => {
    const cell = event.target.closest('[data-sm-cell]');
    if (cell) updateCellDuration(cell);
  });
  matrixWrap.addEventListener('change', event => {
    const cell = event.target.closest('[data-sm-cell]');
    if (cell) {
      if (event.target.matches('[data-sm-finish-hour]')) syncCellBoundaryMinute(cell);
      updateCellDuration(cell);
    }
  });
  document.getElementById('formStandbyMulti').addEventListener('submit', async event => {
    event.preventDefault();
    // Checkbox yang terlihat adalah sumber kebenaran saat submit. Jangan hanya
    // mengandalkan Set internal yang dapat tertinggal setelah render ulang.
    syncCheckedSelections();
    updateBadge();
    captureDrafts();
    showFormError('');
    if (!selectedUnitIds.size) return showFormError('Pilih minimal satu Kode Unit pada langkah 3.');
    if (!selectedCodeIds.size) return showFormError('Pilih minimal satu Kode Standby pada langkah 4.');
    const tanggal = document.getElementById('smDate').value;
    const kind = shiftKind();
    const records = [];
    try {
      const templates = codes.filter(code => selectedCodeIds.has(String(code.id))).map(code => {
        const draft = cellDrafts.get(String(code.id)) || {};
        const start = draft.startHour && draft.startMinute ? `${draft.startHour}:${draft.startMinute}` : '';
        const finish = draft.finishHour && draft.finishMinute ? `${draft.finishHour}:${draft.finishMinute}` : '';
        if (!start || !finish) throw new Error(`${code.kode}: jam dan menit mulai/selesai wajib diisi.`);
        standbyMultiDuration(start, finish, kind);
        return { standby_code_id: code.id, start_time: standbyMultiTimeToIso(tanggal, start, kind), finish_time: standbyMultiTimeToIso(tanggal, finish, kind), kode: code.kode };
      });
      const ordered = [...templates].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
      for (let index = 1; index < ordered.length; index += 1) {
        if (new Date(ordered[index].start_time) < new Date(ordered[index - 1].finish_time)) throw new Error(`${ordered[index - 1].kode} dan ${ordered[index].kode} memiliki jam yang bertumpang tindih.`);
      }
      units.filter(unit => selectedUnitIds.has(String(unit.id))).forEach(unit => {
        templates.forEach(template => records.push({ equipment_id: unit.id, standby_code_id: template.standby_code_id, start_time: template.start_time, finish_time: template.finish_time }));
      });
    } catch (error) { return showFormError(error.message); }
    if (records.length > 500) return showFormError('Maksimal 500 isian dalam satu proses Multi Unit.');
    const submit = document.getElementById('smSubmit');
    submit.disabled = true;
    submit.textContent = `Menyimpan ${records.length} record...`;
    try {
      const response = await fetch(getProdApiUrl('/api/admin/production/standby/batch'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify({ tanggal, shift_id: document.getElementById('smShift').value, description: document.getElementById('smDescription').value.trim(), records }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      tutupModalGenerik();
      await muatProdStandby();
      const skipped = Array.isArray(result.skipped) ? result.skipped : [];
      const skippedInfo = skipped.length
        ? `\n${skipped.length} record dilewati karena waktunya bertumpang tindih: ${skipped.slice(0, 5).map(item => `${item.kode_alat} / ${item.kode_standby}`).join(', ')}${skipped.length > 5 ? ', …' : ''}.`
        : '';
      alert(`${result.inserted || 0} record Standby berhasil dibuat untuk ${selectedUnitIds.size} unit.${skippedInfo}`);
    } catch (error) {
      showFormError(`Gagal menyimpan Multi Unit: ${error.message}`);
      submit.disabled = false;
      submit.textContent = 'Simpan Multi Unit';
    }
  });
  renderUnits();
}

function standbyHistoryTable(rows, withActions = false) {
  const displayRows = withActions ? [...new Map(rows.map(row => [String(row.standby_log_id), row])).values()] : rows;
  if (!displayRows.length) return '<div class="standby-empty">Tidak ada record.</div>';
  return `<div class="standby-history-scroll"><table class="standby-v2-table"><thead><tr><th>Tanggal/Shift</th><th>Unit</th><th>Kode</th><th>Waktu</th><th>Jam</th><th>Sumber</th><th>Status</th><th>Review</th>${withActions ? '<th>Aksi</th>' : ''}</tr></thead><tbody>${displayRows.map(row => `<tr><td>${escapeMinePlanning(formatTanggalMining(row.operational_date))}<small>${escapeMinePlanning(row.shift_name)}</small></td><td><b>${escapeMinePlanning(row.kode_alat)}</b><small>${escapeMinePlanning(row.kelas_alat)} · ${escapeMinePlanning(row.class_unit || 'Tanpa Class')}</small></td><td>${escapeMinePlanning(row.kode_standby)}<small>${escapeMinePlanning(row.kategori_standby)}</small></td><td>${escapeMinePlanning(standbyV2Time(row.slice_start))}–${escapeMinePlanning(standbyV2Time(row.slice_finish))}</td><td class="is-number">${standbyV2Hours(row.counted_hours)}</td><td>${row.is_system_generated ? 'Sistem' : 'Manual'}</td><td>${standbyV2LifecycleBadge(row.lifecycle_status)}</td><td>${standbyV2ReviewBadge(row.review_status)}</td>${withActions ? `<td><button class="tombol tombol--kecil" onclick="reviewStandbyRecord('${escapeMinePlanning(row.standby_log_id)}','approved')">Setujui</button><button class="tombol tombol--ghost tombol--kecil" onclick="reviewStandbyRecord('${escapeMinePlanning(row.standby_log_id)}','returned')">Kembalikan</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}

function bukaStandbyPendingKpi() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  const rows = filteredStandbyV2Slices().filter(row => row.review_status === 'pending');
  overlay.hidden = false;
  konten.innerHTML = `<div class="standby-special-modal"><header><div><h3>✓ Standby Belum Direview</h3><p>${new Set(rows.map(row => row.standby_log_id)).size} event sesuai filter periode, shift, jenis, class, unit, dan kode pada halaman utama.</p></div><button class="tombol" onclick="tutupModalGenerik()">Tutup</button></header>${standbyHistoryTable(rows, true)}</div>`;
}

function bukaStandbyReclassifiedKpi() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  const rows = [...new Map(filteredStandbyV2Slices().filter(row => row.lifecycle_status === 'reclassified').map(row => [String(row.standby_log_id), row])).values()];
  overlay.hidden = false;
  konten.innerHTML = `<div class="standby-special-modal"><header><div><h3>↪ Reclassified ke Breakdown</h3><p>${rows.length} event dialihkan ke Breakdown dan tidak dihitung sebagai jam Standby.</p></div><button class="tombol" onclick="tutupModalGenerik()">Tutup</button></header>${standbyHistoryTable(rows)}</div>`;
}

async function fetchStandbySpecial(endpoint, days = 30) {
  const to = getLocalDateInputValue();
  const fromDate = new Date(); fromDate.setDate(fromDate.getDate() - days);
  const response = await fetch(getProdApiUrl(`/api/admin/production/${endpoint}?from=${getLocalDateInputValue(fromDate)}&to=${to}`), { headers: { ...getProdAuthHeaders() } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function bukaStandbyHistory() {
  const overlay = document.getElementById('modalOverlay'); const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return; overlay.hidden = false; konten.innerHTML = '<div class="standby-special-modal"><h3>📚 Standby History</h3><div class="standby-loading">Memuat 30 hari terakhir…</div></div>';
  try { const data = await fetchStandbySpecial('standby-history'); konten.innerHTML = `<div class="standby-special-modal"><header><div><h3>📚 Standby History</h3><p>Seluruh record, termasuk standby sistem dan record yang direklasifikasi.</p></div><button class="tombol" onclick="tutupModalGenerik()">Tutup</button></header>${standbyHistoryTable(data.slices || [])}</div>`; }
  catch (error) { konten.innerHTML = `<div class="standby-special-modal"><p class="teks-error">${escapeMinePlanning(error.message)}</p></div>`; }
}

async function bukaReviewStandby() {
  const overlay = document.getElementById('modalOverlay'); const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return; overlay.hidden = false; konten.innerHTML = '<div class="standby-special-modal"><h3>✓ Review Standby</h3><div class="standby-loading">Memuat antrean review…</div></div>';
  try { const data = await fetchStandbySpecial('standby-review'); konten.innerHTML = `<div class="standby-special-modal"><header><div><h3>✓ Review Standby</h3><p>Validasi klasifikasi dan durasi tanpa mengubah record sistem.</p></div><button class="tombol" onclick="tutupModalGenerik()">Tutup</button></header>${standbyHistoryTable(data.slices || [], true)}</div>`; }
  catch (error) { konten.innerHTML = `<div class="standby-special-modal"><p class="teks-error">${escapeMinePlanning(error.message)}</p></div>`; }
}

async function reviewStandbyRecord(id, status) {
  const note = status === 'returned' ? prompt('Catatan pengembalian Standby (wajib):', '') : '';
  if (status === 'returned' && !String(note || '').trim()) return;
  if (status === 'approved' && !confirm('Setujui record Standby ini?')) return;
  try {
    const response = await fetch(getProdApiUrl(`/api/admin/production/standby/${encodeURIComponent(id)}/review`), { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify({ status, note }) });
    const result = await response.json().catch(() => ({})); if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await muatProdStandby(); await bukaReviewStandby();
  } catch (error) { alert(`Review Standby gagal: ${error.message}`); }
}

async function tutupShiftStandby(operationalDate, shiftId, equipmentId) {
  const control = (standbyV2Data.controls || []).find(item => item.operational_date === operationalDate && String(item.shift_id) === String(shiftId) && String(item.equipment_id) === String(equipmentId));
  if (!control?.canClose) return alert((control?.issues || []).map(issue => issue.message).join('\n') || 'MOHH belum tepat 12 jam.');
  if (!confirm(`Tutup dan freeze ${control.kode_alat} · ${control.shift_name} · ${formatTanggalMining(operationalDate)}?\n\nHM ${standbyV2Hours(control.hmHours)} + BD ${standbyV2Hours(control.breakdownHours)} + Standby ${standbyV2Hours(control.standbyHours)} = ${standbyV2Hours(control.accountedHours)} jam.`)) return;
  const viewSession = captureStandbyViewSession();
  try {
    const response = await fetch(getProdApiUrl('/api/admin/production/standby/close'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify({ operational_date: operationalDate, shift_id: shiftId, equipment_id: equipmentId }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await muatProdStandby(); await restoreStandbyViewSession(viewSession);
    alert('Shift berhasil ditutup. Data Standby unit kini read-only.');
  } catch (error) { alert(`Tutup Shift gagal: ${error.message}`); }
}

async function bukaKembaliShiftStandby(operationalDate, shiftId, equipmentId) {
  const control = (standbyV2Data.controls || []).find(item => item.operational_date === operationalDate && String(item.shift_id) === String(shiftId) && String(item.equipment_id) === String(equipmentId));
  const reason = prompt(`Alasan membuka kembali ${control?.kode_alat || 'unit'} (wajib):`, 'Koreksi data Standby');
  if (!String(reason || '').trim()) return;
  const viewSession = captureStandbyViewSession();
  try {
    const response = await fetch(getProdApiUrl('/api/admin/production/standby/reopen'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify({ operational_date: operationalDate, shift_id: shiftId, equipment_id: equipmentId, reason: String(reason).trim() }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await muatProdStandby(); await restoreStandbyViewSession(viewSession);
    alert('Shift dibuka kembali. Data Standby dapat dikoreksi dan wajib direview ulang.');
  } catch (error) { alert(`Buka Kembali gagal: ${error.message}`); }
}

function bukaStandbyDataQuality(showAll = false) {
  const overlay = document.getElementById('modalOverlay'); const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  const controls = filteredStandbyMohhControls();
  const issueRows = controls.filter(control => (control.issues || []).length || !['balanced','closed'].includes(control.status));
  const displayRows = showAll ? controls : issueRows;
  overlay.hidden = false;
  konten.innerHTML = `<div class="standby-special-modal"><header><div><h3>${showAll ? '◫ Kontrol MOHH' : '🛡️ Data Quality Center'}</h3><p>Kontrol urutan HM → Breakdown → Standby terhadap MOHH 12 jam. Filter jenis, class, unit, dan shift mengikuti halaman utama.</p></div><button class="tombol" onclick="tutupModalGenerik()">Tutup</button></header>
    <div class="standby-quality-summary"><span><b>${controls.length}</b> unit-shift diperiksa</span><span><b>${controls.filter(item => ['balanced','closed'].includes(item.status)).length}</b> MOHH pas</span><span><b>${issueRows.length}</b> perlu koreksi</span><span><b>${controls.filter(item => item.closure?.status === 'closed').length}</b> sudah freeze</span></div>
    ${displayRows.length ? `<div class="standby-history-scroll"><table class="standby-v2-table standby-quality-table"><thead><tr><th>Periode / Unit</th><th>HM</th><th>BD</th><th>Standby</th><th>MOHH</th><th>Selisih</th><th>Status</th><th>Temuan</th></tr></thead><tbody>${displayRows.map(control => `<tr><td><b>${escapeMinePlanning(control.kode_alat)}</b><small>${escapeMinePlanning(formatTanggalMining(control.operational_date))} · ${escapeMinePlanning(control.shift_name)} · ${escapeMinePlanning(control.kelas_alat)}</small></td><td class="is-number">${standbyV2Hours(control.hmHours)}</td><td class="is-number">${standbyV2Hours(control.breakdownHours)}</td><td class="is-number">${standbyV2Hours(control.standbyHours)}</td><td class="is-number">${standbyV2Hours(control.accountedHours)} / ${standbyV2Hours(control.targetHours)}</td><td class="is-number">${standbyV2Hours(control.balanceHours)}</td><td><span class="standby-mohh-badge is-${escapeMinePlanning(control.status)}">${escapeMinePlanning(standbyMohhStatusLabel(control.status))}</span></td><td>${(control.issues || []).length ? (control.issues || []).map(issue => `<span class="standby-quality-issue is-${escapeMinePlanning(issue.severity)}">${escapeMinePlanning(issue.message)}</span>`).join('') : '<span class="standby-quality-clear">Tidak ada temuan</span>'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="standby-quality-ok">✓ Seluruh unit pada filter terpilih sudah seimbang dan siap ditutup.</div>'}
  </div>`;
}

function bukaStandbyPareto() {
  const overlay = document.getElementById('modalOverlay'); const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  const rows = filteredStandbyV2Slices().filter(row => Number(row.counted_hours || 0) > 0);
  const codeMap = new Map(); const unitMap = new Map();
  rows.forEach(row => {
    const code = codeMap.get(String(row.standby_code_id)) || { kode: row.kode_standby, kategori: row.kategori_standby, planning: row.planning_type || 'unplanned', control: row.control_class || 'controllable', owner: row.owner_department || 'Production', hours: 0, events: new Set() };
    code.hours += Number(row.counted_hours || 0); code.events.add(String(row.standby_log_id)); codeMap.set(String(row.standby_code_id), code);
    const unit = unitMap.get(String(row.equipment_id)) || { kode: row.kode_alat, jenis: row.kelas_alat, hours: 0, events: new Set() };
    unit.hours += Number(row.counted_hours || 0); unit.events.add(String(row.standby_log_id)); unitMap.set(String(row.equipment_id), unit);
  });
  const codes = [...codeMap.values()].sort((a, b) => b.hours - a.hours); const units = [...unitMap.values()].sort((a, b) => b.hours - a.hours);
  const maxCode = Math.max(1, ...codes.map(item => item.hours)); const maxUnit = Math.max(1, ...units.map(item => item.hours));
  const paretoRows = (items, max, label) => items.slice(0, 15).map((item, index) => `<tr><td>${index + 1}</td><td><b>${escapeMinePlanning(item.kode)}</b><small>${escapeMinePlanning(label === 'code' ? `${item.kategori} · ${item.planning} · ${item.control} · ${item.owner}` : item.jenis)}</small></td><td><div class="standby-pareto-bar"><span style="width:${Math.max(2, (item.hours / max) * 100)}%"></span></div></td><td class="is-number">${standbyV2Hours(item.hours)}</td><td class="is-number">${item.events.size}</td></tr>`).join('');
  overlay.hidden = false;
  konten.innerHTML = `<div class="standby-special-modal"><header><div><h3>📊 Pareto Standby</h3><p>Analisis jam standby sesuai seluruh slicer aktif. Angka tetap berbasis jam aktual tanpa estimasi kehilangan produksi.</p></div><button class="tombol" onclick="tutupModalGenerik()">Tutup</button></header><div class="standby-pareto-grid"><section><h4>Top Kode Standby</h4>${codes.length ? `<div class="standby-history-scroll"><table class="standby-v2-table"><thead><tr><th>#</th><th>Kode</th><th>Distribusi</th><th>Jam</th><th>Event</th></tr></thead><tbody>${paretoRows(codes,maxCode,'code')}</tbody></table></div>` : '<div class="standby-empty">Tidak ada data.</div>'}</section><section><h4>Top Unit</h4>${units.length ? `<div class="standby-history-scroll"><table class="standby-v2-table"><thead><tr><th>#</th><th>Unit</th><th>Distribusi</th><th>Jam</th><th>Event</th></tr></thead><tbody>${paretoRows(units,maxUnit,'unit')}</tbody></table></div>` : '<div class="standby-empty">Tidak ada data.</div>'}</section></div></div>`;
}

function exportStandbyExcel() {
  if (!window.XLSX) return alert('Library Excel belum siap.');
  const rows = filteredStandbyV2Slices();
  if (!rows.length) return alert('Tidak ada data Standby pada filter aktif.');
  const detail = rows.map(row => ({ 'Tanggal Operasional': row.operational_date, 'Shift': row.shift_name, 'Jenis Unit': row.kelas_alat, 'Class': row.class_unit || '', 'Kode Unit': row.kode_alat, 'Kode Standby': row.kode_standby, 'Kategori': row.kategori_standby, 'Mulai': standbyV2DateTime(row.slice_start), 'Selesai': standbyV2DateTime(row.slice_finish), 'Jam Standby': Number(row.counted_hours || 0), 'Raw Hours': Number(row.raw_hours || 0), 'Sumber': row.is_system_generated ? 'Sistem' : 'Manual', 'Lifecycle': row.lifecycle_status, 'Review': row.review_status, 'Keterangan': row.description || '' }));
  const summaryMap = new Map();
  rows.forEach(row => { const key = `${row.kelas_alat}|${row.class_unit || ''}|${row.kode_alat}`; const item = summaryMap.get(key) || { 'Jenis Unit': row.kelas_alat, 'Class': row.class_unit || '', 'Kode Unit': row.kode_alat, 'Total Standby (Jam)': 0, 'Jumlah Event': new Set() }; item['Total Standby (Jam)'] += Number(row.counted_hours || 0); item['Jumlah Event'].add(row.standby_log_id); summaryMap.set(key, item); });
  const summary = [...summaryMap.values()].map(item => ({ ...item, 'Jumlah Event': item['Jumlah Event'].size }));
  const verification = detail.filter(row => row['Kode Standby'] === 'STB-SYS-01');
  const audit = (standbyV2Data.logs || []).flatMap(log => (log.audit_history || []).map(entry => ({ 'Standby ID': log.id, 'Kode Unit': log.kode_alat, 'Aksi': entry.action, 'Waktu Perubahan': standbyV2DateTime(entry.changed_at), 'Oleh': entry.changed_by_name || 'Sistem' })));
  const mohh = filteredStandbyMohhControls().map(control => ({ 'Tanggal Operasional': control.operational_date, 'Shift': control.shift_name, 'Jenis Unit': control.kelas_alat, 'Class': control.class_unit || '', 'Kode Unit': control.kode_alat, 'HM Input Data': Number(control.hmHours || 0), 'Jam Breakdown': Number(control.breakdownHours || 0), 'Jam Standby': Number(control.standbyHours || 0), 'Total MOHH': Number(control.accountedHours || 0), 'Target MOHH': Number(control.targetHours || 12), 'Selisih': Number(control.balanceHours || 0), 'Status': standbyMohhStatusLabel(control.status), 'Freeze': control.closure?.status === 'closed' ? 'Ditutup' : 'Terbuka', 'Temuan': (control.issues || []).map(issue => issue.message).join(' | ') }));
  const pareto = (standbyV2Data.pareto?.byCode || []).map((item, index) => ({ 'Peringkat': index + 1, 'Kode Standby': item.kode, 'Kategori': item.kategori, 'Planning': item.planning_type, 'Control Class': item.control_class, 'Owner': item.owner_department, 'Jam': Number(item.hours || 0), 'Event': item.events, 'Unit': item.units }));
  const workbook = XLSX.utils.book_new();
  [['Kontrol MOHH', mohh], ['Summary per Unit', summary], ['Pareto Standby', pareto], ['Detail Standby', detail], ['Standby Verification', verification], ['Review & Audit', audit]].forEach(([name, data]) => { const sheet = XLSX.utils.json_to_sheet(data.length ? data : [{ Informasi: 'Tidak ada data' }]); sheet['!cols'] = Array.from({ length: Math.max(1, Object.keys(data[0] || {}).length) }, () => ({ wch: 22 })); XLSX.utils.book_append_sheet(workbook, sheet, name); });
  const from = document.getElementById('slicerStandbyFrom')?.value || ''; const to = document.getElementById('slicerStandbyTo')?.value || '';
  XLSX.writeFile(workbook, `OMOS_Standby_${from}_${to}.xlsx`);
}

// -------------------------------------------------------------
// 4. BREAKDOWN (MTBF / MTTR)
// -------------------------------------------------------------
let cachedBreakdownLogs = [];
let cachedBreakdownMetrics = {};
let cachedBreakdownHistory = [];
let breakdownFiltersReady = false;

const BREAKDOWN_STATUS_LABELS = {
  mechanic_progress: 'Progres Mekanik',
  waiting_part: 'Waiting Part',
  waiting_tool: 'Waiting Tool',
  waiting_manpower: 'Waiting Manpower',
  waiting_vendor: 'Waiting Vendor',
  awaiting_verification: 'Menunggu Verifikasi',
  resolved: 'Ready to Operate'
};

function breakdownLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function breakdownLocalDateTime(date = new Date()) {
  return `${breakdownLocalDate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function breakdownToIso(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new Error('Tanggal dan jam tidak valid.');
  return parsed.toISOString();
}

function formatBreakdownHours(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return '0,00';
  return number.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatBreakdownDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function breakdownStatusBadge(status) {
  return `<span class="breakdown-status-badge is-${escapeMinePlanning(status || 'resolved')}">${escapeMinePlanning(BREAKDOWN_STATUS_LABELS[status] || status || '—')}</span>`;
}

function setupBreakdownFilters() {
  if (breakdownFiltersReady) return;
  const now = new Date();
  const yearSelect = document.getElementById('slicerBreakdownTahun');
  const monthSelect = document.getElementById('slicerBreakdownBulan');
  if (yearSelect) {
    const years = [];
    for (let year = now.getFullYear() - 3; year <= now.getFullYear() + 2; year += 1) years.push(year);
    yearSelect.innerHTML = years.map(year => `<option value="${year}"${year === now.getFullYear() ? ' selected' : ''}>${year}</option>`).join('');
  }
  if (monthSelect) monthSelect.value = String(now.getMonth() + 1);
  breakdownFiltersReady = true;
}

async function readBreakdownResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

async function muatProdBreakdown() {
  const tbody = document.getElementById('tbodyProdBreakdown');
  const completedBody = document.getElementById('tbodyProdBreakdownCompleted');
  if (!tbody || !completedBody) return;
  setupBreakdownFilters();
  tbody.innerHTML = '<tr><td colspan="10" class="tabel__kosong">Memuat board breakdown seluruh unit...</td></tr>';
  completedBody.innerHTML = '<tr><td colspan="10" class="tabel__kosong">Memuat unit selesai perbaikan...</td></tr>';
  try {
    if (!(masterProdData.equipment || []).length || !(masterProdData.personnel || []).length) await muatMasterDataProduksi();
    const year = document.getElementById('slicerBreakdownTahun')?.value || new Date().getFullYear();
    const month = document.getElementById('slicerBreakdownBulan')?.value || (new Date().getMonth() + 1);
    const response = await fetch(getProdApiUrl(`/api/admin/production/breakdown?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`), { headers: { ...getProdAuthHeaders() } });
    const data = await readBreakdownResponse(response);
    cachedBreakdownLogs = Array.isArray(data.logs) ? data.logs : [];
    cachedBreakdownMetrics = data.metrics || {};
    const metrics = cachedBreakdownMetrics;
    document.getElementById('metricMtbf').textContent = `${formatBreakdownHours(metrics.mtbfHours)} Jam`;
    document.getElementById('metricMttr').textContent = `${formatBreakdownHours(metrics.mttrHours)} Jam`;
    document.getElementById('metricPa').textContent = `${Number(metrics.calendarPa || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;
    document.getElementById('metricBdOpen').textContent = String(metrics.openBreakdowns || 0);
    document.getElementById('metricBdHours').textContent = `${formatBreakdownHours(metrics.totalBdHours)} Jam`;
    document.getElementById('metricBdUnits').textContent = String(metrics.affectedUnits || 0);
    const basis = document.getElementById('metricPaBasis');
    if (basis) basis.textContent = `${data.period?.days || 0} hari × ${metrics.activeUnitCount || 0} unit × 24 jam`;
    terapkanSlicerBreakdown();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="teks-error">Gagal memuat Breakdown Workflow: ${escapeMinePlanning(err.message)}. Pastikan migrasi 011 sudah dijalankan.</td></tr>`;
    completedBody.innerHTML = `<tr><td colspan="10" class="teks-error">Gagal memuat Ready Verification: ${escapeMinePlanning(err.message)}. Pastikan migrasi 013 sudah dijalankan.</td></tr>`;
  }
}

function breakdownPartSummary(parts) {
  if (!Array.isArray(parts) || !parts.length) return '—';
  return parts.map(part => `<span class="breakdown-part-chip"><b>${escapeMinePlanning(part.part_detail)}</b><small>${escapeMinePlanning(part.po_number ? `PO ${part.po_number}` : 'PO belum terbit')}</small></span>`).join('');
}

function breakdownRowSearchText(unit, log) {
  const parts = Array.isArray(log?.parts) ? log.parts.flatMap(part => [part.part_detail, part.po_number]) : [];
  return [unit.kode_alat, unit.kelas_alat, unit.class_unit, unit.tipe_alat, log?.kategori_breakdown, log?.kode_breakdown,
    log?.description, log?.report_by_name, log?.pic_name, ...parts].join(' ').toLowerCase();
}

function terapkanSlicerBreakdown() {
  const tbody = document.getElementById('tbodyProdBreakdown');
  const completedBody = document.getElementById('tbodyProdBreakdownCompleted');
  if (!tbody || !completedBody) return;
  const search = String(document.getElementById('slicerBreakdownCari')?.value || '').trim().toLowerCase();
  const statusFilter = String(document.getElementById('slicerBreakdownStatus')?.value || '');
  const units = [...(masterProdData.equipment || [])].filter(unit => unit?.id && unit?.kode_alat)
    .sort((a, b) => String(a.kode_alat).localeCompare(String(b.kode_alat), 'id-ID', { numeric: true, sensitivity: 'base' }));
  const logsByUnit = new Map();
  cachedBreakdownLogs.forEach(log => {
    const key = String(log.equipment_id || '');
    if (!logsByUnit.has(key)) logsByUnit.set(key, []);
    logsByUnit.get(key).push(log);
  });

  const activeRows = [];
  const completedRows = [];
  const visibleUnitIds = new Set();
  let visibleIncidents = 0;
  const rowMarkup = (unit, log, index) => {
    const isPending = log.current_status === 'awaiting_verification';
    const isResolved = log.current_status === 'resolved';
    const actions = isPending
      ? `<button class="tombol tombol--kecil breakdown-ready-button" onclick="bukaModalReadyVerification('${escapeMinePlanning(log.id)}')">Verifikasi Ready</button><button class="tombol tombol--kecil standby-review-button" onclick="bukaModalRekonsiliasiReady('${escapeMinePlanning(log.id)}')">Rekonsiliasi Operasi</button><button class="tombol tombol--kecil" onclick="bukaDetailBreakdown('${escapeMinePlanning(log.id)}')">Detail</button>`
      : isResolved
        ? `<button class="tombol tombol--kecil" onclick="bukaDetailBreakdown('${escapeMinePlanning(log.id)}')">${Array.isArray(log.ready_verifications) && log.ready_verifications.length ? 'Lihat Verifikasi' : 'Detail'}</button>`
        : `<button class="tombol tombol--kecil tombol--utama" onclick="bukaModalUpdateStatusBreakdown('${escapeMinePlanning(log.id)}')">Update</button><button class="tombol tombol--kecil" onclick="bukaDetailBreakdown('${escapeMinePlanning(log.id)}')">Detail</button>`;
    return `<tr class="breakdown-incident-row${!isResolved && !isPending ? ' is-active' : ''}" data-breakdown-id="${escapeMinePlanning(log.id)}">
      <td><strong>${escapeMinePlanning(unit.kode_alat)}</strong><small>${escapeMinePlanning(unit.kelas_alat || unit.class_unit || unit.tipe_alat || 'Unit')}</small>${index ? '<em>Insiden tambahan</em>' : ''}</td>
      <td><strong>${escapeMinePlanning(String(log.tanggal || '').slice(0, 10))}</strong><small>${escapeMinePlanning(log.nama_shift || '—')}</small></td>
      <td><strong>${escapeMinePlanning(`${log.kode_breakdown || ''} ${log.kategori_breakdown || ''}`.trim() || '—')}</strong><small title="${escapeMinePlanning(log.description || '')}">${escapeMinePlanning(log.description || 'Tanpa deskripsi')}</small></td>
      <td>${escapeMinePlanning(formatBreakdownDateTime(log.start_time))}</td><td>${breakdownStatusBadge(log.current_status)}</td>
      <td class="breakdown-duration-total">${formatBreakdownHours(log.elapsed_breakdown_hours)}<small>jam</small></td>
      <td>${escapeMinePlanning(log.report_by_name || 'Sistem')}</td><td>${escapeMinePlanning(log.pic_name || 'Belum ditetapkan')}</td>
      <td><div class="breakdown-parts-cell">${breakdownPartSummary(log.parts)}</div></td>
      <td><div class="breakdown-row-actions">${actions}</div></td>
    </tr>`;
  };
  units.forEach(unit => {
    const unitLogs = logsByUnit.get(String(unit.id)) || [];
    const matchingLogs = unitLogs.filter(log => {
      const statusMatches = !statusFilter || (statusFilter === 'open' ? log.current_status !== 'resolved' : log.current_status === statusFilter);
      return statusMatches && (!search || breakdownRowSearchText(unit, log).includes(search));
    });
    if (!matchingLogs.length) return;
    visibleUnitIds.add(String(unit.id));
    matchingLogs.forEach((log, index) => {
      visibleIncidents += 1;
      const target = ['awaiting_verification', 'resolved'].includes(log.current_status) ? completedRows : activeRows;
      target.push(rowMarkup(unit, log, index));
    });
  });
  tbody.innerHTML = activeRows.length ? activeRows.join('') : '<tr><td colspan="10" class="tabel__kosong">Tidak ada breakdown aktif yang sesuai filter.</td></tr>';
  completedBody.innerHTML = completedRows.length ? completedRows.join('') : '<tr><td colspan="10" class="tabel__kosong">Belum ada unit selesai perbaikan yang sesuai filter.</td></tr>';
  const activeCount = document.getElementById('breakdownActiveCount');
  const completedCount = document.getElementById('breakdownCompletedCount');
  if (activeCount) activeCount.textContent = `${activeRows.length} insiden`;
  if (completedCount) completedCount.textContent = `${completedRows.length} insiden`;
  const counter = document.getElementById('counterSlicerBreakdown');
  if (counter) counter.textContent = `${visibleUnitIds.size} unit · ${visibleIncidents} insiden`;
}

function resetSlicerBreakdown() {
  const search = document.getElementById('slicerBreakdownCari');
  const status = document.getElementById('slicerBreakdownStatus');
  if (search) search.value = '';
  if (status) status.value = '';
  terapkanSlicerBreakdown();
}

function breakdownPersonnelOptions(selectedId = '', includeEmpty = true) {
  const personnel = [...(masterProdData.personnel || [])].filter(person => person.id)
    .sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id-ID', { sensitivity: 'base' }));
  const emptyLabel = personnel.length ? 'Pilih PIC Maintenance' : 'Belum ada karyawan Maintenance aktif';
  const empty = includeEmpty ? `<option value="">${emptyLabel}</option>` : '';
  return empty + personnel.map(person => `<option value="${escapeMinePlanning(person.id)}"${String(person.id) === String(selectedId) ? ' selected' : ''}>${escapeMinePlanning(person.nama)} — ${escapeMinePlanning(person.jabatan || person.departemen || person.role || 'Personel')}</option>`).join('');
}

async function muatPicMaintenanceBreakdown() {
  try {
    const response = await fetch(getProdApiUrl('/api/admin/karyawan'), { headers: { ...getProdAuthHeaders() } });
    if (!response.ok) throw new Error(`Database Karyawan HTTP ${response.status}`);
    const employees = await response.json();
    masterProdData.personnel = (Array.isArray(employees) ? employees : []).filter(employee =>
      employee?.id
      && employee.is_active !== false
      && String(employee.departemen || '').trim().toLocaleLowerCase('id-ID') === 'maintenance'
    );
  } catch (error) {
    masterProdData.personnel = (masterProdData.personnel || []).filter(employee =>
      String(employee.departemen || '').trim().toLocaleLowerCase('id-ID') === 'maintenance'
    );
    if (!masterProdData.personnel.length) throw error;
  }
  return masterProdData.personnel;
}

function breakdownPartFields(prefix) {
  return `<div id="${prefix}PartFields" class="breakdown-part-fields" hidden>
    <div class="breakdown-form-field is-wide"><label>Detail Part yang Dibutuhkan *</label><input id="${prefix}PartDetail" type="text" placeholder="Contoh: Hose hydraulic 1/2 inch × 2 meter" /></div>
    <div class="breakdown-form-field"><label>Nomor PO</label><input id="${prefix}PoNumber" type="text" placeholder="Belum terbit / nomor PO" /></div>
    <div class="breakdown-form-field"><label>Quantity</label><input id="${prefix}Quantity" type="number" min="0.01" step="0.01" placeholder="1" /></div>
    <div class="breakdown-form-field"><label>Status PO</label><select id="${prefix}PoStatus"><option value="requested">Request dibuat</option><option value="po_process">Proses PO</option><option value="ordered">Sudah dipesan</option><option value="arrived">Sudah tiba</option></select></div>
    <div class="breakdown-form-field"><label>ETA Part</label><input id="${prefix}EtaDate" type="date" /></div>
  </div>`;
}

function toggleBreakdownPartFields(prefix, statusValue) {
  const container = document.getElementById(`${prefix}PartFields`);
  const partInput = document.getElementById(`${prefix}PartDetail`);
  const visible = statusValue === 'waiting_part';
  if (container) container.hidden = !visible;
  if (partInput) partInput.required = visible;
}

function collectBreakdownPart(prefix) {
  return { part_detail: document.getElementById(`${prefix}PartDetail`)?.value.trim() || '', po_number: document.getElementById(`${prefix}PoNumber`)?.value.trim() || '', quantity: document.getElementById(`${prefix}Quantity`)?.value || null, po_status: document.getElementById(`${prefix}PoStatus`)?.value || 'requested', eta_date: document.getElementById(`${prefix}EtaDate`)?.value || null };
}

function findBreakdownLog(id) {
  return cachedBreakdownLogs.find(log => String(log.id) === String(id));
}

function breakdownHistoryPeriodLabel(period) {
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || !month) return period || 'Periode tidak diketahui';
  return new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

function breakdownHistorySearchText(log) {
  const parts = Array.isArray(log.parts) ? log.parts.flatMap(part => [part.part_detail, part.po_number]) : [];
  return [log.kode_alat, log.kelas_alat, log.class_unit, log.tipe_alat, log.kode_breakdown,
    log.kategori_breakdown, log.description, log.report_by_name, log.pic_name, ...parts].join(' ').toLowerCase();
}

function getFilteredBreakdownHistory() {
  const periodFilter = String(document.getElementById('breakdownHistoryPeriod')?.value || '');
  const search = String(document.getElementById('breakdownHistorySearch')?.value || '').trim().toLowerCase();
  return cachedBreakdownHistory.filter(log => {
    const period = log.period_key || String(log.tanggal || '').slice(0, 7);
    return (!periodFilter || period === periodFilter) && (!search || breakdownHistorySearchText(log).includes(search));
  });
}

function renderBreakdownHistory() {
  const host = document.getElementById('breakdownHistoryGroups');
  if (!host) return;
  const filtered = getFilteredBreakdownHistory();

  const periodGroups = new Map();
  filtered.forEach(log => {
    const period = log.period_key || String(log.tanggal || '').slice(0, 7) || 'Tanpa Periode';
    const unitType = String(log.kelas_alat || log.class_unit || log.tipe_alat || 'Jenis Unit Lainnya').trim();
    if (!periodGroups.has(period)) periodGroups.set(period, new Map());
    const typeGroups = periodGroups.get(period);
    if (!typeGroups.has(unitType)) typeGroups.set(unitType, []);
    typeGroups.get(unitType).push(log);
  });

  const counter = document.getElementById('breakdownHistoryCounter');
  if (counter) counter.textContent = `${filtered.length} record · ${periodGroups.size} periode`;
  if (!filtered.length) {
    host.innerHTML = '<div class="breakdown-history-empty">Tidak ada histori breakdown yang sesuai filter.</div>';
    return;
  }

  host.innerHTML = [...periodGroups.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([period, typeGroups]) => {
    const periodLogs = [...typeGroups.values()].flat();
    const periodHours = periodLogs.reduce((sum, log) => sum + Number(log.elapsed_breakdown_hours || 0), 0);
    const typeMarkup = [...typeGroups.entries()].sort(([a], [b]) => a.localeCompare(b, 'id-ID')).map(([unitType, logs]) => {
      const typeHours = logs.reduce((sum, log) => sum + Number(log.elapsed_breakdown_hours || 0), 0);
      const rows = logs.map(log => `<tr>
        <td><strong>${escapeMinePlanning(log.kode_alat || '—')}</strong><small>${escapeMinePlanning(log.tipe_alat || log.class_unit || '')}</small></td>
        <td>${escapeMinePlanning(String(log.tanggal || '').slice(0, 10))}<small>${escapeMinePlanning(log.nama_shift || '—')}</small></td>
        <td><strong>${escapeMinePlanning(`${log.kode_breakdown || ''} ${log.kategori_breakdown || ''}`.trim() || '—')}</strong><small>${escapeMinePlanning(log.description || '—')}</small></td>
        <td>${escapeMinePlanning(formatBreakdownDateTime(log.start_time))}</td><td>${escapeMinePlanning(formatBreakdownDateTime(log.finish_time))}</td>
        <td>${breakdownStatusBadge(log.current_status)}</td><td class="breakdown-history-number">${formatBreakdownHours(log.elapsed_breakdown_hours)}</td>
        <td class="breakdown-history-number">${formatBreakdownHours(log.mechanic_progress_hours)}</td><td class="breakdown-history-number">${formatBreakdownHours(log.waiting_part_hours)}</td>
        <td class="breakdown-history-number">${formatBreakdownHours(log.waiting_tool_hours)}</td><td class="breakdown-history-number">${formatBreakdownHours(log.waiting_manpower_hours)}</td><td class="breakdown-history-number">${formatBreakdownHours(log.waiting_vendor_hours)}</td>
        <td>${escapeMinePlanning(log.report_by_name || 'Sistem')}</td><td>${escapeMinePlanning(log.pic_name || 'Belum ditetapkan')}</td><td><div class="breakdown-parts-cell">${breakdownPartSummary(log.parts)}</div></td>
      </tr>`).join('');
      return `<section class="breakdown-history-type"><header><div><b>${escapeMinePlanning(unitType)}</b><small>${logs.length} record unit</small></div><span>${formatBreakdownHours(typeHours)} jam BD</span></header>
        <div class="breakdown-history-table-wrap"><table class="tabel breakdown-history-table"><thead><tr><th>Unit</th><th>Tanggal / Shift</th><th>Jenis Kerusakan</th><th>Mulai</th><th>Selesai</th><th>Status</th><th>Total BD</th><th>Mekanik</th><th>W. Part</th><th>W. Tool</th><th>W. Manpower</th><th>W. Vendor</th><th>Report By</th><th>PIC</th><th>Part / PO</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    }).join('');
    return `<section class="breakdown-history-period"><header><div><h4>${escapeMinePlanning(breakdownHistoryPeriodLabel(period))}</h4><small>${periodLogs.length} record · ${typeGroups.size} jenis unit</small></div><strong>${formatBreakdownHours(periodHours)} jam breakdown</strong></header>${typeMarkup}</section>`;
  }).join('');
}

function exportBreakdownHistoryExcel() {
  if (!window.XLSX) return alert('Library Excel belum siap. Refresh dashboard lalu coba kembali.');
  const logs = getFilteredBreakdownHistory();
  if (!logs.length) return alert('Tidak ada record Breakdown History yang dapat diekspor.');

  const detailRows = logs.map((log, index) => {
    const parts = Array.isArray(log.parts) ? log.parts : [];
    return {
      'No': index + 1,
      'Periode': breakdownHistoryPeriodLabel(log.period_key || String(log.tanggal || '').slice(0, 7)),
      'Jenis Unit': log.kelas_alat || log.class_unit || log.tipe_alat || 'Jenis Unit Lainnya',
      'Kode Unit': log.kode_alat || '',
      'Model / Tipe': log.tipe_alat || log.class_unit || '',
      'Tanggal': String(log.tanggal || '').slice(0, 10),
      'Shift': log.nama_shift || '',
      'Kode Breakdown': log.kode_breakdown || '',
      'Kategori Kerusakan': log.kategori_breakdown || '',
      'Deskripsi Kerusakan': log.description || '',
      'Mulai Breakdown': formatBreakdownDateTime(log.start_time),
      'Selesai Breakdown': log.finish_time ? formatBreakdownDateTime(log.finish_time) : '',
      'Status': BREAKDOWN_STATUS_LABELS[log.current_status] || log.current_status || '',
      'Total Breakdown (Jam)': Number(log.elapsed_breakdown_hours || 0),
      'Progres Mekanik (Jam)': Number(log.mechanic_progress_hours || 0),
      'Waiting Part (Jam)': Number(log.waiting_part_hours || 0),
      'Waiting Tool (Jam)': Number(log.waiting_tool_hours || 0),
      'Waiting Manpower (Jam)': Number(log.waiting_manpower_hours || 0),
      'Waiting Vendor (Jam)': Number(log.waiting_vendor_hours || 0),
      'Report By': log.report_by_name || 'Sistem',
      'PIC': log.pic_name || '',
      'Detail Part': parts.map(part => part.part_detail || '').filter(Boolean).join('; '),
      'Quantity Part': parts.map(part => part.quantity ?? '').filter(value => value !== '').join('; '),
      'Nomor PO': parts.map(part => part.po_number || 'Belum terbit').join('; '),
      'Status PO': parts.map(part => part.po_status || '').filter(Boolean).join('; '),
      'ETA Part': parts.map(part => part.eta_date || '').filter(Boolean).join('; '),
      'Catatan': log.remark || ''
    };
  });

  const summaryMap = new Map();
  logs.forEach(log => {
    const periodKey = log.period_key || String(log.tanggal || '').slice(0, 7);
    const unitType = log.kelas_alat || log.class_unit || log.tipe_alat || 'Jenis Unit Lainnya';
    const key = `${periodKey}::${unitType}`;
    if (!summaryMap.has(key)) summaryMap.set(key, { periodKey, unitType, units: new Set(), records: 0, total: 0, mechanic: 0, part: 0, tool: 0, manpower: 0, vendor: 0 });
    const item = summaryMap.get(key);
    item.units.add(log.kode_alat || log.equipment_id || '');
    item.records += 1;
    item.total += Number(log.elapsed_breakdown_hours || 0);
    item.mechanic += Number(log.mechanic_progress_hours || 0);
    item.part += Number(log.waiting_part_hours || 0);
    item.tool += Number(log.waiting_tool_hours || 0);
    item.manpower += Number(log.waiting_manpower_hours || 0);
    item.vendor += Number(log.waiting_vendor_hours || 0);
  });
  const summaryRows = [...summaryMap.values()].sort((a, b) => b.periodKey.localeCompare(a.periodKey) || a.unitType.localeCompare(b.unitType, 'id-ID')).map(item => ({
    'Periode': breakdownHistoryPeriodLabel(item.periodKey),
    'Jenis Unit': item.unitType,
    'Jumlah Unit Terdampak': item.units.size,
    'Jumlah Record': item.records,
    'Total Breakdown (Jam)': item.total,
    'Progres Mekanik (Jam)': item.mechanic,
    'Waiting Part (Jam)': item.part,
    'Waiting Tool (Jam)': item.tool,
    'Waiting Manpower (Jam)': item.manpower,
    'Waiting Vendor (Jam)': item.vendor
  }));

  const workbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  const detailSheet = XLSX.utils.json_to_sheet(detailRows);
  summarySheet['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 21 }, { wch: 16 }, ...Array(6).fill({ wch: 22 })];
  detailSheet['!cols'] = [{ wch: 6 }, { wch: 20 }, { wch: 18 }, { wch: 16 }, { wch: 22 }, { wch: 13 }, { wch: 14 }, { wch: 18 }, { wch: 24 }, { wch: 34 }, { wch: 24 }, { wch: 24 }, { wch: 20 }, ...Array(6).fill({ wch: 23 }), { wch: 22 }, { wch: 22 }, { wch: 36 }, { wch: 18 }, { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 34 }];
  summarySheet['!autofilter'] = { ref: summarySheet['!ref'] };
  detailSheet['!autofilter'] = { ref: detailSheet['!ref'] };
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Ringkasan');
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Detail Breakdown');
  const periodFilter = document.getElementById('breakdownHistoryPeriod')?.value || 'Semua-Periode';
  XLSX.writeFile(workbook, `OMOS_Breakdown_History_${periodFilter}_${breakdownLocalDate()}.xlsx`);
}

async function bukaBreakdownHistory() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  konten.innerHTML = '<div class="breakdown-history-modal"><h3>📚 Breakdown History</h3><div class="breakdown-history-empty">Memuat seluruh database breakdown...</div></div>';
  overlay.hidden = false;
  try {
    const response = await fetch(getProdApiUrl('/api/admin/production/breakdown-history'), { headers: { ...getProdAuthHeaders() } });
    const data = await readBreakdownResponse(response);
    cachedBreakdownHistory = Array.isArray(data.logs) ? data.logs : [];
    const periods = Array.isArray(data.periods) ? data.periods : [];
    konten.innerHTML = `<div class="breakdown-history-modal">
      <div class="breakdown-history-head"><div><h3>📚 Breakdown History</h3><p>Seluruh record breakdown, disusun berdasarkan periode dan jenis unit.</p></div><div class="breakdown-history-actions"><button type="button" class="tombol breakdown-history-export" onclick="exportBreakdownHistoryExcel()">📊 Export Excel</button><button type="button" class="tombol" onclick="tutupModalGenerik()">Tutup</button></div></div>
      <div class="breakdown-history-filters"><label>Periode<select id="breakdownHistoryPeriod" onchange="renderBreakdownHistory()"><option value="">Semua Periode</option>${periods.map(period => `<option value="${escapeMinePlanning(period)}">${escapeMinePlanning(breakdownHistoryPeriodLabel(period))}</option>`).join('')}</select></label><label class="is-wide">Cari Record<input id="breakdownHistorySearch" type="search" placeholder="Cari unit, kerusakan, reporter, PIC, part atau PO…" oninput="renderBreakdownHistory()" /></label><span id="breakdownHistoryCounter">0 record</span></div>
      <div id="breakdownHistoryGroups" class="breakdown-history-groups"></div>
    </div>`;
    renderBreakdownHistory();
  } catch (error) {
    konten.innerHTML = `<div class="breakdown-history-modal"><h3>📚 Breakdown History</h3><div class="breakdown-history-empty is-error">Gagal memuat history: ${escapeMinePlanning(error.message)}</div><div class="breakdown-modal-actions"><button class="tombol" onclick="tutupModalGenerik()">Tutup</button></div></div>`;
  }
}

let cachedUnitPerformance = null;
let unitPerformanceActiveTab = 'units';

const MAINTENANCE_EVENT_LABELS = {
  scheduled_service: 'Service Berkala',
  inspection: 'Inspeksi',
  corrective_repair: 'Corrective Repair',
  calendar_exclusion: 'Calendar Exclusion'
};

const MAINTENANCE_STATUS_LABELS = {
  planned: 'Terjadwal',
  in_progress: 'Berjalan',
  completed: 'Selesai',
  cancelled: 'Dibatalkan'
};

function unitPerformanceValue(value, suffix = '') {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return `${Number(value).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${suffix}`;
}

function unitPerformancePercent(value) {
  return unitPerformanceValue(value, '%');
}

function unitPerformanceDateTimeInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function unitPerformanceBar(value, tone = 'green') {
  const number = Math.max(0, Math.min(100, Number(value) || 0));
  return `<span class="unit-performance-bar is-${tone}"><i style="width:${number}%"></i><b>${unitPerformancePercent(value)}</b></span>`;
}

function unitPerformanceEventBadge(type) {
  return `<span class="maintenance-event-badge is-${escapeMinePlanning(type)}">${escapeMinePlanning(MAINTENANCE_EVENT_LABELS[type] || type)}</span>`;
}

function unitPerformanceStatusBadge(status) {
  return `<span class="maintenance-status-badge is-${escapeMinePlanning(status)}">${escapeMinePlanning(MAINTENANCE_STATUS_LABELS[status] || status)}</span>`;
}

function setUnitPerformanceTab(tabName) {
  unitPerformanceActiveTab = tabName;
  document.querySelectorAll('[data-unit-performance-tab]').forEach(button => button.classList.toggle('is-active', button.dataset.unitPerformanceTab === tabName));
  document.querySelectorAll('[data-unit-performance-panel]').forEach(panel => { panel.hidden = panel.dataset.unitPerformancePanel !== tabName; });
}

function summarizeFilteredUnitPerformance(units) {
  const summary = (units || []).reduce((result, unit) => {
    result.calendarHours += Number(unit.calendarHours || 0);
    result.scheduledHours += Number(unit.scheduledHours || 0);
    result.physicalDowntime += Number(unit.physicalDowntime || 0);
    result.maintenanceDowntime += Number(unit.maintenanceDowntime || 0);
    result.actualHm += Number(unit.actualHm || 0);
    result.functionalFailures += Number(unit.functionalFailures || 0);
    result.correctiveRepairs += Number(unit.correctiveRepairs || 0);
    result.totalRepairHours += Number(unit.totalRepairHours || 0);
    result.completedRepairCount += Number(unit.completedRepairCount || 0);
    result.scheduledServices += Number(unit.eventCounts?.scheduled_service || 0);
    result.inspections += Number(unit.eventCounts?.inspection || 0);
    if (Number(unit.actualHm || 0) > 0) result.unitsWithHm += 1;
    return result;
  }, { calendarHours: 0, scheduledHours: 0, physicalDowntime: 0, maintenanceDowntime: 0, actualHm: 0, functionalFailures: 0, correctiveRepairs: 0, totalRepairHours: 0, completedRepairCount: 0, scheduledServices: 0, inspections: 0, unitsWithHm: 0 });
  summary.totalUnits = (units || []).length;
  summary.pa = summary.calendarHours > 0 ? ((summary.calendarHours - summary.physicalDowntime) / summary.calendarHours) * 100 : null;
  summary.ma = summary.scheduledHours > 0 ? ((summary.scheduledHours - summary.maintenanceDowntime) / summary.scheduledHours) * 100 : null;
  summary.mtbfHours = summary.actualHm > 0 && summary.functionalFailures > 0 ? summary.actualHm / summary.functionalFailures : null;
  summary.mtbrHours = summary.actualHm > 0 && summary.correctiveRepairs > 0 ? summary.actualHm / summary.correctiveRepairs : null;
  summary.mttrHours = summary.completedRepairCount > 0 ? summary.totalRepairHours / summary.completedRepairCount : null;
  summary.hmCoveragePercent = summary.totalUnits > 0 ? (summary.unitsWithHm / summary.totalUnits) * 100 : 0;
  return summary;
}

function getFilteredUnitPerformanceUnits() {
  const data = cachedUnitPerformance;
  if (!data) return [];
  const search = String(document.getElementById('unitPerformanceSearch')?.value || '').trim().toLowerCase();
  const type = String(document.getElementById('unitPerformanceType')?.value || '');
  return (data.units || []).filter(unit => {
    const matchesType = !type || String(unit.kelas_alat || unit.class_unit || unit.tipe_alat || 'Lainnya') === type;
    const text = [unit.kode_alat, unit.kelas_alat, unit.class_unit, unit.tipe_alat, unit.brand].join(' ').toLowerCase();
    return matchesType && (!search || text.includes(search));
  });
}

function unitPerformanceScopeLabel(units, search, type) {
  if (units.length === 1) return units[0]?.kode_alat || '1 unit';
  if (type) return `${type} · ${units.length} unit`;
  if (search) return `${units.length} unit hasil pencarian`;
  return `Seluruh fleet · ${units.length} unit`;
}

function updateUnitPerformanceHighlights(units, search, type) {
  const data = cachedUnitPerformance;
  if (!data) return;
  const summary = summarizeFilteredUnitPerformance(units);
  const setText = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
  setText('unitPerformancePa', unitPerformancePercent(summary.pa));
  setText('unitPerformanceMa', unitPerformancePercent(summary.ma));
  setText('unitPerformanceMtbf', unitPerformanceValue(summary.mtbfHours, ' Jam'));
  setText('unitPerformanceMtbr', unitPerformanceValue(summary.mtbrHours, ' Jam'));
  setText('unitPerformanceMttr', unitPerformanceValue(summary.mttrHours, ' Jam'));
  setText('unitPerformanceDowntime', unitPerformanceValue(summary.physicalDowntime, ' Jam'));
  setText('unitPerformanceServices', String(summary.scheduledServices));
  setText('unitPerformanceInspections', String(summary.inspections));
  setText('unitPerformanceMtbfBasis', `Actual HM / ${summary.functionalFailures} functional failure`);
  setText('unitPerformanceMtbrBasis', `Actual HM / ${summary.correctiveRepairs} corrective repair`);
  setText('unitPerformanceMttrBasis', `${summary.completedRepairCount} pekerjaan selesai dalam scope`);
  setText('unitPerformanceDataQualityValue', `Data Quality ${unitPerformancePercent(summary.hmCoveragePercent)}`);
  const scope = unitPerformanceScopeLabel(units, search, type);
  setText('unitPerformanceDataQualityText', `${scope}: ${summary.unitsWithHm} unit memiliki actual HM. MTBF/MTBR kosong bila actual HM atau event pembagi belum tersedia.`);
  setText('unitPerformanceScopeBadge', `${data.period?.days || 0} hari · ${scope} · ${unitPerformanceValue(summary.actualHm, ' actual HM')}`);
}

function renderUnitPerformance() {
  const data = cachedUnitPerformance;
  if (!data) return;
  const search = String(document.getElementById('unitPerformanceSearch')?.value || '').trim().toLowerCase();
  const type = String(document.getElementById('unitPerformanceType')?.value || '');
  const units = getFilteredUnitPerformanceUnits();
  updateUnitPerformanceHighlights(units, search, type);
  const unitBody = document.getElementById('unitPerformanceUnitRows');
  if (unitBody) unitBody.innerHTML = units.length ? units.map(unit => `<tr>
    <td><strong>${escapeMinePlanning(unit.kode_alat)}</strong><small>${escapeMinePlanning(unit.kelas_alat || unit.class_unit || unit.tipe_alat || 'Unit')}</small></td>
    <td>${unitPerformanceBar(unit.pa, Number(unit.pa) >= 90 ? 'green' : 'orange')}</td>
    <td>${unitPerformanceBar(unit.ma, Number(unit.ma) >= 90 ? 'blue' : 'orange')}</td>
    <td class="is-number">${unitPerformanceValue(unit.actualHm, ' HM')}</td>
    <td class="is-number">${unitPerformanceValue(unit.mtbfHours, ' Jam')}</td>
    <td class="is-number">${unitPerformanceValue(unit.mtbrHours, ' Jam')}</td>
    <td class="is-number">${unitPerformanceValue(unit.mttrHours, ' Jam')}</td>
    <td class="is-number is-danger">${unitPerformanceValue(unit.physicalDowntime, ' Jam')}</td>
    <td class="is-number">${unit.functionalFailures || 0}</td>
    <td class="is-number">${unit.eventCounts?.scheduled_service || 0}</td>
    <td class="is-number">${unit.eventCounts?.inspection || 0}</td>
    <td class="is-number${unit.repeatFailures ? ' is-danger' : ''}">${unit.repeatFailures || 0}</td>
  </tr>`).join('') : '<tr><td colspan="12" class="tabel__kosong">Tidak ada unit yang sesuai filter.</td></tr>';

  const typeBody = document.getElementById('unitPerformanceTypeRows');
  if (typeBody) typeBody.innerHTML = (data.unitTypes || []).map(group => `<tr><td><strong>${escapeMinePlanning(group.type)}</strong></td><td class="is-number">${group.totalUnits}</td><td>${unitPerformanceBar(group.pa)}</td><td>${unitPerformanceBar(group.ma, 'blue')}</td><td class="is-number">${unitPerformanceValue(group.actualHm, ' HM')}</td><td class="is-number">${unitPerformanceValue(group.mtbfHours, ' Jam')}</td><td class="is-number">${unitPerformanceValue(group.mtbrHours, ' Jam')}</td><td class="is-number is-danger">${unitPerformanceValue(group.physicalDowntime, ' Jam')}</td></tr>`).join('');

  const personnelBody = document.getElementById('unitPerformancePersonnelRows');
  if (personnelBody) personnelBody.innerHTML = (data.personnel || []).map(person => `<tr>
    <td><strong>${escapeMinePlanning(person.name)}</strong><small>${escapeMinePlanning(person.position || 'Maintenance')}</small></td>
    <td class="is-number">${person.jobs}</td><td class="is-number">${person.completedJobs}</td>
    <td class="is-number">${unitPerformanceValue(person.activeRepairHours, ' Jam')}</td>
    <td class="is-number">${unitPerformanceValue(person.medianActiveRepairHours, ' Jam')}</td>
    <td>${unitPerformanceBar(person.firstTimeFixRate, Number(person.firstTimeFixRate) >= 85 ? 'green' : 'orange')}</td>
    <td>${unitPerformanceBar(person.completionRate, 'blue')}</td>
    <td>${unitPerformanceBar(person.documentationRate, 'purple')}</td>
    <td class="is-number">${person.scheduledServices}</td><td class="is-number">${person.inspections}</td>
    <td class="is-number${person.repeatFailures ? ' is-danger' : ''}">${person.repeatFailures}</td>
  </tr>`).join('');

  const maintenanceBody = document.getElementById('unitPerformanceMaintenanceRows');
  if (maintenanceBody) maintenanceBody.innerHTML = (data.maintenanceEvents || []).length ? data.maintenanceEvents.map(event => `<tr>
    <td>${unitPerformanceEventBadge(event.event_type)}</td><td><strong>${escapeMinePlanning(event.kode_alat)}</strong><small>${escapeMinePlanning(event.kelas_alat || event.tipe_alat || '')}</small></td>
    <td><strong>${escapeMinePlanning(event.title)}</strong><small>${escapeMinePlanning(event.component || event.description || '—')}</small></td>
    <td>${escapeMinePlanning(formatBreakdownDateTime(event.scheduled_start))}<small>hingga ${escapeMinePlanning(formatBreakdownDateTime(event.scheduled_finish))}</small></td>
    <td>${event.actual_start ? escapeMinePlanning(formatBreakdownDateTime(event.actual_start)) : '—'}<small>${event.actual_finish ? `hingga ${escapeMinePlanning(formatBreakdownDateTime(event.actual_finish))}` : ''}</small></td>
    <td>${unitPerformanceStatusBadge(event.status)}</td><td class="is-number">${unitPerformanceValue(event.period_event_hours, ' Jam')}</td>
    <td>${escapeMinePlanning(event.pic_name || 'Belum ditetapkan')}</td><td><button class="tombol tombol--kecil" onclick="bukaModalMaintenanceEvent('${escapeMinePlanning(event.id)}')">Update</button></td>
  </tr>`).join('') : '<tr><td colspan="9" class="tabel__kosong">Belum ada service berkala atau inspeksi pada periode ini.</td></tr>';
}

function unitPerformanceExcelSheet(headers, rows, widths, formats = {}) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows], { cellDates: true });
  sheet['!cols'] = widths.map(wch => ({ wch }));
  if (rows.length) sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${rows.length + 1}` };
  Object.entries(formats).forEach(([columnIndex, numberFormat]) => {
    for (let rowIndex = 1; rowIndex <= rows.length; rowIndex += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: Number(columnIndex) })];
      if (cell && (cell.t === 'n' || cell.t === 'd')) cell.z = numberFormat;
    }
  });
  return sheet;
}

function exportUnitPerformanceExcel() {
  if (!window.XLSX) return alert('Library Excel belum siap. Refresh dashboard lalu coba kembali.');
  const data = cachedUnitPerformance;
  if (!data) return alert('Data Unit Performance belum tersedia.');
  const units = getFilteredUnitPerformanceUnits();
  if (!units.length) return alert('Tidak ada unit yang sesuai filter untuk diekspor.');

  const searchRaw = String(document.getElementById('unitPerformanceSearch')?.value || '').trim();
  const search = searchRaw.toLowerCase();
  const type = String(document.getElementById('unitPerformanceType')?.value || '');
  const summary = summarizeFilteredUnitPerformance(units);
  const scope = unitPerformanceScopeLabel(units, search, type);
  const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const periodLabel = `${monthNames[Number(data.period?.month || 1) - 1]} ${data.period?.year || ''}`.trim();
  const percent = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '' : Number(value) / 100;
  const number = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '' : Number(value);
  const date = value => {
    if (!value) return '';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed;
  };

  const summaryRows = [
    ['UNIT PERFORMANCE', ''],
    ['Periode', periodLabel],
    ['Cakupan Filter', scope],
    ['Jenis Unit', type || 'Semua Jenis'],
    ['Pencarian Unit', searchRaw || 'Semua Unit'],
    ['Jumlah Hari Periode', Number(data.period?.days || 0)],
    ['Jumlah Unit', summary.totalUnits],
    ['Unit dengan Actual HM', summary.unitsWithHm],
    ['Actual HM', summary.actualHm],
    [],
    ['INDIKATOR', 'NILAI', 'SATUAN', 'DASAR PERHITUNGAN'],
    ['Physical Availability', percent(summary.pa), '%', 'Calendar Hours - seluruh downtime fisik'],
    ['Mechanical Availability', percent(summary.ma), '%', 'Scheduled Hours - maintenance downtime'],
    ['MTBF', number(summary.mtbfHours), 'Jam', `Actual HM / ${summary.functionalFailures} functional failure`],
    ['MTBR', number(summary.mtbrHours), 'Jam', `Actual HM / ${summary.correctiveRepairs} corrective repair`],
    ['MTTR', number(summary.mttrHours), 'Jam', `${summary.completedRepairCount} pekerjaan selesai dalam scope`],
    ['Total Downtime', summary.physicalDowntime, 'Jam', 'Breakdown + service + inspeksi + corrective repair'],
    ['Scheduled Service', summary.scheduledServices, 'Record', 'Service berkala dalam scope'],
    ['Inspeksi', summary.inspections, 'Record', 'Inspeksi dalam scope'],
    [],
    ['Catatan Data Quality', `${summary.unitsWithHm} dari ${summary.totalUnits} unit memiliki actual HM.`],
    ['Catatan Personel', 'Sheet Performance Personel menampilkan agregasi personel seluruh periode.']
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 30 }, { wch: 46 }, { wch: 14 }, { wch: 54 }];
  ['B12', 'B13'].forEach(address => { if (summarySheet[address]) summarySheet[address].z = '0.00%'; });
  ['B9', 'B14', 'B15', 'B16', 'B17'].forEach(address => { if (summarySheet[address]?.t === 'n') summarySheet[address].z = '#,##0.00'; });
  ['B6', 'B7', 'B8', 'B18', 'B19'].forEach(address => { if (summarySheet[address]?.t === 'n') summarySheet[address].z = '#,##0'; });

  const unitHeaders = ['Kode Unit', 'Jenis Unit', 'Model / Tipe', 'Brand', 'Calendar Hours', 'Scheduled Hours', 'PA', 'MA', 'Actual HM', 'Functional Failure', 'Corrective Repair', 'MTBF (Jam)', 'MTBR (Jam)', 'MTTR (Jam)', 'Total Downtime (Jam)', 'Breakdown (Jam)', 'Service (Jam)', 'Inspeksi (Jam)', 'Corrective Repair (Jam)', 'Scheduled Service', 'Inspeksi', 'Repeat Failure'];
  const unitRows = units.map(unit => [
    unit.kode_alat || '', unit.kelas_alat || unit.class_unit || '', unit.tipe_alat || unit.class_unit || '', unit.brand || '',
    Number(unit.calendarHours || 0), Number(unit.scheduledHours || 0), percent(unit.pa), percent(unit.ma), Number(unit.actualHm || 0),
    Number(unit.functionalFailures || 0), Number(unit.correctiveRepairs || 0), number(unit.mtbfHours), number(unit.mtbrHours), number(unit.mttrHours),
    Number(unit.physicalDowntime || 0), Number(unit.downtime?.breakdown || 0), Number(unit.downtime?.scheduledService || 0), Number(unit.downtime?.inspection || 0), Number(unit.downtime?.correctiveRepair || 0),
    Number(unit.eventCounts?.scheduled_service || 0), Number(unit.eventCounts?.inspection || 0), Number(unit.repeatFailures || 0)
  ]);
  const unitSheet = unitPerformanceExcelSheet(unitHeaders, unitRows, [17, 20, 22, 18, ...Array(18).fill(18)], { 4: '#,##0.00', 5: '#,##0.00', 6: '0.00%', 7: '0.00%', 8: '#,##0.00', 9: '#,##0', 10: '#,##0', 11: '#,##0.00', 12: '#,##0.00', 13: '#,##0.00', 14: '#,##0.00', 15: '#,##0.00', 16: '#,##0.00', 17: '#,##0.00', 18: '#,##0.00', 19: '#,##0', 20: '#,##0', 21: '#,##0' });

  const groupedTypes = new Map();
  units.forEach(unit => {
    const unitType = String(unit.kelas_alat || unit.class_unit || unit.tipe_alat || 'Lainnya');
    if (!groupedTypes.has(unitType)) groupedTypes.set(unitType, []);
    groupedTypes.get(unitType).push(unit);
  });
  const typeHeaders = ['Jenis Unit', 'Jumlah Unit', 'PA', 'MA', 'Actual HM', 'MTBF (Jam)', 'MTBR (Jam)', 'MTTR (Jam)', 'Downtime (Jam)', 'Functional Failure', 'Corrective Repair', 'Scheduled Service', 'Inspeksi', 'Repeat Failure'];
  const typeRows = [...groupedTypes.entries()].sort(([a], [b]) => a.localeCompare(b, 'id-ID')).map(([unitType, typeUnits]) => {
    const item = summarizeFilteredUnitPerformance(typeUnits);
    return [unitType, item.totalUnits, percent(item.pa), percent(item.ma), item.actualHm, number(item.mtbfHours), number(item.mtbrHours), number(item.mttrHours), item.physicalDowntime, item.functionalFailures, item.correctiveRepairs, item.scheduledServices, item.inspections, typeUnits.reduce((sum, unit) => sum + Number(unit.repeatFailures || 0), 0)];
  });
  const typeSheet = unitPerformanceExcelSheet(typeHeaders, typeRows, [24, ...Array(13).fill(19)], { 1: '#,##0', 2: '0.00%', 3: '0.00%', 4: '#,##0.00', 5: '#,##0.00', 6: '#,##0.00', 7: '#,##0.00', 8: '#,##0.00', 9: '#,##0', 10: '#,##0', 11: '#,##0', 12: '#,##0', 13: '#,##0' });

  const personnelHeaders = ['Personel', 'Jabatan', 'Job', 'Selesai', 'Active Repair (Jam)', 'Median Repair (Jam)', 'First-Time Fix', 'Completion Rate', 'Documentation Rate', 'Scheduled Service', 'Inspeksi', 'Corrective Repair', 'Repeat Failure'];
  const personnelRows = (data.personnel || []).map(person => [person.name || '', person.position || '', Number(person.jobs || 0), Number(person.completedJobs || 0), Number(person.activeRepairHours || 0), number(person.medianActiveRepairHours), percent(person.firstTimeFixRate), percent(person.completionRate), percent(person.documentationRate), Number(person.scheduledServices || 0), Number(person.inspections || 0), Number(person.correctiveRepairs || 0), Number(person.repeatFailures || 0)]);
  const personnelSheet = unitPerformanceExcelSheet(personnelHeaders, personnelRows, [25, 28, ...Array(11).fill(20)], { 2: '#,##0', 3: '#,##0', 4: '#,##0.00', 5: '#,##0.00', 6: '0.00%', 7: '0.00%', 8: '0.00%', 9: '#,##0', 10: '#,##0', 11: '#,##0', 12: '#,##0' });

  const selectedIds = new Set(units.map(unit => String(unit.id || '')));
  const selectedCodes = new Set(units.map(unit => String(unit.kode_alat || '')));
  const maintenanceEvents = (data.maintenanceEvents || []).filter(event => selectedIds.has(String(event.equipment_id || '')) || selectedCodes.has(String(event.kode_alat || '')));
  const maintenanceHeaders = ['Jenis', 'Kode Unit', 'Jenis Unit', 'Pekerjaan', 'Komponen', 'Rencana Mulai', 'Rencana Selesai', 'Aktual Mulai', 'Aktual Selesai', 'Status', 'Downtime (Jam)', 'PIC', 'Interval Service (HM)', 'Meter HM', 'Deskripsi', 'Failure Mode', 'Penyebab', 'Tindakan Perbaikan'];
  const maintenanceRows = maintenanceEvents.map(event => [MAINTENANCE_EVENT_LABELS[event.event_type] || event.event_type || '', event.kode_alat || '', event.kelas_alat || event.tipe_alat || '', event.title || '', event.component || '', date(event.scheduled_start), date(event.scheduled_finish), date(event.actual_start), date(event.actual_finish), MAINTENANCE_STATUS_LABELS[event.status] || event.status || '', Number(event.period_event_hours || 0), event.pic_name || '', number(event.service_interval_hm), number(event.meter_hm), event.description || '', event.failure_mode || '', event.failure_cause || '', event.corrective_action || '']);
  const maintenanceSheet = unitPerformanceExcelSheet(maintenanceHeaders, maintenanceRows, [20, 17, 20, 30, 22, 20, 20, 20, 20, 18, 18, 24, 20, 16, 38, 24, 24, 38], { 5: 'yyyy-mm-dd hh:mm', 6: 'yyyy-mm-dd hh:mm', 7: 'yyyy-mm-dd hh:mm', 8: 'yyyy-mm-dd hh:mm', 10: '#,##0.00', 12: '#,##0.00', 13: '#,##0.00' });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Ringkasan KPI');
  XLSX.utils.book_append_sheet(workbook, unitSheet, 'Per Unit');
  XLSX.utils.book_append_sheet(workbook, typeSheet, 'Jenis Unit');
  XLSX.utils.book_append_sheet(workbook, personnelSheet, 'Performance Personel');
  XLSX.utils.book_append_sheet(workbook, maintenanceSheet, 'Maintenance & Inspeksi');
  const fileScope = ([type, searchRaw].filter(Boolean).join('_') || 'Semua-Unit').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'Semua-Unit';
  XLSX.writeFile(workbook, `OMOS_Unit_Performance_${data.period?.year}-${String(data.period?.month || 1).padStart(2, '0')}_${fileScope}_${breakdownLocalDate()}.xlsx`, { cellDates: true });
}

async function loadUnitPerformance(year, month) {
  const response = await fetch(getProdApiUrl(`/api/admin/production/unit-performance?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`), { headers: { ...getProdAuthHeaders() } });
  cachedUnitPerformance = await readBreakdownResponse(response);
  return cachedUnitPerformance;
}

async function refreshUnitPerformance() {
  const year = document.getElementById('unitPerformanceYear')?.value || new Date().getFullYear();
  const month = document.getElementById('unitPerformanceMonth')?.value || (new Date().getMonth() + 1);
  await bukaUnitPerformance(year, month);
}

async function bukaUnitPerformance(selectedYear, selectedMonth) {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  const year = Number(selectedYear || document.getElementById('slicerBreakdownTahun')?.value || new Date().getFullYear());
  const month = Number(selectedMonth || document.getElementById('slicerBreakdownBulan')?.value || (new Date().getMonth() + 1));
  konten.innerHTML = '<div class="unit-performance-modal"><h3>📈 Unit Performance</h3><div class="unit-performance-loading">Menghitung PA, MA, MTBF, MTBR dan performance personel…</div></div>';
  overlay.hidden = false;
  try {
    const data = await loadUnitPerformance(year, month);
    const fleet = data.fleet || {};
    const types = [...new Set((data.units || []).map(unit => String(unit.kelas_alat || unit.class_unit || unit.tipe_alat || 'Lainnya')))];
    const years = [];
    for (let item = new Date().getFullYear() - 4; item <= new Date().getFullYear() + 2; item += 1) years.push(item);
    konten.innerHTML = `<div class="unit-performance-modal">
      <header class="unit-performance-head"><div><h3>📈 Unit Performance</h3><p>KPI maintenance berbasis jam kalender periode, actual HM, functional failure, dan corrective repair.</p></div><div class="unit-performance-actions"><label>Tahun<select id="unitPerformanceYear" onchange="refreshUnitPerformance()">${years.map(item => `<option value="${item}"${item === year ? ' selected' : ''}>${item}</option>`).join('')}</select></label><label>Bulan<select id="unitPerformanceMonth" onchange="refreshUnitPerformance()">${['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'].map((label, index) => `<option value="${index + 1}"${index + 1 === month ? ' selected' : ''}>${label}</option>`).join('')}</select></label><button class="tombol unit-performance-export" onclick="exportUnitPerformanceExcel()">📊 Export Excel</button><button class="tombol unit-performance-add" onclick="bukaModalMaintenanceEvent()">+ Maintenance / Inspeksi</button><button class="tombol" onclick="tutupModalGenerik()">Tutup</button></div></header>
      <div class="unit-performance-quality"><strong id="unitPerformanceDataQualityValue">Data Quality ${unitPerformancePercent(data.dataQuality?.hmCoveragePercent)}</strong><span id="unitPerformanceDataQualityText">${fleet.unitsWithHm || 0} dari ${fleet.totalUnits || 0} unit memiliki actual HM. ${escapeMinePlanning(data.dataQuality?.note || '')}</span></div>
      <section class="unit-performance-kpis">
        <article class="is-green"><span>Physical Availability</span><strong id="unitPerformancePa">${unitPerformancePercent(fleet.pa)}</strong><small>Calendar Hours − seluruh downtime fisik</small></article>
        <article class="is-blue"><span>Mechanical Availability</span><strong id="unitPerformanceMa">${unitPerformancePercent(fleet.ma)}</strong><small>Scheduled Hours − maintenance downtime</small></article>
        <article class="is-purple"><span>MTBF</span><strong id="unitPerformanceMtbf">${unitPerformanceValue(fleet.mtbfHours, ' Jam')}</strong><small id="unitPerformanceMtbfBasis">Actual HM / ${fleet.functionalFailures || 0} functional failure</small></article>
        <article class="is-indigo"><span>MTBR</span><strong id="unitPerformanceMtbr">${unitPerformanceValue(fleet.mtbrHours, ' Jam')}</strong><small id="unitPerformanceMtbrBasis">Actual HM / ${fleet.correctiveRepairs || 0} corrective repair</small></article>
        <article class="is-orange"><span>MTTR</span><strong id="unitPerformanceMttr">${unitPerformanceValue(fleet.mttrHours, ' Jam')}</strong><small id="unitPerformanceMttrBasis">Rata-rata waktu restorasi pekerjaan selesai</small></article>
        <article class="is-red"><span>Total Downtime</span><strong id="unitPerformanceDowntime">${unitPerformanceValue(fleet.physicalDowntime, ' Jam')}</strong><small>Breakdown + service + inspeksi + repair</small></article>
        <article><span>Scheduled Service</span><strong id="unitPerformanceServices">${fleet.scheduledServices || 0}</strong><small>Record service berkala periode</small></article>
        <article><span>Inspeksi</span><strong id="unitPerformanceInspections">${fleet.inspections || 0}</strong><small>Record inspeksi periode</small></article>
      </section>
      <div class="unit-performance-filter"><label>Cari Unit<input id="unitPerformanceSearch" type="search" placeholder="Kode, class, tipe atau brand…" oninput="renderUnitPerformance()" /></label><label>Jenis Unit<select id="unitPerformanceType" onchange="renderUnitPerformance()"><option value="">Semua Jenis</option>${types.map(item => `<option>${escapeMinePlanning(item)}</option>`).join('')}</select></label><span id="unitPerformanceScopeBadge">${data.period?.days || 0} hari · ${fleet.totalUnits || 0} unit · ${unitPerformanceValue(fleet.actualHm, ' actual HM')}</span></div>
      <nav class="unit-performance-tabs"><button data-unit-performance-tab="units" onclick="setUnitPerformanceTab('units')">Per Unit</button><button data-unit-performance-tab="types" onclick="setUnitPerformanceTab('types')">Jenis Unit</button><button data-unit-performance-tab="personnel" onclick="setUnitPerformanceTab('personnel')">Performance Personel</button><button data-unit-performance-tab="maintenance" onclick="setUnitPerformanceTab('maintenance')">Maintenance & Inspeksi</button></nav>
      <div class="unit-performance-panels">
        <section data-unit-performance-panel="units"><div class="unit-performance-table-wrap"><table class="unit-performance-table is-units"><thead><tr><th>Unit</th><th>PA</th><th>MA</th><th>Actual HM</th><th>MTBF</th><th>MTBR</th><th>MTTR</th><th>Downtime</th><th>Failure</th><th>Service</th><th>Inspeksi</th><th>Repeat</th></tr></thead><tbody id="unitPerformanceUnitRows"></tbody></table></div></section>
        <section data-unit-performance-panel="types" hidden><div class="unit-performance-table-wrap"><table class="unit-performance-table"><thead><tr><th>Jenis Unit</th><th>Unit</th><th>PA</th><th>MA</th><th>Actual HM</th><th>MTBF</th><th>MTBR</th><th>Downtime</th></tr></thead><tbody id="unitPerformanceTypeRows"></tbody></table></div></section>
        <section data-unit-performance-panel="personnel" hidden><p class="unit-performance-note">Active repair hours hanya mengambil Progres Mekanik dan waktu aktual pekerjaan maintenance. Waiting part, tool, manpower, dan vendor tidak dibebankan kepada personel.</p><div class="unit-performance-table-wrap"><table class="unit-performance-table"><thead><tr><th>Personel</th><th>Job</th><th>Selesai</th><th>Active Repair</th><th>Median Repair</th><th>First-Time Fix</th><th>Completion</th><th>Dokumentasi</th><th>Service</th><th>Inspeksi</th><th>Repeat</th></tr></thead><tbody id="unitPerformancePersonnelRows"></tbody></table></div></section>
        <section data-unit-performance-panel="maintenance" hidden><div class="unit-performance-table-wrap"><table class="unit-performance-table"><thead><tr><th>Jenis</th><th>Unit</th><th>Pekerjaan</th><th>Rencana</th><th>Aktual</th><th>Status</th><th>Downtime</th><th>PIC</th><th>Aksi</th></tr></thead><tbody id="unitPerformanceMaintenanceRows"></tbody></table></div></section>
      </div>
    </div>`;
    renderUnitPerformance();
    setUnitPerformanceTab(unitPerformanceActiveTab);
  } catch (error) {
    konten.innerHTML = `<div class="unit-performance-modal"><h3>📈 Unit Performance</h3><div class="unit-performance-loading is-error">Gagal memuat dashboard: ${escapeMinePlanning(error.message)}</div><div class="breakdown-modal-actions"><button class="tombol" onclick="tutupModalGenerik()">Tutup</button></div></div>`;
  }
}

async function bukaModalMaintenanceEvent(eventId = '') {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  if (!(masterProdData.equipment || []).length || !(masterProdData.personnel || []).length) await muatMasterDataProduksi();
  const event = (cachedUnitPerformance?.maintenanceEvents || []).find(item => String(item.id) === String(eventId)) || null;
  const start = event ? unitPerformanceDateTimeInput(event.scheduled_start) : breakdownLocalDateTime();
  const defaultFinish = new Date(new Date(start).getTime() + 2 * 3600000);
  const finish = event ? unitPerformanceDateTimeInput(event.scheduled_finish) : breakdownLocalDateTime(defaultFinish);
  const unitOptions = (masterProdData.equipment || []).filter(unit => unit.id && unit.kode_alat).map(unit => `<option value="${escapeMinePlanning(unit.id)}"${String(event?.equipment_id || '') === String(unit.id) ? ' selected' : ''}>${escapeMinePlanning(unit.kode_alat)} — ${escapeMinePlanning(unit.kelas_alat || unit.tipe_alat || 'Unit')}</option>`).join('');
  const shiftOptions = getInputLogShiftChoices().map(shift => `<option value="${escapeMinePlanning(shift.id)}"${String(event?.shift_id || '') === String(shift.id) ? ' selected' : ''}>${escapeMinePlanning(shift.nama_shift)}</option>`).join('');
  konten.innerHTML = `<div class="breakdown-modal-content maintenance-event-form"><h3>${event ? '📝 Update' : '🛠️ Catat'} Maintenance / Inspeksi</h3><p class="breakdown-modal-note">Service berkala dan inspeksi dicatat terpisah dari breakdown. Isi waktu aktual untuk menghitung downtime dan performance PIC.</p><form id="formMaintenanceEvent" class="breakdown-form-grid">
    <div class="breakdown-form-field"><label>Jenis Pekerjaan *</label><select id="meType"><option value="scheduled_service">Service Berkala</option><option value="inspection">Inspeksi</option><option value="corrective_repair">Corrective Running Repair</option><option value="calendar_exclusion">Calendar Exclusion</option></select></div>
    <div class="breakdown-form-field"><label>Status *</label><select id="meStatus"><option value="planned">Terjadwal</option><option value="in_progress">Berjalan</option><option value="completed">Selesai</option><option value="cancelled">Dibatalkan</option></select></div>
    <div class="breakdown-form-field"><label>Tanggal *</label><input id="meDate" type="date" value="${escapeMinePlanning(String(event?.tanggal || start).slice(0, 10))}" required /></div>
    <div class="breakdown-form-field"><label>Shift</label><select id="meShift"><option value="">Tanpa Shift</option>${shiftOptions}</select></div>
    <div class="breakdown-form-field"><label>Unit *</label><select id="meEquipment" required>${unitOptions}</select></div>
    <div class="breakdown-form-field"><label>PIC Maintenance</label><select id="mePic">${breakdownPersonnelOptions(event?.pic_id || '')}</select></div>
    <div class="breakdown-form-field is-wide"><label>Judul Pekerjaan *</label><input id="meTitle" value="${escapeMinePlanning(event?.title || '')}" placeholder="Contoh: Service berkala 500 HM" required /></div>
    <div class="breakdown-form-field"><label>Komponen / System</label><input id="meComponent" value="${escapeMinePlanning(event?.component || '')}" placeholder="Engine, brake, hydraulic…" /></div>
    <div class="breakdown-form-field"><label>Interval Service (HM)</label><input id="meServiceInterval" type="number" min="0.01" step="0.01" value="${escapeMinePlanning(event?.service_interval_hm || '')}" /></div>
    <div class="breakdown-form-field"><label>Rencana Mulai *</label><input id="meScheduledStart" type="datetime-local" value="${escapeMinePlanning(start)}" required /></div>
    <div class="breakdown-form-field"><label>Rencana Selesai *</label><input id="meScheduledFinish" type="datetime-local" value="${escapeMinePlanning(finish)}" required /></div>
    <div class="breakdown-form-field"><label>Aktual Mulai</label><input id="meActualStart" type="datetime-local" value="${escapeMinePlanning(unitPerformanceDateTimeInput(event?.actual_start))}" /></div>
    <div class="breakdown-form-field"><label>Aktual Selesai</label><input id="meActualFinish" type="datetime-local" value="${escapeMinePlanning(unitPerformanceDateTimeInput(event?.actual_finish))}" /></div>
    <div class="breakdown-form-field"><label>Meter HM</label><input id="meMeterHm" type="number" min="0" step="0.01" value="${escapeMinePlanning(event?.meter_hm || '')}" /></div>
    <div class="maintenance-event-checks"><label><input id="meAffectsAvailability" type="checkbox"${event?.affects_availability === false ? '' : ' checked'} /> Unit tidak tersedia selama pekerjaan</label><label><input id="meFunctionalFailure" type="checkbox"${event?.functional_failure ? ' checked' : ''} /> Termasuk functional failure</label></div>
    <div class="breakdown-form-field is-wide"><label>Deskripsi / Hasil Inspeksi</label><textarea id="meDescription" rows="2" placeholder="Scope pekerjaan, temuan inspeksi, atau kondisi unit">${escapeMinePlanning(event?.description || '')}</textarea></div>
    <div class="breakdown-form-field"><label>Failure Mode</label><input id="meFailureMode" value="${escapeMinePlanning(event?.failure_mode || '')}" /></div>
    <div class="breakdown-form-field"><label>Penyebab</label><input id="meFailureCause" value="${escapeMinePlanning(event?.failure_cause || '')}" /></div>
    <div class="breakdown-form-field is-wide"><label>Tindakan Perbaikan</label><textarea id="meCorrectiveAction" rows="2">${escapeMinePlanning(event?.corrective_action || '')}</textarea></div>
    <div class="breakdown-modal-actions is-wide"><button type="button" class="tombol" onclick="bukaUnitPerformance(${cachedUnitPerformance?.period?.year || new Date().getFullYear()},${cachedUnitPerformance?.period?.month || new Date().getMonth() + 1})">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Record</button></div>
  </form></div>`;
  document.getElementById('meType').value = event?.event_type || 'scheduled_service';
  document.getElementById('meStatus').value = event?.status || 'planned';
  overlay.hidden = false;
  document.getElementById('formMaintenanceEvent').addEventListener('submit', async submitEvent => {
    submitEvent.preventDefault();
    const get = id => document.getElementById(id);
    const payload = {
      event_type: get('meType').value, status: get('meStatus').value, tanggal: get('meDate').value,
      shift_id: get('meShift').value || null, equipment_id: get('meEquipment').value, pic_id: get('mePic').value || null,
      title: get('meTitle').value.trim(), component: get('meComponent').value.trim(),
      service_interval_hm: get('meServiceInterval').value || null, meter_hm: get('meMeterHm').value || null,
      scheduled_start: breakdownToIso(get('meScheduledStart').value), scheduled_finish: breakdownToIso(get('meScheduledFinish').value),
      actual_start: get('meActualStart').value ? breakdownToIso(get('meActualStart').value) : null,
      actual_finish: get('meActualFinish').value ? breakdownToIso(get('meActualFinish').value) : null,
      affects_availability: get('meAffectsAvailability').checked, functional_failure: get('meFunctionalFailure').checked,
      description: get('meDescription').value.trim(), failure_mode: get('meFailureMode').value.trim(),
      failure_cause: get('meFailureCause').value.trim(), corrective_action: get('meCorrectiveAction').value.trim()
    };
    try {
      const response = await fetch(getProdApiUrl(event ? `/api/admin/production/maintenance-events/${encodeURIComponent(event.id)}` : '/api/admin/production/maintenance-events'), {
        method: event ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify(payload)
      });
      await readBreakdownResponse(response);
      await bukaUnitPerformance(cachedUnitPerformance?.period?.year, cachedUnitPerformance?.period?.month);
    } catch (error) { alert(`Gagal menyimpan maintenance: ${error.message}`); }
  });
}

async function bukaModalInputBreakdown(selectedEquipmentId = '') {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;
  if (!(masterProdData.equipment || []).length || !(masterProdData.breakdownCodes || []).length) await muatMasterDataProduksi();
  try {
    await muatPicMaintenanceBreakdown();
  } catch (error) {
    return alert(`PIC Maintenance gagal dimuat: ${error.message}`);
  }
  const units = [...(masterProdData.equipment || [])].filter(unit => unit.id && unit.kode_alat)
    .sort((a, b) => String(a.kode_alat).localeCompare(String(b.kode_alat), 'id-ID', { numeric: true }));
  const unitOptions = units.map(unit => `<option value="${escapeMinePlanning(unit.id)}"${String(unit.id) === String(selectedEquipmentId) ? ' selected' : ''}>${escapeMinePlanning(unit.kode_alat)} — ${escapeMinePlanning(unit.kelas_alat || unit.tipe_alat || 'Unit')}</option>`).join('');
  const codeOptions = (masterProdData.breakdownCodes || []).map(code => `<option value="${escapeMinePlanning(code.id)}">${escapeMinePlanning(code.kode)} — ${escapeMinePlanning(code.kategori)}</option>`).join('');
  const shiftOptions = getInputLogShiftChoices().map(shift => `<option value="${escapeMinePlanning(shift.id)}">${escapeMinePlanning(shift.nama_shift)}</option>`).join('');
  const reporterName = localStorage.getItem('admin_nama') || 'Akun login';
  konten.innerHTML = `<div class="breakdown-modal-content">
    <h3>🛠️ Breakdown Baru</h3><p class="breakdown-modal-note">Satu unit hanya dapat memiliki satu insiden aktif. Durasi status dihitung otomatis dari timeline perubahan.</p>
    <form id="formInputBreakdown" class="breakdown-form-grid">
      <div class="breakdown-form-field"><label>Tanggal Operasional *</label><input type="date" id="ibTanggal" value="${breakdownLocalDate()}" required /></div>
      <div class="breakdown-form-field"><label>Shift *</label><select id="ibShift" required>${shiftOptions}</select></div>
      <div class="breakdown-form-field"><label>Unit *</label><select id="ibEquipment" required>${unitOptions}</select></div>
      <div class="breakdown-form-field"><label>Jenis Kerusakan *</label><select id="ibBreakdownCode" required>${codeOptions}</select></div>
      <div class="breakdown-form-field is-wide"><label>Deskripsi Kerusakan *</label><textarea id="ibDescription" rows="2" placeholder="Jelaskan gejala dan komponen yang bermasalah" required></textarea></div>
      <div class="breakdown-form-field"><label>Mulai Breakdown *</label><input type="datetime-local" id="ibStart" value="${breakdownLocalDateTime()}" required /></div>
      <div class="breakdown-form-field"><label>Status Awal *</label><select id="ibInitialStatus" onchange="toggleBreakdownPartFields('ib',this.value)"><option value="mechanic_progress">Progres Mekanik</option><option value="waiting_part">Waiting Part</option><option value="waiting_tool">Waiting Tool</option><option value="waiting_manpower">Waiting Manpower</option><option value="waiting_vendor">Waiting Vendor</option></select></div>
      <div class="breakdown-form-field"><label>Report By</label><input value="${escapeMinePlanning(reporterName)}" readonly /></div>
      <div class="breakdown-form-field"><label>PIC Maintenance *</label><select id="ibPic" required>${breakdownPersonnelOptions()}</select></div>
      <div class="breakdown-form-field is-wide"><label>Catatan Awal</label><textarea id="ibRemark" rows="2" placeholder="Lokasi unit, tindakan awal, atau informasi pendukung"></textarea></div>
      ${breakdownPartFields('ib')}
      <div class="breakdown-modal-actions is-wide"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Breakdown</button></div>
    </form></div>`;
  overlay.hidden = false;
  document.getElementById('formInputBreakdown').addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('ibInitialStatus').value;
    const payload = { tanggal: document.getElementById('ibTanggal').value, shift_id: document.getElementById('ibShift').value, equipment_id: document.getElementById('ibEquipment').value, breakdown_code_id: document.getElementById('ibBreakdownCode').value, description: document.getElementById('ibDescription').value.trim(), remark: document.getElementById('ibRemark').value.trim(), start_time: breakdownToIso(document.getElementById('ibStart').value), initial_status: status, pic_id: document.getElementById('ibPic').value };
    if (status === 'waiting_part') payload.parts = [collectBreakdownPart('ib')];
    try {
      const response = await fetch(getProdApiUrl('/api/admin/production/breakdown'), { method: 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify(payload) });
      await readBreakdownResponse(response); tutupModalGenerik(); await muatProdBreakdown();
    } catch (err) { alert(`Gagal menyimpan breakdown: ${err.message}`); }
  });
}

async function bukaModalUpdateStatusBreakdown(id) {
  const log = findBreakdownLog(id);
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!log || !overlay || !konten) return alert('Data breakdown tidak ditemukan pada periode ini.');
  try {
    await muatPicMaintenanceBreakdown();
  } catch (error) {
    return alert(`PIC Maintenance gagal dimuat: ${error.message}`);
  }
  const statusOptions = Object.entries(BREAKDOWN_STATUS_LABELS).filter(([status]) => status !== log.current_status)
    .filter(([status]) => status !== 'awaiting_verification')
    .map(([status, label]) => `<option value="${status}">${escapeMinePlanning(status === 'resolved' ? 'Ajukan Selesai Perbaikan' : label)}</option>`).join('');
  konten.innerHTML = `<div class="breakdown-modal-content"><h3>Update Status · ${escapeMinePlanning(log.kode_alat || 'Unit')}</h3>
    <p class="breakdown-modal-note">Status aktif: ${breakdownStatusBadge(log.current_status)} · Total breakdown ${formatBreakdownHours(log.elapsed_breakdown_hours)} jam.</p>
    <form id="formUpdateBreakdownStatus" class="breakdown-form-grid">
      <div class="breakdown-form-field"><label>Status Baru *</label><select id="ubStatus" required onchange="toggleBreakdownPartFields('ub',this.value)">${statusOptions}</select></div>
      <div class="breakdown-form-field"><label>Waktu Perubahan *</label><input id="ubChangedAt" type="datetime-local" value="${breakdownLocalDateTime()}" required /></div>
      <div class="breakdown-form-field is-wide"><label>PIC</label><select id="ubPic">${breakdownPersonnelOptions(log.pic_id)}</select></div>
      <div class="breakdown-form-field is-wide"><label>Catatan Status</label><textarea id="ubNote" rows="2" placeholder="Tindakan, kendala, atau alasan perubahan status"></textarea></div>
      ${breakdownPartFields('ub')}
      <div class="breakdown-modal-actions is-wide"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Simpan Status</button></div>
    </form></div>`;
  overlay.hidden = false;
  toggleBreakdownPartFields('ub', document.getElementById('ubStatus').value);
  document.getElementById('formUpdateBreakdownStatus').addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.getElementById('ubStatus').value;
    const payload = { status, changed_at: breakdownToIso(document.getElementById('ubChangedAt').value), pic_id: document.getElementById('ubPic').value || null, note: document.getElementById('ubNote').value.trim() };
    if (status === 'waiting_part') payload.parts = [collectBreakdownPart('ub')];
    try {
      const response = await fetch(getProdApiUrl(`/api/admin/production/breakdown/${encodeURIComponent(id)}/status`), { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify(payload) });
      await readBreakdownResponse(response); tutupModalGenerik(); await muatProdBreakdown();
    } catch (err) { alert(`Gagal mengubah status: ${err.message}`); }
  });
}

function bukaModalReadyVerification(id) {
  const log = findBreakdownLog(id);
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!log || !overlay || !konten) return alert('Data breakdown tidak ditemukan pada periode ini.');
  if (log.current_status !== 'awaiting_verification') return alert('Unit tidak sedang menunggu Verifikasi Ready.');
  konten.innerHTML = `<div class="breakdown-modal-content ready-verification-form">
    <div class="breakdown-detail-head"><div><h3>✅ Verifikasi Ready · ${escapeMinePlanning(log.kode_alat || 'Unit')}</h3><p>Validasi independen sebelum unit di-release ke operasi.</p></div>${breakdownStatusBadge(log.current_status)}</div>
    <p class="breakdown-modal-note">Selesai diperbaiki oleh <b>${escapeMinePlanning(log.repair_completed_by_name || log.pic_name || 'Maintenance')}</b> pada ${escapeMinePlanning(formatBreakdownDateTime(log.repair_completed_at))}. Validator harus user yang berbeda.</p>
    <form id="formReadyVerification" class="breakdown-form-grid">
      <div class="ready-verification-checklist is-wide">
        <label><input id="rvFunctionalTest" type="checkbox" /> Functional test berhasil</label>
        <label><input id="rvNoLeakAlarm" type="checkbox" /> Tidak ada kebocoran atau alarm aktif</label>
        <label><input id="rvSafetyDevices" type="checkbox" /> Sistem keselamatan dan guarding normal</label>
        <label><input id="rvToolsCleared" type="checkbox" /> Tools dan material perbaikan sudah dibersihkan</label>
        <label><input id="rvSafeOperate" type="checkbox" /> Unit aman untuk dioperasikan</label>
      </div>
      <div class="breakdown-form-field"><label>HM Saat Verifikasi</label><input id="rvMeterHm" type="number" min="0" step="0.01" placeholder="Contoh: 1234,50" /></div>
      <div class="breakdown-form-field"><label>Lokasi Unit</label><input id="rvLocation" placeholder="Workshop, pit, ROM…" /></div>
      <div class="breakdown-form-field is-wide"><label>Klasifikasi Jika Ditolak *</label><select id="rvRejectionType" onchange="toggleReadyNewFaultFields(this.value)"><option value="">Pilih saat unit dikembalikan</option><option value="same_fault">Perbaikan belum tuntas / kerusakan sama</option><option value="new_fault">Kerusakan baru / tidak berkaitan</option></select><small>Kerusakan sama mereklasifikasi standby provisional menjadi breakdown.</small></div>
      <div id="rvNewFaultFields" class="breakdown-part-fields is-wide" hidden>
        <div class="breakdown-form-field"><label>Kode Kerusakan Baru *</label><select id="rvNewBreakdownCode"><option value="">Pilih kode</option>${(masterProdData.breakdownCodes || []).map(code => `<option value="${escapeMinePlanning(code.id)}">${escapeMinePlanning(code.kode)} · ${escapeMinePlanning(code.kategori)}</option>`).join('')}</select></div>
        <div class="breakdown-form-field"><label>PIC Maintenance</label><select id="rvNewPic">${breakdownPersonnelOptions(log.pic_id)}</select></div>
        <div class="breakdown-form-field is-wide"><label>Deskripsi Kerusakan Baru *</label><input id="rvNewDescription" placeholder="Jelaskan temuan kerusakan baru" /></div>
      </div>
      <div class="breakdown-form-field is-wide"><label>Catatan Validator</label><textarea id="rvNote" rows="3" placeholder="Temuan validasi atau alasan dikembalikan ke Maintenance"></textarea></div>
      <div class="breakdown-modal-actions is-wide"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" data-result="rejected" class="tombol ready-verification-reject">Kembalikan ke Maintenance</button><button type="submit" data-result="approved" class="tombol breakdown-ready-button">Release to Operation</button></div>
    </form>
  </div>`;
  overlay.hidden = false;
  document.getElementById('formReadyVerification').addEventListener('submit', async event => {
    event.preventDefault();
    const result = event.submitter?.dataset?.result;
    const rejectionType = document.getElementById('rvRejectionType').value;
    if (result === 'rejected' && !rejectionType) return alert('Pilih klasifikasi penolakan: kerusakan sama atau kerusakan baru.');
    const payload = {
      result,
      rejection_type: result === 'rejected' ? rejectionType : null,
      checklist: {
        functional_test: document.getElementById('rvFunctionalTest').checked,
        no_leak_or_alarm: document.getElementById('rvNoLeakAlarm').checked,
        safety_devices: document.getElementById('rvSafetyDevices').checked,
        tools_cleared: document.getElementById('rvToolsCleared').checked,
        safe_to_operate: document.getElementById('rvSafeOperate').checked
      },
      meter_hm: document.getElementById('rvMeterHm').value || null,
      location: document.getElementById('rvLocation').value.trim(),
      note: document.getElementById('rvNote').value.trim(),
      new_breakdown_code_id: rejectionType === 'new_fault' ? document.getElementById('rvNewBreakdownCode').value : null,
      new_description: rejectionType === 'new_fault' ? document.getElementById('rvNewDescription').value.trim() : null,
      new_pic_id: rejectionType === 'new_fault' ? document.getElementById('rvNewPic').value || null : null
    };
    try {
      const response = await fetch(getProdApiUrl(`/api/admin/production/breakdown/${encodeURIComponent(id)}/ready-verification`), { method: 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify(payload) });
      await readBreakdownResponse(response);
      tutupModalGenerik();
      await muatProdBreakdown();
    } catch (error) {
      alert(`Verifikasi Ready gagal: ${error.message}`);
    }
  });
}

function toggleReadyNewFaultFields(value) {
  const container = document.getElementById('rvNewFaultFields');
  if (!container) return;
  const visible = value === 'new_fault';
  container.hidden = !visible;
  const code = document.getElementById('rvNewBreakdownCode');
  const description = document.getElementById('rvNewDescription');
  if (code) code.required = visible;
  if (description) description.required = visible;
}

function bukaModalRekonsiliasiReady(id) {
  const log = findBreakdownLog(id);
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!log || !overlay || !konten || log.current_status !== 'awaiting_verification') return alert('Unit tidak sedang menunggu Verifikasi Ready.');
  const minimum = breakdownLocalDateTime(log.repair_completed_at || new Date());
  konten.innerHTML = `<div class="breakdown-modal-content"><h3>🔄 Rekonsiliasi Ready · ${escapeMinePlanning(log.kode_alat)}</h3><p class="breakdown-modal-note">Gunakan jika unit sudah beroperasi tetapi verifikasi administratif terlambat. Jam standby ditutup pada waktu operasi aktual, sedangkan waktu input tetap tersimpan di audit.</p><form id="formReadyReconciliation" class="breakdown-form-grid">
    <div class="breakdown-form-field"><label>Waktu Operasi Aktual *</label><input id="rrEffectiveAt" type="datetime-local" min="${escapeMinePlanning(minimum)}" value="${escapeMinePlanning(breakdownLocalDateTime())}" required /></div>
    <div class="breakdown-form-field"><label>Sumber Bukti *</label><select id="rrSource" required><option value="">Pilih sumber</option><option value="production_log">Production Log / Ritase</option><option value="hm_movement">Perubahan HM</option><option value="dispatch">Dispatch / Assignment</option><option value="manual_supervisor">Konfirmasi Supervisor Produksi</option></select></div>
    <div class="breakdown-form-field is-wide"><label>Catatan Bukti *</label><textarea id="rrNote" rows="3" required placeholder="Nomor log, HM, ritase, lokasi, atau keterangan supervisor"></textarea></div>
    <div class="breakdown-modal-actions is-wide"><button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button><button type="submit" class="tombol tombol--utama">Konfirmasi Ready Aktual</button></div>
  </form></div>`;
  overlay.hidden = false;
  document.getElementById('formReadyReconciliation').addEventListener('submit', async event => {
    event.preventDefault();
    const payload = { effective_at: breakdownToIso(document.getElementById('rrEffectiveAt').value), evidence_source: document.getElementById('rrSource').value, note: document.getElementById('rrNote').value.trim() };
    try {
      const response = await fetch(getProdApiUrl(`/api/admin/production/breakdown/${encodeURIComponent(id)}/ready-reconciliation`), { method: 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify(payload) });
      await readBreakdownResponse(response); tutupModalGenerik(); await muatProdBreakdown();
    } catch (error) { alert(`Rekonsiliasi Ready gagal: ${error.message}`); }
  });
}

function breakdownHistoryMarkup(history, verifications = []) {
  const entries = [];
  (Array.isArray(history) ? history : []).forEach(item => entries.push({ type: 'status', at: item.started_at, item }));
  (Array.isArray(verifications) ? verifications : []).forEach(item => entries.push({ type: 'verification', at: item.verified_at, item }));
  if (!entries.length) return '<div class="breakdown-detail-empty">Belum ada histori status.</div>';
  return entries.sort((a, b) => new Date(a.at) - new Date(b.at)).map(entry => {
    const item = entry.item;
    if (entry.type === 'verification') {
      const approved = item.result === 'approved';
      const rejectionLabel = item.rejection_type === 'same_fault' ? ' · standby direklasifikasi ke breakdown' : item.rejection_type === 'new_fault' ? ' · dibuat breakdown baru' : '';
      return `<article class="is-ready-verification ${approved ? 'is-approved' : 'is-rejected'}"><span class="breakdown-timeline-dot"></span><div><b>${approved ? 'Ready to Operate' : 'Verifikasi Ditolak'}</b><small>${escapeMinePlanning(formatBreakdownDateTime(item.verified_at))} · ${escapeMinePlanning(item.location || 'Lokasi tidak dicatat')}${item.meter_hm !== null && item.meter_hm !== undefined ? ` · HM ${unitPerformanceValue(item.meter_hm)}` : ''}${escapeMinePlanning(rejectionLabel)}</small>${item.note ? `<p>${escapeMinePlanning(item.note)}</p>` : ''}<em>Validator: ${escapeMinePlanning(item.verified_by_name || 'Sistem')}</em></div></article>`;
    }
    const end = item.ended_at ? new Date(item.ended_at) : new Date();
    const hours = Math.max(0, (end - new Date(item.started_at)) / 3600000);
    return `<article><span class="breakdown-timeline-dot"></span><div><b>${escapeMinePlanning(BREAKDOWN_STATUS_LABELS[item.status] || item.status)}</b><small>${escapeMinePlanning(formatBreakdownDateTime(item.started_at))} → ${item.ended_at ? escapeMinePlanning(formatBreakdownDateTime(item.ended_at)) : 'sekarang'} · ${formatBreakdownHours(hours)} jam</small>${item.note ? `<p>${escapeMinePlanning(item.note)}</p>` : ''}<em>${escapeMinePlanning(item.changed_by_name || 'Sistem')}</em></div></article>`;
  }).join('');
}

function bukaDetailBreakdown(id) {
  const log = findBreakdownLog(id);
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!log || !overlay || !konten) return;
  const parts = Array.isArray(log.parts) ? log.parts : [];
  const partRows = parts.length ? parts.map(part => `<tr><td>${escapeMinePlanning(part.part_detail)}</td><td>${escapeMinePlanning(part.quantity || '—')}</td><td>${escapeMinePlanning(part.po_number || 'Belum terbit')}</td><td>${escapeMinePlanning(part.po_status || 'requested')}</td><td>${escapeMinePlanning(part.eta_date || '—')}</td></tr>`).join('') : '<tr><td colspan="5" class="tabel__kosong">Belum ada part/PO.</td></tr>';
  const detailAction = log.current_status === 'awaiting_verification'
    ? `<button type="button" class="tombol breakdown-ready-button" onclick="bukaModalReadyVerification('${escapeMinePlanning(log.id)}')">Verifikasi Ready</button><button type="button" class="tombol standby-review-button" onclick="bukaModalRekonsiliasiReady('${escapeMinePlanning(log.id)}')">Rekonsiliasi Operasi</button>`
    : log.current_status !== 'resolved'
      ? `<button type="button" class="tombol tombol--utama" onclick="bukaModalUpdateStatusBreakdown('${escapeMinePlanning(log.id)}')">Update Status</button>`
      : '';
  konten.innerHTML = `<div class="breakdown-modal-content breakdown-detail">
    <div class="breakdown-detail-head"><div><h3>${escapeMinePlanning(log.kode_alat || 'Unit')} · ${escapeMinePlanning(log.kategori_breakdown || 'Breakdown')}</h3><p>${escapeMinePlanning(log.description || 'Tanpa deskripsi')}</p></div>${breakdownStatusBadge(log.current_status)}</div>
    <div class="breakdown-detail-meta"><span><b>Mulai</b>${escapeMinePlanning(formatBreakdownDateTime(log.start_time))}</span><span><b>Selesai Perbaikan</b>${log.repair_completed_at ? escapeMinePlanning(formatBreakdownDateTime(log.repair_completed_at)) : '—'}</span><span><b>Ready Release</b>${log.finish_time ? escapeMinePlanning(formatBreakdownDateTime(log.finish_time)) : '—'}</span><span><b>Total BD</b>${formatBreakdownHours(log.elapsed_breakdown_hours)} jam</span><span><b>Report By</b>${escapeMinePlanning(log.report_by_name || 'Sistem')}</span><span><b>PIC</b>${escapeMinePlanning(log.pic_name || 'Belum ditetapkan')}</span></div>
    <h4>Timeline Status</h4><div class="breakdown-timeline">${breakdownHistoryMarkup(log.status_history, log.ready_verifications)}</div>
    <h4>Part dan Purchase Order</h4><div class="tabel-wrap"><table class="tabel breakdown-part-table"><thead><tr><th>Detail Part</th><th>Qty</th><th>No. PO</th><th>Status PO</th><th>ETA</th></tr></thead><tbody>${partRows}</tbody></table></div>
    <form id="formAddBreakdownPart" class="breakdown-inline-part-form"><input id="dbPartDetail" placeholder="Detail part baru" required /><input id="dbPoNumber" placeholder="Nomor PO / belum terbit" /><input id="dbQuantity" type="number" min="0.01" step="0.01" placeholder="Qty" /><select id="dbPoStatus"><option value="requested">Request dibuat</option><option value="po_process">Proses PO</option><option value="ordered">Dipesan</option><option value="arrived">Tiba</option></select><input id="dbEtaDate" type="date" /><button class="tombol tombol--kecil" type="submit">+ Tambah Part</button></form>
    <div class="breakdown-modal-actions"><button type="button" class="tombol" onclick="tutupModalGenerik()">Tutup</button>${detailAction}</div>
  </div>`;
  overlay.hidden = false;
  document.getElementById('formAddBreakdownPart').addEventListener('submit', async event => {
    event.preventDefault();
    const payload = { part_detail: document.getElementById('dbPartDetail').value.trim(), po_number: document.getElementById('dbPoNumber').value.trim(), quantity: document.getElementById('dbQuantity').value || null, po_status: document.getElementById('dbPoStatus').value, eta_date: document.getElementById('dbEtaDate').value || null };
    try {
      const response = await fetch(getProdApiUrl(`/api/admin/production/breakdown/${encodeURIComponent(id)}/parts`), { method: 'POST', headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() }, body: JSON.stringify(payload) });
      await readBreakdownResponse(response); await muatProdBreakdown(); bukaDetailBreakdown(id);
    } catch (err) { alert(`Gagal menambah part: ${err.message}`); }
  });
}

// -------------------------------------------------------------
// 5. INPUT RITASE & FLEET MAPPING
// -------------------------------------------------------------
async function muatProdRitase() {
  const container = document.getElementById('fleetRitaseContainer');
  if (!container) return;

  if (!(masterProdData.shifts || []).length) await muatMasterDataProduksi();

  const tanggalInput = document.getElementById('filterTanggalRitase');
  if (tanggalInput && !tanggalInput.value) tanggalInput.value = new Date().toISOString().split('T')[0];
  const tanggal = tanggalInput?.value || '';

  const shiftSelect = document.getElementById('filterShiftRitase');
  if (shiftSelect && !shiftSelect.dataset.ritaseInit) {
    shiftSelect.dataset.ritaseInit = '1';
    shiftSelect.innerHTML = '<option value="">Semua Shift</option>' +
      (masterProdData.shifts || []).map(s => `<option value="${s.id}">${escapeMinePlanning(s.nama_shift)}</option>`).join('');
  }
  const shiftId = shiftSelect?.value || '';

  container.innerHTML = '<p class="tabel__kosong" style="padding:24px;text-align:center;color:#64748b;">Memuat data ritase...</p>';
  if (!tanggal) {
    container.innerHTML = '<p class="tabel__kosong" style="padding:24px;text-align:center;color:#64748b;">Pilih tanggal terlebih dahulu.</p>';
    return;
  }

  try {
    const params = new URLSearchParams({ tanggal });
    if (shiftId) params.set('shift_id', shiftId);
    const res = await fetch(getProdApiUrl(`/api/admin/production/ritase/fleet?${params.toString()}`), {
      headers: { ...getProdAuthHeaders() }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const fleets = await res.json();

    if (!Array.isArray(fleets) || !fleets.length) {
      container.innerHTML = '<p class="tabel__kosong" style="padding:24px;text-align:center;color:#64748b;">Belum ada fleet untuk tanggal ini. Klik "+ Tambah Fleet" untuk membuat tabel fleet.</p>';
      return;
    }

    const tfRes = await fetch(getProdApiUrl(`/api/admin/production/truck-factors?tanggal=${tanggal}`), {
      headers: { ...getProdAuthHeaders() }
    });
    const tfRows = await tfRes.json().catch(() => []);
    const truckFactors = {};
    (Array.isArray(tfRows) ? tfRows : []).forEach(r => { truckFactors[`${r.kategori}|${r.tipe_alat}|${r.material}`] = r.factor_value; });

    container.innerHTML = fleets.map(f => renderFleetRitaseCard(f, truckFactors)).join('');
    container.querySelectorAll('input[data-ritase-hour]').forEach(inp => inp.addEventListener('input', hitungTotalRitaseBaris));
  } catch (err) {
    container.innerHTML = `<p class="tabel__kosong" style="padding:24px;text-align:center;color:#dc2626;">Gagal memuat ritase: ${escapeMinePlanning(err.message)}</p>`;
  }
}

function slotJamShift(shift) {
  // Jendela operasional shift: slot [start, end) modulo 24.
  // Shift Siang 06:00-18:00 -> 06..17; Shift Malam 18:00-06:00 -> 18..23,00..05.
  const startH = shift?.operational_start ? Number(String(shift.operational_start).slice(0, 2)) : (shift?.lintas_hari ? 18 : 6);
  const endH = shift?.operational_end ? Number(String(shift.operational_end).slice(0, 2)) : (shift?.lintas_hari ? 6 : 18);
  const slots = [];
  let h = startH;
  while (h !== endH) {
    slots.push({ label: String(h).padStart(2, '0'), hour: h });
    h = (h + 1) % 24;
  }
  return slots;
}

function renderFleetRitaseCard(fleet, truckFactors) {
  const shift = (masterProdData.shifts || []).find(s => s.id === fleet.shift_id) || {};
  const slots = slotJamShift(shift);
  const excavatorKode = fleet.excavator_kode || '—';
  const kategori = fleet.material_type === 'Coal' ? 'Coal' : 'OB';
  const materialDetail = fleet.material_detail || '';
  const truckIds = (fleet.trucks || []).map(t => t.dump_truck_id).join(',');
  const materialBg = fleet.material_type === 'Coal' ? '#1e293b;color:#f8fafc' : '#fef3c7;color:#92400e';

  const truckFactorFor = (tipe) => {
    const key = `${kategori}|${tipe}|${materialDetail}`;
    const v = truckFactors[key];
    return (v === undefined || v === null || v === '') ? null : Number(v);
  };

  const headCols = slots.map(s => `<th style="min-width:52px;text-align:center;font-size:11px;">${s.label}</th>`).join('');
  const rows = (fleet.trucks || []).map(truck => {
    const tf = truckFactorFor(truck.tipe_alat);
    const hasTf = tf !== null;
    const totalRitase = truck.total_ritase || 0;
    const produksi = hasTf ? tf * totalRitase : null;
    const cells = slots.map(s => {
      const v = truck.hours && truck.hours[s.hour] != null ? truck.hours[s.hour] : '';
      return `<td style="text-align:center;"><input type="number" min="0" step="1" inputmode="numeric" style="width:52px;text-align:center;padding:4px;border:1px solid #cbd5e1;border-radius:6px;" data-ritase-hour data-truck="${truck.dump_truck_id}" data-hour="${s.hour}" value="${v}" /></td>`;
    }).join('');
    const tfBadge = hasTf
      ? `<span style="display:inline-block;margin-top:3px;padding:1px 6px;border-radius:4px;background:#e0f2fe;color:#075985;font-size:10px;font-weight:700;">TF ${tf} ${kategori === 'Coal' ? 'Ton/rit' : 'BCM/rit'}</span>`
      : `<span style="display:inline-block;margin-top:3px;padding:1px 6px;border-radius:4px;background:#fef2f2;color:#b91c1c;font-size:10px;font-weight:700;">⚠️ belum ada factor</span>`;
    return `<tr data-tf="${hasTf ? tf : ''}" data-tipe="${escapeMinePlanning(truck.tipe_alat || '')}">
      <td><strong style="color:#16a34a;">${escapeMinePlanning(truck.kode_alat)}</strong>${truck.tipe_alat ? `<br><small style="color:#94a3b8;">${escapeMinePlanning(truck.tipe_alat)}</small>` : ''}${tfBadge}</td>
      ${cells}
      <td style="text-align:center;font-weight:800;color:#0f172a;" data-total-ritase>${totalRitase}</td>
      <td style="text-align:center;font-weight:800;color:#0f766e;" data-total-produksi>${produksi != null ? produksi.toLocaleString('id-ID') : '—'}</td>
    </tr>`;
  }).join('');

  const fleetTotalRitase = fleet.total_ritase || 0;
  const fleetTotalProduksi = (fleet.trucks || []).reduce((sum, t) => {
    const tf = truckFactorFor(t.tipe_alat);
    return tf !== null ? sum + tf * (t.total_ritase || 0) : sum;
  }, 0);

  // Total per jam (ritase & productivity) dihitung saat render, agar angka
  // tetap tampil setelah reload/simpan — bukan hanya saat user mengetik.
  const hourTotals = {};
  (fleet.trucks || []).forEach(truck => {
    const tf = truckFactorFor(truck.tipe_alat);
    Object.keys(truck.hours || {}).forEach(h => {
      const c = Number(truck.hours[h]) || 0;
      if (!hourTotals[h]) hourTotals[h] = { ritase: 0, prod: 0 };
      hourTotals[h].ritase += c;
      if (tf !== null) hourTotals[h].prod += tf * c;
    });
  });

  return `
  <div data-fleet-card="${fleet.id}" data-shift-id="${fleet.shift_id}" data-excavator-id="${fleet.excavator_id}" data-material-type="${escapeMinePlanning(fleet.material_type || 'Overburden')}" data-material-detail="${escapeMinePlanning(materialDetail)}" data-truck-ids="${truckIds}"
       data-pit-area="${escapeMinePlanning(fleet.pit_area || '')}" data-job="${escapeMinePlanning(fleet.job_code || '')}" data-jarak="${fleet.jarak_km != null ? Number(fleet.jarak_km) : ''}"
       style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:18px;overflow:hidden;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;background:#f8fafc;border-bottom:1px solid #e2e8f0;flex-wrap:wrap;">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <strong style="font-size:15px;color:#0f172a;">🚚 ${escapeMinePlanning(excavatorKode)}</strong>
        <span style="background:#e0f2fe;color:#075985;border-radius:6px;padding:2px 8px;font-size:11px;font-weight:700;">Loader</span>
        <span style="background:#f1f5f9;color:#334155;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700;">📍 ${escapeMinePlanning(fleet.pit_area || '—')}</span>
        <span style="background:#f1f5f9;color:#334155;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700;">JOB: ${escapeMinePlanning(fleet.job_code || '—')}${fleet.job_desc ? ' · ' + escapeMinePlanning(fleet.job_desc) : ''}</span>
        <span style="background:${materialBg};border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700;">${escapeMinePlanning(materialDetail || fleet.material_type || 'Overburden')}</span>
        <span style="background:#f1f5f9;color:#334155;border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700;">📏 ${fleet.jarak_km != null ? Number(fleet.jarak_km) + ' km' : '—'}</span>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="tombol" onclick="muatFleetUntukEdit('${fleet.id}')">✏️ Edit Fleet</button>
        <button class="tombol tombol--utama" onclick="simpanRitaseFleet('${fleet.id}')">💾 Simpan Ritase</button>
      </div>
    </div>
    <div class="tabel-wrap" style="max-height:560px;overflow:auto;">
      <table class="tabel" style="min-width:900px;">
        <thead style="position:sticky;top:0;z-index:2;background:#f8fafc;">
          <tr>
            <th style="min-width:150px;">Dump Truck (Hauler)</th>
            ${headCols}
            <th style="min-width:90px;text-align:center;">Total Ritase</th>
            <th style="min-width:110px;text-align:center;">Total Produksi</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="' + (slots.length + 3) + '" class="tabel__kosong">Belum ada dump truck terikat pada fleet ini.</td></tr>'}</tbody>
        <tfoot>
          <tr style="background:#eef2f7;font-weight:800;">
            <td style="color:#0f172a;">TOTAL RIT/JAM</td>
            ${slots.map(s => { const t = hourTotals[s.hour] || {}; return `<td style="text-align:center;color:#334155;" data-fleet-hour-total="${s.hour}">${t.ritase || 0}</td>`; }).join('')}
            <td style="text-align:center;color:#2563eb;" data-fleet-total-ritase>${fleetTotalRitase}</td>
            <td style="text-align:center;color:#2563eb;" data-fleet-total-produksi>${fleetTotalProduksi ? fleetTotalProduksi.toLocaleString('id-ID') : '0'}</td>
          </tr>
          <tr style="background:#f0fdfa;font-weight:800;">
            <td style="color:#0f766e;">Productivity <span style="font-weight:600;font-size:10px;color:#64748b;">(${kategori === 'Coal' ? 'Ton' : 'BCM'})</span></td>
            ${slots.map(s => { const t = hourTotals[s.hour] || {}; const p = t.prod || 0; return `<td style="text-align:center;color:#0f766e;" data-fleet-hour-prod="${s.hour}">${p ? p.toLocaleString('id-ID') : '0'}</td>`; }).join('')}
            <td style="text-align:center;color:#94a3b8;">—</td>
            <td style="text-align:center;color:#0f766e;" data-fleet-total-produksi>${fleetTotalProduksi ? fleetTotalProduksi.toLocaleString('id-ID') : '0'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>`;
}

function hitungTotalRitaseBaris(e) {
  const inp = e.target;
  const card = inp.closest('[data-fleet-card]');
  if (!card) return;

  // 1) total baris DT (ritase + produksi = truck factor × ritase)
  const row = inp.closest('tr');
  if (row) {
    let rowRitase = 0;
    row.querySelectorAll('input[data-ritase-hour]').forEach(i => { rowRitase += Math.max(0, Number(i.value) || 0); });
    const tc = row.querySelector('[data-total-ritase]');
    if (tc) tc.textContent = rowRitase;
    const hasTf = row.dataset.tf !== undefined && row.dataset.tf !== '';
    const tf = hasTf ? (Number(row.dataset.tf) || 0) : 0;
    const pc = row.querySelector('[data-total-produksi]');
    if (pc) pc.textContent = hasTf ? (tf * rowRitase).toLocaleString('id-ID') : '—';
  }

  // 2) footer per jam (ritase + productivity) + total fleet
  const hours = new Set();
  card.querySelectorAll('input[data-ritase-hour]').forEach(i => hours.add(i.dataset.hour));
  let fleetRitase = 0;
  let fleetProduksi = 0;
  hours.forEach(h => {
    let r = 0, p = 0;
    card.querySelectorAll('tbody tr[data-tf]').forEach(tr => {
      const hi = tr.querySelector(`input[data-ritase-hour][data-hour="${h}"]`);
      if (!hi) return;
      const c = Math.max(0, Number(hi.value) || 0);
      r += c;
      if (tr.dataset.tf !== '') p += (Number(tr.dataset.tf) || 0) * c;
    });
    const rCell = card.querySelector(`[data-fleet-hour-total="${h}"]`);
    if (rCell) rCell.textContent = r;
    const pCell = card.querySelector(`[data-fleet-hour-prod="${h}"]`);
    if (pCell) pCell.textContent = p ? p.toLocaleString('id-ID') : '0';
    fleetRitase += r;
    fleetProduksi += p;
  });
  const ft = card.querySelector('[data-fleet-total-ritase]');
  if (ft) ft.textContent = fleetRitase;
  card.querySelectorAll('[data-fleet-total-produksi]').forEach(c => { c.textContent = fleetProduksi ? fleetProduksi.toLocaleString('id-ID') : '0'; });
}

function ritasePitAreaOptions(selected) {
  const areas = Array.isArray(masterProdData.pitAreas) && masterProdData.pitAreas.length
    ? masterProdData.pitAreas
    : [...new Set((masterProdData.equipment || []).map(u => String(u.lokasi || '').trim()).filter(Boolean))];
  return '<option value="">Pilih PIT / Area</option>' + areas.map(a => `<option value="${escapeMinePlanning(a)}"${a === selected ? ' selected' : ''}>${escapeMinePlanning(a)}</option>`).join('');
}

async function bukaModalInputFleet(fleet) {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;

  if (!(masterProdData.equipment || []).length) await muatMasterDataProduksi();

  const excOptions = (masterProdData.equipment || []).filter(e => e.kelas_alat === 'Excavator').map(e =>
    `<option value="${e.id}"${fleet && fleet.excavator_id === e.id ? ' selected' : ''}>${escapeMinePlanning(e.kode_alat)} (${escapeMinePlanning(e.tipe_alat || '')})</option>`).join('');
  const dtOptions = (masterProdData.equipment || []).filter(e => e.kelas_alat === 'Dump Truck').map(e => {
    const checked = fleet && (fleet.trucks || []).some(t => t.dump_truck_id === e.id) ? ' checked' : '';
    return `<label style="display:block;margin-bottom:4px;"><input type="checkbox" name="chkFleetDt" value="${e.id}"${checked}> ${escapeMinePlanning(e.kode_alat)} - ${escapeMinePlanning(e.tipe_alat || '')}</label>`;
  }).join('');
  const shiftOptions = (masterProdData.shifts || []).map(s =>
    `<option value="${s.id}"${fleet && fleet.shift_id === s.id ? ' selected' : ''}>${escapeMinePlanning(s.nama_shift)}</option>`).join('');
  const jobOptions = '<option value="">Pilih JOB</option>' + (masterProdData.jobCodes || []).map(j =>
    `<option value="${escapeMinePlanning(j.job_code)}"${fleet && fleet.job_code === j.job_code ? ' selected' : ''}>${escapeMinePlanning(j.job_code)} - ${escapeMinePlanning(j.job_desc)}</option>`).join('');
  const tfMat = await muatTruckFactorMaterials();
  const obMatOptions = (tfMat.OB || []).map(m => `<option value="${escapeMinePlanning(m)}" data-kat="OB"${fleet && fleet.material_detail === m ? ' selected' : ''}>${escapeMinePlanning(m)}</option>`).join('');
  const coalMatOptions = (tfMat.Coal || []).map(m => `<option value="${escapeMinePlanning(m)}" data-kat="Coal"${fleet && fleet.material_detail === m ? ' selected' : ''}>${escapeMinePlanning(m)}</option>`).join('');
  const materialOptions = `
    <option value="">Pilih Material</option>
    <optgroup label="Overburden (OB)">${obMatOptions || '<option value="" disabled>Belum ada material</option>'}</optgroup>
    <optgroup label="Coal">${coalMatOptions || '<option value="" disabled>Belum ada material</option>'}</optgroup>`;

  const tanggal = fleet ? (fleet.tanggal ? String(fleet.tanggal).split('T')[0] : '') : (document.getElementById('filterTanggalRitase')?.value || new Date().toISOString().split('T')[0]);

  konten.innerHTML = `
    <h3 style="margin-top:0;color:#0f172a;">${fleet ? '✏️ Edit Fleet' : '🚚 Tambah Fleet Baru'}</h3>
    <form id="formInputFleet">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Tanggal</label>
          <input type="date" id="ffTanggal" class="input-filter" value="${tanggal}" required />
        </div>
        <div>
          <label class="label">Shift</label>
          <select id="ffShift" class="input-filter" required>${shiftOptions}</select>
        </div>
      </div>
      <div style="margin-bottom:10px;">
        <label class="label">Excavator (Loader) — nama fleet otomatis mengikuti kode unit</label>
        <select id="ffExcavator" class="input-filter" required>${excOptions}</select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">PIT / Area</label>
          <select id="ffPitArea" class="input-filter">${ritasePitAreaOptions(fleet ? fleet.pit_area : '')}</select>
        </div>
        <div>
          <label class="label">JOB</label>
          <select id="ffJob" class="input-filter">${jobOptions}</select>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
        <div>
          <label class="label">Material (granular)</label>
          <select id="ffMaterial" class="input-filter">${materialOptions}</select>
        </div>
        <div>
          <label class="label">Jarak (km)</label>
          <input type="number" step="0.01" min="0" id="ffJarak" class="input-filter" placeholder="Misal: 2.5" value="${fleet && fleet.jarak_km != null ? fleet.jarak_km : ''}" />
        </div>
      </div>
      <div style="margin-bottom:14px;">
        <label class="label">Dump Truck Terikat (Hauling Fleet)</label>
        <div style="max-height:140px;overflow-y:auto;border:1px solid #cbd5e1;padding:8px;border-radius:6px;background:#f8fafc;">
          ${dtOptions || '<span style="color:#64748b;">Belum ada unit Dump Truck pada List Equipment.</span>'}
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="tombol" onclick="tutupModalGenerik()">Batal</button>
        <button type="submit" class="tombol tombol--utama">${fleet ? 'Simpan Perubahan Fleet' : 'Simpan Fleet'}</button>
      </div>
    </form>
  `;
  overlay.hidden = false;

  document.getElementById('formInputFleet').addEventListener('submit', async (e) => {
    e.preventDefault();
    const checkedDts = Array.from(document.querySelectorAll('input[name="chkFleetDt"]:checked')).map(c => c.value);
    if (!checkedDts.length) return alert('Pilih minimal satu Dump Truck untuk fleet ini.');
    const materialSel = document.getElementById('ffMaterial');
    if (!materialSel.value) return alert('Pilih Material (granular) terlebih dahulu.');
    const bodyData = {
      tanggal: document.getElementById('ffTanggal').value,
      shift_id: document.getElementById('ffShift').value,
      excavator_id: document.getElementById('ffExcavator').value,
      pit_area: document.getElementById('ffPitArea').value,
      job_code: document.getElementById('ffJob').value,
      material_type: materialSel.selectedOptions[0]?.dataset.kat === 'Coal' ? 'Coal' : 'Overburden',
      material_detail: materialSel.value,
      jarak_km: document.getElementById('ffJarak').value,
      dump_truck_ids: checkedDts
    };

    try {
      const res = await fetch(getProdApiUrl('/api/admin/production/fleet-mappings'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
        body: JSON.stringify(bodyData)
      });
      if (!res.ok) throw new Error((await res.json()).error || 'HTTP ' + res.status);
      tutupModalGenerik();
      await muatProdRitase();
    } catch (err) {
      alert('Gagal menyimpan fleet: ' + err.message);
    }
  });
}

function muatFleetUntukEdit(fleetId) {
  const card = document.querySelector(`[data-fleet-card="${fleetId}"]`);
  if (!card) return;
  const fleet = {
    id: fleetId,
    tanggal: document.getElementById('filterTanggalRitase')?.value || '',
    shift_id: card.dataset.shiftId,
    excavator_id: card.dataset.excavatorId,
    material_type: card.dataset.materialType,
    material_detail: card.dataset.materialDetail,
    pit_area: card.dataset.pitArea || '',
    job_code: card.dataset.job || '',
    jarak_km: card.dataset.jarak === '' ? null : Number(card.dataset.jarak),
    trucks: (card.dataset.truckIds || '').split(',').filter(Boolean).map(id => ({ dump_truck_id: id }))
  };
  bukaModalInputFleet(fleet);
}

async function simpanRitaseFleet(fleetId) {
  const card = document.querySelector(`[data-fleet-card="${fleetId}"]`);
  if (!card) return;

  const tanggal = document.getElementById('filterTanggalRitase')?.value || '';
  if (!tanggal) return alert('Pilih tanggal terlebih dahulu.');
  const shiftId = card.dataset.shiftId;
  const excavatorId = card.dataset.excavatorId;
  const material = card.dataset.materialType || 'Overburden';

  const rows = [];
  card.querySelectorAll('input[data-ritase-hour]').forEach(inp => {
    rows.push({
      dump_truck_id: inp.dataset.truck,
      period_hour: Number(inp.dataset.hour),
      ritase_count: Math.max(0, Math.floor(Number(inp.value) || 0))
    });
  });
  if (!rows.length) return alert('Tidak ada baris dump truck pada fleet ini.');

  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/ritase/hours'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
      body: JSON.stringify({ tanggal, shift_id: shiftId, fleet_mapping_id: fleetId, excavator_id: excavatorId, material, rows })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    alert(`Ritase fleet berhasil disimpan (${data.saved || rows.length} baris).`);
    muatProdRitase();
  } catch (err) {
    alert('Gagal menyimpan ritase fleet: ' + err.message);
  }
}

// -------------------------------------------------------------
// 5b. TRUCK FACTOR SETUP (acuan payload ritase -> produksi)
// -------------------------------------------------------------
function dumpTruckTipeAlatList() {
  return [...new Set((masterProdData.equipment || [])
    .filter(e => e.kelas_alat === 'Dump Truck')
    .map(e => String(e.tipe_alat || '').trim())
    .filter(Boolean))].sort();
}

let truckFactorMaterialsCache = null;
async function muatTruckFactorMaterials() {
  if (truckFactorMaterialsCache) return truckFactorMaterialsCache;
  const [obRes, coalRes] = await Promise.all([
    fetch(getProdApiUrl('/api/admin/production/productivity-plans/ob'), { headers: { ...getProdAuthHeaders() } }),
    fetch(getProdApiUrl('/api/admin/production/productivity-plans/coal'), { headers: { ...getProdAuthHeaders() } })
  ]);
  const obPlan = await obRes.json().catch(() => ({}));
  const coalPlan = await coalRes.json().catch(() => ({}));
  truckFactorMaterialsCache = {
    OB: ekstrakMaterialPlan(obPlan.contentHtml),
    Coal: ekstrakMaterialPlan(coalPlan.contentHtml)
  };
  return truckFactorMaterialsCache;
}

function ekstrakMaterialPlan(contentHtml) {
  if (!contentHtml) return [];
  const doc = new DOMParser().parseFromString(`<div>${contentHtml}</div>`, 'text/html');
  const set = new Set();
  doc.querySelectorAll('input[data-plan-factor-field="material"]').forEach(i => {
    const v = String(i.value || '').trim();
    if (v) set.add(v.toUpperCase());
  });
  doc.querySelectorAll('select[data-plan-productivity-field="material"]').forEach(s => {
    const v = String(s.value || '').trim();
    if (v) set.add(v.toUpperCase());
  });
  return [...set].sort();
}

function renderTruckFactorMatriks(kategori, judul, materials, dtTypes, savedMap) {
  const headerCols = materials.map(m => `<th>${escapeMinePlanning(m)}</th>`).join('');
  const rows = dtTypes.map(tipe => {
    const cells = materials.map(m => {
      const key = `${kategori}|${tipe}|${m}`;
      const v = savedMap[key] != null ? savedMap[key] : '';
      return `<td><input type="number" step="any" data-tf-kat="${kategori}" data-tf-tipe="${escapeMinePlanning(tipe)}" data-tf-mat="${escapeMinePlanning(m)}" value="${v}" placeholder="0" /></td>`;
    }).join('');
    return `<tr><td>${escapeMinePlanning(tipe)}</td>${cells}</tr>`;
  }).join('');

  const empty = !dtTypes.length
    ? 'Belum ada unit Dump Truck pada List Equipment.'
    : (!materials.length ? 'Belum ada material pada setup Productivity Planning terkait.' : '');

  return `
    <div style="margin-bottom:18px;">
      <div style="font-size:15px;font-weight:800;color:#0f172a;margin-bottom:8px;">${escapeMinePlanning(judul)} <span style="font-size:11px;color:#64748b;font-weight:600;">(${kategori === 'OB' ? 'BCM per ritase' : 'Ton per ritase'})</span></div>
      <div class="tf-table-wrap">
        <table class="tf-table">
          <thead><tr><th style="text-align:left;">TIPE MODEL</th>${headerCols}</tr></thead>
          <tbody>${rows || `<tr><td colspan="${(materials.length || 1) + 1}" style="color:#64748b;text-align:center;padding:16px;">${escapeMinePlanning(empty || 'Tidak ada data.')}</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

async function bukaModalTruckFactor() {
  const overlay = document.getElementById('modalOverlay');
  const konten = document.getElementById('modalKonten');
  if (!overlay || !konten) return;

  const tanggalInput = document.getElementById('filterTanggalRitase');
  if (tanggalInput && !tanggalInput.value) tanggalInput.value = new Date().toISOString().split('T')[0];
  const tanggal = tanggalInput?.value || '';

  konten.innerHTML = '<div class="truck-factor-modal"><h3 style="margin:0;color:#0f172a;">⚖️ Truck Factor Setup</h3><p style="color:#64748b;font-size:13px;">Memuat data truck factor…</p></div>';
  overlay.hidden = false;

  if (!(masterProdData.equipment || []).length) await muatMasterDataProduksi();
  const dtTypes = dumpTruckTipeAlatList();

  try {
    const [obRes, coalRes, facRes, prevRes] = await Promise.all([
      fetch(getProdApiUrl('/api/admin/production/productivity-plans/ob'), { headers: { ...getProdAuthHeaders() } }),
      fetch(getProdApiUrl('/api/admin/production/productivity-plans/coal'), { headers: { ...getProdAuthHeaders() } }),
      fetch(getProdApiUrl(`/api/admin/production/truck-factors?tanggal=${tanggal}`), { headers: { ...getProdAuthHeaders() } }),
      fetch(getProdApiUrl(`/api/admin/production/truck-factors/previous?tanggal=${tanggal}`), { headers: { ...getProdAuthHeaders() } })
    ]);
    const obPlan = await obRes.json().catch(() => ({}));
    const coalPlan = await coalRes.json().catch(() => ({}));
    const saved = await facRes.json().catch(() => []);
    const prev = await prevRes.json().catch(() => ({ tanggal: null, rows: [] }));

    const obMaterials = ekstrakMaterialPlan(obPlan.contentHtml);
    const coalMaterials = ekstrakMaterialPlan(coalPlan.contentHtml);

    const keyOf = r => `${r.kategori}|${r.tipe_alat}|${r.material}`;
    const currentMap = {};
    (Array.isArray(saved) ? saved : []).forEach(r => { currentMap[keyOf(r)] = r.factor_value; });
    const prevMap = {};
    (Array.isArray(prev.rows) ? prev.rows : []).forEach(r => { prevMap[keyOf(r)] = r.factor_value; });
    // Carry-over: nilai periode sebelumnya menjadi default bila periode ini kosong.
    const effectiveMap = {};
    Object.keys(prevMap).forEach(k => { effectiveMap[k] = prevMap[k]; });
    Object.keys(currentMap).forEach(k => { effectiveMap[k] = currentMap[k]; });

    const hasCurrent = (Array.isArray(saved) ? saved : []).length > 0;
    const carryNote = (!hasCurrent && prev.tanggal)
      ? `<div style="margin:0 0 14px;padding:10px 12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;color:#92400e;font-size:12px;">📋 Periode ini belum punya data — nilai ditampilkan mengikuti periode sebelumnya (<strong>${escapeMinePlanning(String(prev.tanggal).split('T')[0])}</strong>). Klik "💾 Simpan" untuk menjadikannya data periode ini.</div>`
      : '';

    konten.innerHTML = `
      <div class="truck-factor-modal">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
          <div>
            <h3 style="margin:0;color:#0f172a;">⚖️ Truck Factor Setup</h3>
            <p style="margin:4px 0 0;color:#64748b;font-size:12px;">Acuan kalkulasi ritase dump truck → hasil produksi. Periode: <strong>${escapeMinePlanning(tanggal)}</strong>. Nilai = payload per ritase (OB: BCM/rit, Coal: Ton/rit).</p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="tombol" onclick="copyTruckFactor()">📋 Copy</button>
            <button class="tombol" onclick="pasteTruckFactor()">📥 Paste</button>
            <button class="tombol" onclick="tutupModalGenerik()">Tutup</button>
            <button class="tombol tombol--utama" onclick="simpanTruckFactorSetup()">💾 Simpan Truck Factor</button>
          </div>
        </div>
        ${carryNote}
        ${renderTruckFactorMatriks('OB', 'Tabel OB', obMaterials, dtTypes, effectiveMap)}
        ${renderTruckFactorMatriks('Coal', 'Tabel Coal', coalMaterials, dtTypes, effectiveMap)}
      </div>
    `;
  } catch (err) {
    konten.innerHTML = `<div class="truck-factor-modal"><h3 style="margin:0;color:#0f172a;">⚖️ Truck Factor Setup</h3><p style="color:#dc2626;margin-top:10px;">Gagal memuat data: ${escapeMinePlanning(err.message)}</p></div>`;
  }
}

async function simpanTruckFactorSetup() {
  const tanggal = document.getElementById('filterTanggalRitase')?.value || '';
  if (!tanggal) return alert('Periode (tanggal) belum ditentukan.');

  const entries = [];
  document.querySelectorAll('.truck-factor-modal input[data-tf-kat]').forEach(inp => {
    entries.push({
      kategori: inp.dataset.tfKat,
      tipe_alat: inp.dataset.tfTipe,
      material: inp.dataset.tfMat,
      factor_value: inp.value
    });
  });
  if (!entries.length) return alert('Tidak ada baris truck factor untuk disimpan.');

  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/truck-factors'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getProdAuthHeaders() },
      body: JSON.stringify({ tanggal, entries })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    alert(`Truck factor tersimpan (${data.saved} nilai disimpan, ${data.removed} dikosongkan).`);
    tutupModalGenerik();
  } catch (err) {
    alert('Gagal menyimpan truck factor: ' + err.message);
  }
}

// -------------------------------------------------------------
// 5b. TRUCK FACTOR COPY / PASTE
// -------------------------------------------------------------
let truckFactorClipboard = null;

function copyTruckFactor() {
  const entries = [];
  document.querySelectorAll('.truck-factor-modal input[data-tf-kat]').forEach(inp => {
    entries.push({ kategori: inp.dataset.tfKat, tipe_alat: inp.dataset.tfTipe, material: inp.dataset.tfMat, factor_value: inp.value });
  });
  if (!entries.length) return alert('Tidak ada data untuk disalin.');
  const filled = entries.filter(e => String(e.factor_value).trim() !== '').length;
  const payload = { tanggal: document.getElementById('filterTanggalRitase')?.value || '', entries };
  truckFactorClipboard = payload;
  try { localStorage.setItem('truckFactorClipboard', JSON.stringify(payload)); } catch (e) { /* abaikan */ }
  alert(`📋 Truck factor disalin (${filled} dari ${entries.length} sel terisi).`);
}

function pasteTruckFactor() {
  let payload = truckFactorClipboard;
  if (!payload) {
    try { payload = JSON.parse(localStorage.getItem('truckFactorClipboard') || 'null'); } catch (e) { payload = null; }
  }
  if (!payload || !Array.isArray(payload.entries) || !payload.entries.length) {
    return alert('Belum ada data yang disalin. Buka sesi sumber → klik "📋 Copy", lalu buka sesi tujuan → klik "📥 Paste".');
  }
  const map = {};
  payload.entries.forEach(e => { map[`${e.kategori}|${e.tipe_alat}|${e.material}`] = e.factor_value; });
  let applied = 0;
  document.querySelectorAll('.truck-factor-modal input[data-tf-kat]').forEach(inp => {
    const key = `${inp.dataset.tfKat}|${inp.dataset.tfTipe}|${inp.dataset.tfMat}`;
    if (map[key] !== undefined) { inp.value = map[key] ?? ''; applied++; }
  });
  if (!applied) return alert('Tidak ada sel yang cocok untuk ditempel (tipe model / material berbeda).');
  alert(`📥 Data ditempel ke ${applied} sel. Klik "💾 Simpan Truck Factor" untuk menyimpannya.`);
}

// -------------------------------------------------------------
// 6. DAILY DASHBOARD
// -------------------------------------------------------------
async function muatDailyDashboard() {
  try {
    const tgl = document.getElementById('filterDateDailyDash')?.value || new Date().toISOString().split('T')[0];
    const res = await fetch(getProdApiUrl(`/api/admin/production/daily-dashboard?tanggal=${tgl}`), {
      headers: { ...getProdAuthHeaders() }
    });
    const data = await res.json();
    const kpi = data.kpi || {};

    document.getElementById('dashCoalActual').textContent = `${(kpi.coal?.actual || 0).toLocaleString('id-ID')} MT`;
    document.getElementById('dashCoalAchieve').textContent = `Target: ${kpi.coal?.target || 0} MT (${kpi.coal?.achievement || 0}%)`;
    document.getElementById('dashObActual').textContent = `${(kpi.ob?.actual || 0).toLocaleString('id-ID')} BCM`;
    document.getElementById('dashObAchieve').textContent = `Target: ${kpi.ob?.target || 0} BCM (${kpi.ob?.achievement || 0}%)`;
    document.getElementById('dashTotalFuel').textContent = `${(kpi.fuel || 0).toLocaleString('id-ID')} L`;
    document.getElementById('dashAvgCycle').textContent = `${kpi.avgCycleTime || 0} Menit`;
    document.getElementById('dashWeather').textContent = kpi.weather || 'Cerah (29°C)';

    renderChartHourlyProd(data.hourlyChart || []);
  } catch (err) {
    console.warn('[Daily Dash Error]', err.message);
  }
}

function renderChartHourlyProd(chartData) {
  const ctx = document.getElementById('chartHourlyProd');
  if (!ctx) return;
  if (chartHourlyProdObj) chartHourlyProdObj.destroy();

  chartHourlyProdObj = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartData.map(c => c.jam),
      datasets: [
        { label: 'Coal (MT)', data: chartData.map(c => c.coal), borderColor: '#0284c7', backgroundColor: 'rgba(2,132,199,0.1)', fill: true },
        { label: 'Overburden (BCM)', data: chartData.map(c => c.ob), borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.1)', fill: true }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// -------------------------------------------------------------
// 7. SHIFT REPORT
// -------------------------------------------------------------
async function muatShiftReport() {
  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/shift-report'), {
      headers: { ...getProdAuthHeaders() }
    });
    const data = await res.json();

    document.getElementById('srTanggal').textContent = data.tanggal || new Date().toISOString().split('T')[0];
    const detailBox = document.getElementById('srKontenDetail');
    if (!detailBox) return;

    detailBox.innerHTML = `
      <div style="margin-bottom:14px;">
        <h4 style="margin:0 0 6px 0;color:#0f172a;">1. RINGKASAN PRODUKSI SHIFT</h4>
        <ul style="margin:0;padding-left:18px;">
          ${(data.production || []).map(p => `<li><strong>${p.material}:</strong> ${p.total_vol} (${p.total_rit} Ritase)</li>`).join('') || '<li>Produksi Shift Berjalan 100% Sesuai Jadwal</li>'}
        </ul>
      </div>
      <div style="margin-bottom:14px;">
        <h4 style="margin:0 0 6px 0;color:#0f172a;">2. CATATAN KENDALA STANDBY</h4>
        <ul style="margin:0;padding-left:18px;">
          ${(data.standby || []).map(s => `<li><strong>${s.kategori}:</strong> ${s.hours} Jam total delay</li>`).join('') || '<li>Tidak ada kendala standby signifikan.</li>'}
        </ul>
      </div>
      <div style="margin-bottom:14px;">
        <h4 style="margin:0 0 6px 0;color:#0f172a;">3. CATATAN PENGAWAS (SUPERVISOR NOTE)</h4>
        <p style="margin:0;background:#f8fafc;padding:10px;border-radius:6px;border-left:4px solid #0284c7;">${data.supervisorNote}</p>
      </div>
    `;
  } catch (err) {
    console.warn('[Shift Report Error]', err.message);
  }
}

function cetakPdfShiftReport() {
  const element = document.getElementById('areaCetakShiftReport');
  if (!element) return;
  const opt = {
    margin:       0.5,
    filename:     `Shift_Report_${new Date().toISOString().split('T')[0]}.pdf`,
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2 },
    jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
  };
  html2pdf().set(opt).from(element).save();
}

// -------------------------------------------------------------
// 8. PRODUCTIVITY REPORT
// -------------------------------------------------------------
async function muatProductivityReport() {
  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/productivity-report'), {
      headers: { ...getProdAuthHeaders() }
    });
    const data = await res.json();

    const excBox = document.getElementById('listTopExcavators');
    const dtBox = document.getElementById('listTopDumpTrucks');

    if (excBox) {
      excBox.innerHTML = (data.topExcavators || []).map((e, idx) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
          <div><strong>#${idx+1} ${e.kode_alat}</strong> <span style="color:#64748b;">(${e.tipe_alat})</span></div>
          <div><strong style="color:#16a34a;">${e.total_prod} BCM/MT</strong></div>
        </div>
      `).join('') || '<p style="color:#64748b;">Belum ada data produksi Excavator.</p>';
    }

    if (dtBox) {
      dtBox.innerHTML = (data.topDumpTrucks || []).map((d, idx) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;">
          <div><strong>#${idx+1} ${d.kode_alat}</strong> <span style="color:#64748b;">(${d.tipe_alat})</span></div>
          <div><strong style="color:#0284c7;">${d.total_prod} BCM/MT</strong></div>
        </div>
      `).join('') || '<p style="color:#64748b;">Belum ada data produksi Dump Truck.</p>';
    }
  } catch (err) {
    console.warn('[Prod Report Error]', err.message);
  }
}

// -------------------------------------------------------------
// 9. MTD & 10. YTD & 11. PTD REPORTS
// -------------------------------------------------------------
async function muatMtdReport() {
  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/mtd-report'), {
      headers: { ...getProdAuthHeaders() }
    });
    const data = await res.json();
    const ctx = document.getElementById('chartMtdTrend');
    if (!ctx) return;
    if (chartMtdObj) chartMtdObj.destroy();

    const trend = data.dailyTrend || [];
    chartMtdObj = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: trend.map(t => t.tanggal ? t.tanggal.split('T')[0] : 'Day'),
        datasets: [
          { label: 'Coal (MT)', data: trend.map(t => t.coal), backgroundColor: '#0284c7' },
          { label: 'Overburden (BCM)', data: trend.map(t => t.ob), backgroundColor: '#16a34a' }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  } catch (err) {
    console.warn('[MTD Error]', err.message);
  }
}

async function muatYtdReport() {
  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/ytd-report'), {
      headers: { ...getProdAuthHeaders() }
    });
    const data = await res.json();
    const ctx = document.getElementById('chartYtdMonthly');
    if (!ctx) return;
    if (chartYtdObj) chartYtdObj.destroy();

    chartYtdObj = new Chart(ctx, {
      type: 'line',
      data: {
        labels: Array.isArray(data) && data.length ? data.map(d => d.bulan) : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
        datasets: [
          { label: 'Coal YTD (MT)', data: Array.isArray(data) && data.length ? data.map(d => d.coal) : [45000, 52000, 48000, 61000, 59000, 64000, 67000, 65000], borderColor: '#0284c7' },
          { label: 'OB YTD (BCM)', data: Array.isArray(data) && data.length ? data.map(d => d.ob) : [180000, 210000, 195000, 240000, 230000, 255000, 260000, 250000], borderColor: '#16a34a' }
        ]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  } catch (err) {
    console.warn('[YTD Error]', err.message);
  }
}

async function muatProjectToDate() {
  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/project-to-date'), {
      headers: { ...getProdAuthHeaders() }
    });
    const data = await res.json();

    document.getElementById('ptdCoal').textContent = `${(data.totalCoalMt || 0).toLocaleString('id-ID')} MT`;
    document.getElementById('ptdOb').textContent = `${(data.totalObBcm || 0).toLocaleString('id-ID')} BCM`;
    document.getElementById('ptdFuel').textContent = `${(data.totalFuelLiter || 0).toLocaleString('id-ID')} Liter`;
  } catch (err) {
    console.warn('[PTD Error]', err.message);
  }
}

// -------------------------------------------------------------
// 12. EXECUTIVE DASHBOARD & AI ENGINE
// -------------------------------------------------------------
async function muatExecutiveDashboard() {
  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/executive-dashboard'), {
      headers: { ...getProdAuthHeaders() }
    });
    const data = await res.json();

    document.getElementById('execCoal').textContent = `${(data.todayCoal || 0).toLocaleString('id-ID')} MT`;
    document.getElementById('execOb').textContent = `${(data.todayOb || 0).toLocaleString('id-ID')} BCM`;
    document.getElementById('execCost').textContent = `Rp ${data.dailyCostEstimateRp || '142.500.000'}`;

    const aiBox = document.getElementById('aiSummaryBox');
    if (aiBox && data.aiInsights) {
      aiBox.innerHTML = `
        <p style="margin:0 0 8px 0;font-weight:bold;color:#a5b4fc;">${data.aiInsights.executiveSummary}</p>
        <div style="margin-top:10px;font-size:13px;">
          <strong>💡 AI Recommendations:</strong>
          <ul style="margin:4px 0 0 0;padding-left:18px;">
            ${(data.aiInsights.recommendations || []).map(r => `<li>${r}</li>`).join('')}
          </ul>
        </div>
      `;
    }
  } catch (err) {
    console.warn('[Exec Dash Error]', err.message);
  }
}

async function jalankanAiEngineAlert() {
  try {
    const res = await fetch(getProdApiUrl('/api/admin/production/ai-insights'), {
      headers: { ...getProdAuthHeaders() }
    });
    const data = await res.json();
    alert(`🤖 AI OPERATIONAL INTELLIGENCE REPORT\n\n${data.executiveSummary}\n\nRekomendasi Utama:\n- ${data.recommendations.join('\n- ')}`);
  } catch (err) {
    alert('AI Engine sedang menganalisis telemetry.');
  }
}

// Helper Tutup Modal
function tutupModalGenerik() {
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.hidden = true;
}
