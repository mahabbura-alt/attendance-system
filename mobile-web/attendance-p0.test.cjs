const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function portal(file = 'karyawan.js') {
  const elements = new Map();
  const storage = new Map([['token_karyawan', 'test-token']]);
  const alerts = [];
  const context = vm.createContext({
    window: { location: { origin: 'https://example.test' } }, Headers, Date, console,
    AbortController, setTimeout, clearTimeout, alert: message => alerts.push(message),
    localStorage: { getItem: key => storage.get(key), removeItem: key => storage.delete(key) },
    document: {
      addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { style: {}, classList: { add() {}, remove() {} } });
        return elements.get(id);
      },
    },
    fetch: async () => ({ status: 200, ok: true, json: async () => [] }),
  });
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, file), 'utf8'), context);
  return { context, elements, storage, alerts };
}

test('every supported portal URL resolves the canonical mobile script', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const src = html.match(/<script src="([^"]+)"/)[1];
  for (const entry of ['/karyawan.html', '/karyawan', '/mobile', '/portal/index.html']) {
    assert.equal(new URL(src, `https://example.test${entry}`).pathname, '/mobile-web/karyawan.js');
  }
});

test('authenticated 401 clears session and displays login explanation', async () => {
  const { context, elements, storage } = portal();
  context.fetch = async () => ({ status: 401 });
  await assert.rejects(vm.runInContext("portalFetch('/api/absensi/riwayat', {headers:{Authorization:'Bearer test-token'}})", context), /Sesi login berakhir/);
  assert.equal(storage.has('token_karyawan'), false);
  assert.equal(elements.get('viewLogin').style.display, 'flex');
  assert.match(elements.get('loginAlert').textContent, /masuk kembali/);
});

test('late 401 from a previous login does not log out a new session', async () => {
  const { context, storage } = portal();
  context.fetch = async () => ({ status: 401 });
  await vm.runInContext("portalFetch('/api/absensi/riwayat', {headers:{Authorization:'Bearer old-token'}})", context);
  assert.equal(storage.get('token_karyawan'), 'test-token');
});

test('pending session enables checkout; completed session does not lock next arrival', async () => {
  const { context, elements } = portal();
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  let row = { tanggal_kerja: date, waktu_datang: new Date().toISOString(), waktu_pulang: null };
  context.fetch = async () => ({ status: 200, json: async () => [row] });
  await vm.runInContext('cekStatusToday()', context);
  assert.equal(elements.get('btnTriggerDatang').disabled, true);
  assert.equal(elements.get('btnTriggerPulang').disabled, false);
  row = { ...row, waktu_pulang: new Date().toISOString() };
  await vm.runInContext('cekStatusToday()', context);
  assert.equal(elements.get('btnTriggerDatang').disabled, false);
  assert.equal(elements.get('btnTriggerPulang').disabled, true);
});

test('manual attendance note without clock-in is not treated as a pending session', async () => {
  const { context, elements } = portal();
  context.fetch = async () => ({
    status: 200,
    ok: true,
    json: async () => [{
      tanggal_kerja: new Date().toISOString().slice(0, 10),
      waktu_datang: null,
      waktu_pulang: null,
      kategori_manual: 'cuti',
    }],
  });
  await vm.runInContext('cekStatusToday()', context);
  assert.equal(elements.get('btnTriggerDatang').disabled, false);
  assert.equal(elements.get('btnTriggerPulang').disabled, true);
});

test('portal delegates GPS accuracy acceptance to the server policy', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'karyawan.js'), 'utf8');
  assert.doesNotMatch(source, /currentAccuracy\s*>\s*100/);
  assert.match(source, /formData\.append\('accuracy'/);
});

test('legacy GPS failure never substitutes office coordinates', async () => {
  const { context } = portal('../admin-dashboard/karyawan.js');
  let calls = 0;
  context.fetch = async () => { calls++; throw Error('must not request office coordinates'); };
  const result = await vm.runInContext('useOfficeLocationFallback(null, null)', context);
  assert.equal(result, false);
  assert.equal(calls, 0);
  assert.equal(vm.runInContext('currentCoords.lat', context), null);
  assert.equal(vm.runInContext('isLocationValid', context), false);
});

test('portal request berhenti dengan pesan eksplisit ketika melewati timeout', async () => {
  const { context } = portal();
  context.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(
    vm.runInContext("portalFetch('/api/absensi/riwayat', {timeoutMs:5})", context),
    /melewati batas waktu/,
  );
});

test('portal merekonsiliasi absensi yang tersimpan saat respons awal terputus', async () => {
  const { context, alerts } = portal();
  context.fetch = async () => ({
    status: 200,
    ok: true,
    json: async () => [{ waktu_datang: new Date().toISOString(), waktu_pulang: null }],
  });
  const recovered = await vm.runInContext("reconcileAttendanceAfterConnectionLoss('datang')", context);
  assert.equal(recovered, true);
  assert.match(alerts[0], /sudah tercatat di server/);
});

test('portal mengecilkan dimensi foto tanpa mengubah rasio', () => {
  const { context } = portal();
  assert.equal(
    vm.runInContext('JSON.stringify(fitImageDimensions(4000, 2000, 960))', context),
    JSON.stringify({ width: 960, height: 480 }),
  );
  assert.equal(
    vm.runInContext('JSON.stringify(fitImageDimensions(640, 480, 960))', context),
    JSON.stringify({ width: 640, height: 480 }),
  );
});

test('portal menyiapkan foto terkompresi sebelum request absensi', () => {
  const source = fs.readFileSync(path.resolve(__dirname, 'karyawan.js'), 'utf8');
  assert.match(source, /capturedBlob = await compressImageBlob\(capturedBlob\)/);
  assert.match(source, /timeoutMs: 60000/);
});
