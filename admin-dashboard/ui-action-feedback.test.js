const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const feedback = require('./ui-action-feedback');

function fakeButton(label = '<b>Simpan</b>') {
  const attributes = new Map();
  const classes = new Set();
  let html = label;
  return {
    disabled: false,
    dataset: {},
    style: { minWidth: '' },
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    get innerHTML() { return html; },
    set innerHTML(value) { html = String(value); },
    get textContent() { return html.replace(/<[^>]+>/g, ''); },
    set textContent(value) { html = String(value); },
    getAttribute: name => attributes.has(name) ? attributes.get(name) : null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: name => attributes.delete(name),
    getBoundingClientRect: () => ({ width: 120 }),
  };
}

const instant = { minBusyMs: 0, successMs: 0, errorMs: 0 };

test('mengunci tombol dan menolak eksekusi kedua selama penyimpanan', async () => {
  const button = fakeButton();
  let release;
  let calls = 0;
  const pending = feedback.run(button, () => {
    calls += 1;
    return new Promise(resolve => { release = resolve; });
  }, instant);

  assert.equal(feedback.isBusy(button), true);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute('aria-busy'), 'true');
  const duplicate = await feedback.run(button, () => { calls += 1; }, instant);
  assert.equal(duplicate, undefined);
  assert.equal(calls, 1);

  release('ok');
  assert.equal(await pending, 'ok');
  assert.equal(feedback.isBusy(button), false);
  assert.equal(button.disabled, false);
  assert.equal(button.innerHTML, '<b>Simpan</b>');
});

test('memulihkan tombol dan meneruskan error asli', async () => {
  const button = fakeButton('Simpan Data');
  const failure = new Error('network down');

  await assert.rejects(
    feedback.run(button, async () => { throw failure; }, instant),
    error => error === failure
  );
  assert.equal(feedback.isBusy(button), false);
  assert.equal(button.disabled, false);
  assert.equal(button.innerHTML, 'Simpan Data');
  assert.equal(button.getAttribute('aria-busy'), null);
});

test('resolveDisabled dapat mempertahankan tombol nonaktif setelah sukses', async () => {
  const button = fakeButton();
  await feedback.run(button, async () => ({ saved: true }), {
    ...instant,
    resolveDisabled: ({ success, result }) => success && result.saved,
  });
  assert.equal(button.disabled, true);
});

test('onRestore dapat menyinkronkan label dinamis setelah feedback selesai', async () => {
  const button = fakeButton('Simpan (3)');
  await feedback.run(button, async () => true, {
    ...instant,
    onRestore: ({ button: restored }) => { restored.textContent = 'Simpan'; },
  });
  assert.equal(button.textContent, 'Simpan');
});

test('helper dimuat sebelum dashboard utama dan style feedback tersedia', () => {
  const root = __dirname;
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const style = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
  const helperPosition = index.indexOf('ui-action-feedback.js');

  assert.ok(helperPosition >= 0, 'helper harus dimuat oleh halaman admin');
  assert.ok(helperPosition < index.indexOf('production.loader.js'), 'helper harus tersedia sebelum lazy production loader');
  assert.ok(helperPosition < index.indexOf('app.js'), 'helper harus tersedia sebelum app.js');
  assert.match(style, /\.omos-action-feedback--busy::before/);
  assert.match(style, /prefers-reduced-motion:\s*reduce/);
});

test('submitter memakai fallback tombol submit untuk browser lama', () => {
  const fallback = fakeButton('Simpan');
  const event = { currentTarget: { querySelector: () => fallback } };
  assert.equal(feedback.submitter(event), fallback);
});

test('status autosave mengekspos state loading dan aksesibilitas', () => {
  const element = fakeButton('');
  feedback.status(element, 'loading', 'Menyimpan perubahan…');
  assert.equal(element.textContent, 'Menyimpan perubahan…');
  assert.equal(element.dataset.omosStatusState, 'loading');
  assert.equal(element.getAttribute('role'), 'status');
  assert.equal(element.getAttribute('aria-busy'), 'true');
  feedback.status(element, 'success', 'Tersimpan');
  assert.equal(element.getAttribute('aria-busy'), 'false');
});
