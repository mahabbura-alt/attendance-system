const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('local storage writes, resolves, streams, and deletes an object', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omos-storage-'));
  process.env.STORAGE_PROVIDER = 'local';
  process.env.STORAGE_LOCAL_ROOT = root;
  process.env.PUBLIC_BASE_URL = 'https://example.test';
  delete require.cache[require.resolve('../src/services/storage')];
  const storage = require('../src/services/storage');

  const key = await storage.uploadFoto(Buffer.from('photo'), { userId: 'user-1', jenis: 'datang' });
  assert.match(key, /^absensi\/user-1\/.+-datang\.jpg$/);
  assert.equal(await fs.readFile(path.join(root, 'absensi-foto', key), 'utf8'), 'photo');
  assert.equal(
    await storage.getUrlFoto(`https://old.supabase.co/storage/v1/object/public/absensi-foto/${key}`),
    `https://example.test/api/storage/view?key=${encodeURIComponent(key)}`,
  );

  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    sendFile(filePath) { this.filePath = filePath; return filePath; },
    status(code) { this.statusCode = code; return this; },
    send(message) { this.message = message; return message; },
  };
  await storage.streamFoto(key, response);
  assert.equal(response.filePath, path.join(root, 'absensi-foto', key));

  await storage.hapusFoto(key);
  await assert.rejects(fs.access(path.join(root, 'absensi-foto', key)));
  await fs.rm(root, { recursive: true, force: true });
});

test('local storage rejects traversal keys', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omos-storage-'));
  process.env.STORAGE_PROVIDER = 'local';
  process.env.STORAGE_LOCAL_ROOT = root;
  process.env.PUBLIC_BASE_URL = 'https://example.test';
  delete require.cache[require.resolve('../src/services/storage')];
  const storage = require('../src/services/storage');
  const response = { status() { return this; }, send() {} };
  await assert.rejects(storage.streamFoto('../outside.jpg', response), /tidak valid/);
  await fs.rm(root, { recursive: true, force: true });
});
