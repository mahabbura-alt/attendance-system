const test = require('node:test');
const assert = require('node:assert/strict');

const { buatQueryAbsensiTerfilter } = require('../src/controllers/adminController');

test('baris kamera yang ditimpa rekap: kolom kamera di-NULL dan kamera_ditimpa=true', () => {
  const { queryStr, params } = buatQueryAbsensiTerfilter({});
  assert.equal(params[0], false);
  assert.match(queryStr, /CASE WHEN a\.id IS NOT NULL AND kp\.kategori IS NOT NULL AND NOT \$1\s+THEN NULL ELSE a\.waktu_datang END AS waktu_datang/);
  assert.match(queryStr, /CASE WHEN a\.id IS NOT NULL AND kp\.kategori IS NOT NULL AND NOT \$1\s+THEN NULL ELSE a\.status_pulang END AS status_pulang/);
  assert.match(queryStr, /CASE WHEN a\.id IS NOT NULL AND kp\.kategori IS NOT NULL AND NOT \$1\s+THEN NULL ELSE COALESCE\(s\.nama_shift, '-'\) END AS nama_shift/);
  assert.match(queryStr, /\(a\.id IS NOT NULL AND kp\.kategori IS NOT NULL AND NOT \$1\) AS kamera_ditimpa/);
  // Status datang tetap mengikuti rekap (manual-first)
  assert.match(queryStr, /COALESCE\(kp\.kategori, a\.status_datang\) AS status_datang/);
});

test('export excel memakai tampilkanKamera=true sehingga histori kamera tidak di-mask', () => {
  const { queryStr, params } = buatQueryAbsensiTerfilter({}, { batasi: false, tampilkanKamera: true });
  assert.equal(params[0], true);
  assert.doesNotMatch(queryStr, /LIMIT 500/);
  // Masking dinonaktifkan: kondisi CASE tidak pernah benar saat $1 = true
  assert.match(queryStr, /NOT \$1/);
});

test('baris kamera tanpa keterangan manual tidak ditandai kamera_ditimpa', () => {
  const { queryStr } = buatQueryAbsensiTerfilter({});
  // kamera_ditimpa mensyaratkan kp.kategori IS NOT NULL -> baris murni kamera false
  assert.match(queryStr, /kp\.kategori IS NOT NULL AND NOT \$1\) AS kamera_ditimpa/);
});