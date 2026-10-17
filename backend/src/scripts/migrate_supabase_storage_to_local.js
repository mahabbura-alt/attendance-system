require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const root = path.resolve(process.env.STORAGE_LOCAL_ROOT || '/data/storage');
const manifestDir = path.resolve(process.env.STORAGE_MANIFEST_DIR || '/data/manifests');
const bucketNames = String(process.env.STORAGE_MIGRATION_BUCKETS || 'absensi-foto,log-activity')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const concurrency = Math.max(1, Math.min(12, Number(process.env.STORAGE_MIGRATION_CONCURRENCY || 6)));

function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib tersedia');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function safeDestination(bucket, objectKey) {
  const bucketRoot = path.resolve(root, bucket);
  const destination = path.resolve(bucketRoot, objectKey);
  if (!destination.startsWith(`${bucketRoot}${path.sep}`)) throw new Error(`Object key tidak aman: ${objectKey}`);
  return destination;
}

async function listObjects(client, bucket, prefix = '') {
  const objects = [];
  let offset = 0;
  while (true) {
    const { data, error } = await client.storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw error;
    const entries = data || [];
    for (const entry of entries) {
      const key = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) objects.push({ key, size: Number(entry.metadata?.size || 0) });
      else objects.push(...await listObjects(client, bucket, key));
    }
    if (entries.length < 1000) break;
    offset += entries.length;
  }
  return objects;
}

async function migrateObject(client, bucket, object) {
  const destination = safeDestination(bucket, object.key);
  try {
    const current = await fs.stat(destination);
    if (object.size > 0 && current.size === object.size) {
      return { bucket, key: object.key, size: current.size, status: 'unchanged' };
    }
  } catch (_) {}

  const { data, error } = await client.storage.from(bucket).download(object.key);
  if (error || !data) throw error || new Error(`Download kosong: ${bucket}/${object.key}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  const temp = `${destination}.${crypto.randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(temp, buffer, { flag: 'wx' });
  await fs.rename(temp, destination);
  return {
    bucket,
    key: object.key,
    size: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    status: 'copied',
  };
}

async function mapLimit(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
      if ((index + 1) % 100 === 0) console.log(`progress=${index + 1}/${items.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run));
  return results;
}

async function main() {
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(manifestDir, { recursive: true });
  const client = getClient();
  const manifest = [];
  for (const bucket of bucketNames) {
    const objects = await listObjects(client, bucket);
    console.log(`bucket=${bucket} objects=${objects.length}`);
    manifest.push(...await mapLimit(objects, (object) => migrateObject(client, bucket, object)));
  }
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  const manifestPath = path.join(manifestDir, `${stamp}-storage.jsonl`);
  await fs.writeFile(manifestPath, `${manifest.map((row) => JSON.stringify(row)).join('\n')}\n`, { flag: 'wx' });
  const bytes = manifest.reduce((sum, row) => sum + Number(row.size || 0), 0);
  console.log(`manifest=${manifestPath}`);
  console.log(`objects=${manifest.length}`);
  console.log(`bytes=${bytes}`);
  console.log(`copied=${manifest.filter((row) => row.status === 'copied').length}`);
  console.log(`unchanged=${manifest.filter((row) => row.status === 'unchanged').length}`);
}

main().catch((error) => {
  console.error(`storage_migration_failed=${error.message}`);
  process.exit(1);
});
