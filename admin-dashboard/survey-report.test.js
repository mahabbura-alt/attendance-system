'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const core = require('./surveyReport.js');
const source = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
const reportSource = fs.readFileSync(path.join(__dirname, 'surveyReport.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const loader = fs.readFileSync(path.join(__dirname, 'production.loader.js'), 'utf8');

test('halaman Survey Report terdaftar dengan slicer bulan/tahun', () => {
  assert.match(html, /data-tab="prodSurveyReport"/);
  assert.match(html, /10\. 🧭 Survey Report/);
  assert.match(html, /id="surveyReportRoot"/);
  assert.match(source, /case 'prodSurveyReport': return muatSurveyReport\(\);/);
  assert.match(source, /window\.SurveyReport && typeof window\.SurveyReport\.open/);
  assert.match(loader, /surveyReport\.js\?v=8/);
  assert.doesNotMatch(reportSource, /Semua PIT/);
  assert.match(reportSource, /activePit: null/);
});

test('logika murni: tanggal, kunci, format, total', () => {
  assert.equal(core.daysInMonth(2026, 9), 30);
  assert.equal(core.daysInMonth(2026, 2), 28);
  assert.equal(core.cellKey('2026-09-05', 'BEI', 'ob', 'CLAY'), '2026-09-05||BEI||ob||CLAY');
  assert.equal(core.fmtVol(1200.5), '1.200,5');
  assert.equal(core.numCell(''), 0);
  assert.equal(core.numCell('-3'), 0);
  assert.equal(core.numCell('12.5'), 12.5);
  assert.equal(core.sumRow([10, 20, null]), 30);
  assert.equal(core.sectionUnit('coal'), 'Ton');
  assert.equal(core.sectionUnit('ob'), 'BCM');
});

test('anomali: >2x median kolom ditandai', () => {
  assert.equal(core.median([10, 20, 30]), 20);
  assert.equal(core.median([10, 20]), 15);
  assert.equal(core.median([]), 0);
  assert.equal(core.isAnomaly(45, 20), true);
  assert.equal(core.isAnomaly(40, 20), false, 'tepat 2x bukan anomali');
  assert.equal(core.isAnomaly(100, 0), false, 'median nol tidak menandai');
});

test('paste TSV dan nama file export', () => {
  const grid = core.parseTsvPaste('10\t20\n30\t40\r\n');
  assert.deepEqual(grid, [['10', '20'], ['30', '40']]);
  assert.equal(core.buildExportName(2026, 9, 'csv'), 'survey-volumes-2026-09.csv');
  assert.equal(core.buildExportName(2026, 9, 'xlsx'), 'survey-volumes-2026-09.xlsx');
});

test('escape aman untuk nama PIT/material', () => {
  assert.equal(core.esc('<BEI>'), '&lt;BEI&gt;');
  assert.equal(core.esc(null), '');
});

test('urutan kolom tbody, tfoot, dan colgroup sejajar 1:1 dengan header (SEAM 4L bisa diinput & tidak tertimpa Total OB/CLAY)', async () => {
  const elements = new Map();
  const makeEl = (id = '') => ({
    id,
    innerHTML: '',
    value: '',
    disabled: false,
    textContent: '',
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {},
    querySelectorAll() { return []; },
    insertAdjacentHTML(_pos, htmlStr) { this.innerHTML += htmlStr; },
    remove() {},
  });
  const root = makeEl('surveyReportRoot');
  const shell = makeEl('svShell');
  const tables = makeEl('svTables');
  const kpis = makeEl('svKpis');
  elements.set('surveyReportRoot', root);
  elements.set('svShell', shell);
  elements.set('svTables', tables);
  elements.set('svKpis', kpis);

  const prevDoc = globalThis.document;
  const prevFetch = globalThis.fetch;
  const prevApiUrl = globalThis.getProdApiUrl;
  const prevAuth = globalThis.getProdAuthHeaders;

  globalThis.document = {
    getElementById: id => elements.get(id) || null,
    querySelectorAll: () => [],
  };
  globalThis.getProdApiUrl = p => p;
  globalThis.getProdAuthHeaders = () => ({});
  globalThis.fetch = async url => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes('/comparison')
      ? { rows: [] }
      : {
          year: 2026,
          month: 9,
          materials: {
            ob: ['PASIR', 'CLAY', 'SUB SOIL', 'TOP SOIL'],
            coal: ['SEAM 1', 'SEAM 2', 'SEAM 3', 'SEAM 4U', 'SEAM 4L'],
          },
          pits: ['BEI'],
          jobs: [
            { jobCode: 'OB', materialType: 'ob', productionMode: 'prod' },
            { jobCode: 'CG', materialType: 'coal', productionMode: 'prod' },
          ],
          volumes: [
            { tanggal: '2026-09-01', pit_area: 'BEI', planning_type: 'ob', material: 'CLAY', volume: 500 },
          ],
        }),
  });

  try {
    await globalThis.SurveyReport.open();
    const htmlStr = tables.innerHTML;

    // Ekstrak urutan header baris kedua (setelah Tanggal rowspan=2)
    const theadRow2Match = htmlStr.match(/<thead><tr>[\s\S]*?<\/tr>\s*<tr>([\s\S]*?)<\/tr><\/thead>/);
    assert.ok(theadRow2Match, 'thead baris ke-2 harus ada');
    const headers = [...theadRow2Match[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => m[1]);
    assert.deepEqual(headers, [
      'PASIR', 'CLAY', 'SUB SOIL', 'TOP SOIL', 'Total',
      'SEAM 1', 'SEAM 2', 'SEAM 3', 'SEAM 4U', 'SEAM 4L', 'Total',
    ]);

    // Ekstrak baris pertama pada tbody (2026-09-01)
    const firstRowMatch = htmlStr.match(/<tbody><tr>([\s\S]*?)<\/tr>/);
    assert.ok(firstRowMatch, 'baris pertama tbody harus ada');
    const tds = [...firstRowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[0]);
    // Kolom ke-0 adalah Tanggal, kolom 1..11 harus sejajar 1:1 dengan headers[0..10]
    const dataTds = tds.slice(1);
    assert.equal(dataTds.length, headers.length);

    // Kolom index 4 (header 'Total' milik OB) harus berupa sel sv-rowtotal sv-ob, BUKAN input SEAM 1
    assert.match(dataTds[4], /data-sv-rowtotal="2026-09-01\|\|BEI\|\|ob"/, 'Kolom ke-5 (index 4) di bawah header Total OB harus berupa sv-rowtotal OB');

    // Kolom index 5..9 harus berupa input untuk SEAM 1, SEAM 2, SEAM 3, SEAM 4U, SEAM 4L secara berurutan
    const coalSeams = ['SEAM 1', 'SEAM 2', 'SEAM 3', 'SEAM 4U', 'SEAM 4L'];
    coalSeams.forEach((seam, i) => {
      const colIdx = 5 + i;
      assert.equal(headers[colIdx], seam);
      assert.match(
        dataTds[colIdx],
        new RegExp(`input[^>]*data-sv-cell="2026-09-01\\|\\|BEI\\|\\|coal\\|\\|${seam}"`),
        `Kolom di bawah header ${seam} harus memiliki <input> untuk ${seam} (bukan ${dataTds[colIdx]})`
      );
    });

    // Kolom index 10 (header 'Total' milik Coal) harus berupa sel sv-rowtotal sv-coal
    assert.match(dataTds[10], /data-sv-rowtotal="2026-09-01\|\|BEI\|\|coal"/, 'Kolom terakhir di bawah header Total Coal harus berupa sv-rowtotal Coal');

    // Periksa juga kesejajaran tfoot (Total Bulan) dan colgroup
    const tfootMatch = htmlStr.match(/<tfoot><tr>([\s\S]*?)<\/tr><\/tfoot>/);
    assert.ok(tfootMatch, 'tfoot harus ada');
    const footTds = [...tfootMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[0]).slice(1);
    assert.equal(footTds.length, headers.length);
    assert.match(footTds[4], /data-sv-monthtotal="BEI\|\|ob"/, 'Footer di bawah Total OB harus monthtotal OB');
    assert.match(footTds[9], /data-sv-monthcell="BEI\|\|coal\|\|SEAM 4L"/, 'Footer di bawah SEAM 4L harus monthcell SEAM 4L');
    assert.match(footTds[10], /data-sv-monthtotal="BEI\|\|coal"/, 'Footer di bawah Total Coal harus monthtotal Coal');

    const colgroupMatch = htmlStr.match(/<colgroup>([\s\S]*?)<\/colgroup>/);
    assert.ok(colgroupMatch, 'colgroup harus ada');
    const cols = [...colgroupMatch[1].matchAll(/<col class="([^"]+)">/g)].map(m => m[1]).slice(1);
    assert.deepEqual(cols, [
      'sv-numbercol', 'sv-numbercol', 'sv-numbercol', 'sv-numbercol', 'sv-totalcol',
      'sv-numbercol', 'sv-numbercol', 'sv-numbercol', 'sv-numbercol', 'sv-numbercol', 'sv-totalcol',
    ]);

    // Pastikan 2 tombol baru tersedia di filterbar (Download Template & Import Excel) dan tombol CSV/Excel lama telah dihapus
    assert.match(shell.innerHTML, /id="btnDownloadTemplateSurvey"/);
    assert.match(shell.innerHTML, /Download Template/i);
    assert.match(shell.innerHTML, /id="btnImportExcelSurvey"/);
    assert.match(shell.innerHTML, /Import Excel/i);
    assert.match(shell.innerHTML, /id="svImportExcelInput"/);
    assert.doesNotMatch(shell.innerHTML, /data-sv-export=/);
  } finally {
    globalThis.document = prevDoc;
    globalThis.fetch = prevFetch;
    globalThis.getProdApiUrl = prevApiUrl;
    globalThis.getProdAuthHeaders = prevAuth;
  }
});

test('Download Template mengekspor data tabel halaman & Import Excel membaca kembali data template termasuk kolom yang dikosongkan', () => {
  const materials = {
    ob: ['PASIR', 'CLAY', 'SUB SOIL', 'TOP SOIL'],
    coal: ['SEAM 1', 'SEAM 2', 'SEAM 3', 'SEAM 4U', 'SEAM 4L'],
  };
  const values = new Map([
    [core.cellKey('2026-09-01', 'BEI', 'ob', 'CLAY'), 1250.5],
    [core.cellKey('2026-09-01', 'BEI', 'coal', 'SEAM 4L'), 340.25],
    [core.cellKey('2026-09-02', 'BEI', 'ob', 'PASIR'), 800],
  ]);

  const tpl = core.buildTemplateSheetMatrix({
    pit: 'BEI',
    year: 2026,
    month: 9,
    materials,
    values,
  });

  assert.equal(tpl.sheetName, 'PIT BEI');
  assert.match(tpl.filename, /2026-09/);
  assert.match(tpl.filename, /BEI/);

  // Baris 0: Header grup, Baris 1: Header kolom material + Total
  assert.equal(tpl.aoa[0][0], 'Tanggal');
  assert.equal(tpl.aoa[0][1], 'Overburden Removal (BCM)');
  assert.equal(tpl.aoa[0][6], 'Coal Getting (Ton)');
  assert.deepEqual(tpl.aoa[1], [
    '',
    'PASIR', 'CLAY', 'SUB SOIL', 'TOP SOIL', 'Total',
    'SEAM 1', 'SEAM 2', 'SEAM 3', 'SEAM 4U', 'SEAM 4L', 'Total',
  ]);

  // Baris 2 adalah tanggal 2026-09-01: CLAY=1250.5, Total OB=1250.5, SEAM 4L=340.25, Total Coal=340.25
  assert.equal(tpl.aoa[2][0], '2026-09-01');
  assert.equal(tpl.aoa[2][2], 1250.5); // CLAY
  assert.equal(tpl.aoa[2][5], 1250.5); // Total OB
  assert.equal(tpl.aoa[2][10], 340.25); // SEAM 4L
  assert.equal(tpl.aoa[2][11], 340.25); // Total Coal

  // Baris terakhir adalah Total Bulan (30 hari di bulan September -> index 32)
  const lastRow = tpl.aoa[tpl.aoa.length - 1];
  assert.equal(lastRow[0], 'Total Bulan');
  assert.equal(lastRow[1], 800); // Total Bulan PASIR
  assert.equal(lastRow[2], 1250.5); // Total Bulan CLAY
  assert.equal(lastRow[5], 2050.5); // Total Bulan OB
  assert.equal(lastRow[10], 340.25); // Total Bulan SEAM 4L
  assert.equal(lastRow[11], 340.25); // Total Bulan Coal

  // Simulasikan user:
  // 1) Mengosongkan SEAM 4L pada 2026-09-01 (index baris 2, col 10 -> '')
  // 2) Mengisi SUB SOIL (col 3) = 450 dan SEAM 4L (col 10) = "512,75" pada 2026-09-03 (index baris 4)
  const editedMatrix = tpl.aoa.map(row => [...row]);
  editedMatrix[2][10] = '';
  editedMatrix[4][3] = 450;
  editedMatrix[4][10] = '512,75';

  const parsed = core.parseSurveyImportMatrix(editedMatrix, {
    pit: 'BEI',
    year: 2026,
    month: 9,
    materials,
    existingValues: values,
  });

  assert.equal(parsed.invalid, 0);
  // Sel SEAM 4L pada 2026-09-01 yang dikosongkan harus ikut disimpan sebagai volume: 0
  const clearedSeam4lDay1 = parsed.volumes.find(v => v.tanggal === '2026-09-01' && v.material === 'SEAM 4L');
  assert.deepEqual(clearedSeam4lDay1, {
    tanggal: '2026-09-01',
    pit_area: 'BEI',
    planning_type: 'coal',
    material: 'SEAM 4L',
    volume: 0,
  });
  const seam4lDay3 = parsed.volumes.find(v => v.tanggal === '2026-09-03' && v.material === 'SEAM 4L');
  assert.deepEqual(seam4lDay3, {
    tanggal: '2026-09-03',
    pit_area: 'BEI',
    planning_type: 'coal',
    material: 'SEAM 4L',
    volume: 512.75,
  });
  const subSoilDay3 = parsed.volumes.find(v => v.tanggal === '2026-09-03' && v.material === 'SUB SOIL');
  assert.deepEqual(subSoilDay3, {
    tanggal: '2026-09-03',
    pit_area: 'BEI',
    planning_type: 'ob',
    material: 'SUB SOIL',
    volume: 450,
  });
});


