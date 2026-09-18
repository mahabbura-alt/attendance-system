/* ============================================================
 * VERIFIKASI ENDPOINT PRODUKSI LIVE (Vercel)
 * Mengecek status HTTP semua endpoint GET produksi.
 * ============================================================ */
const BASE = 'https://attendance-system-eta-opal.vercel.app/api/admin/production';

const endpoints = [
  'master',
  'breakdown',
  'standby',
  'fuel',
  'logs',
  'log-periods',
  'fuel-periods',
  'fuel-cards',
  'standby-history',
  'standby-review',
  'breakdown-history',
  'unit-performance',
  'fleet-mappings',
  'ritase/fleet',
  'truck-factors',
  'truck-factors/previous',
  'daily-dashboard',
  'production-data?year=2026&month=9',
  'productivity-report',
  'mtd-report',
  'ytd-report',
  'project-to-date',
  'executive-dashboard',
  'ai-insights',
  'productivity-plans/OB',
];

async function check(name, url) {
  try {
    const res = await fetch(url);
    let body = '';
    try { body = await res.text(); } catch (e) {}
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (e) {}
    const isErr = parsed && parsed.error;
    const status = isErr ? `HTTP ${res.status} (ERROR: ${parsed.error})` : `HTTP ${res.status}`;
    console.log(`  ${name.padEnd(24)} => ${status}`);
    return { name, ok: res.status === 200 && !isErr, error: parsed?.error };
  } catch (err) {
    console.log(`  ${name.padEnd(24)} => FETCH ERROR: ${err.message}`);
    return { name, ok: false, error: err.message };
  }
}

async function main() {
  console.log('=== VERIFIKASI ENDPOINT PRODUKSI LIVE ===\n');
  const results = [];
  for (const ep of endpoints) {
    results.push(await check(ep, `${BASE}/${ep}`));
  }
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== SELESAI: total=${results.length}, GAGAL=${failed.length} ===`);
  if (failed.length) {
    console.log('\nEndpoint yang gagal:');
    failed.forEach(f => console.log(`  - ${f.name}: ${f.error}`));
  }
  process.exit(failed.length ? 1 : 0);
}

main();
