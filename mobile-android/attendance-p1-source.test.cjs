const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.resolve(__dirname, relative), 'utf8');

test('APK mengirim akurasi GPS dan mengambil fix baru sebelum submit', () => {
  const dto = read('app/src/main/java/com/perusahaan/absensi/network/dto/AbsensiDto.kt');
  const activity = read('app/src/main/java/com/perusahaan/absensi/ui/AbsenActivity.kt');
  assert.match(dto, /data class CheckLokasiRequest\([\s\S]*val accuracy: Float\?/);
  assert.ok((activity.match(/ambilLokasiSaatIni\(this@AbsenActivity\)/g) || []).length >= 2);
  assert.match(activity, /rekonsiliasiSetelahKoneksiTerputus/);
});

test('APK memiliki timeout jaringan dan menahan tombol ketika status sesi tidak diketahui', () => {
  const network = read('app/src/main/java/com/perusahaan/absensi/network/RetrofitClient.kt');
  const home = read('app/src/main/java/com/perusahaan/absensi/ui/HomeActivity.kt');
  assert.match(network, /connectTimeout\(15, TimeUnit\.SECONDS\)/);
  assert.match(network, /callTimeout\(60, TimeUnit\.SECONDS\)/);
  assert.match(home, /btnAbsenDatang\.isEnabled = false/);
  assert.match(home, /btnAbsenPulang\.isEnabled = false/);
});

test('credential signing release dibaca dari konfigurasi eksternal', () => {
  const build = read('app/build.gradle.kts');
  assert.match(build, /OMOS_RELEASE_STORE_PASSWORD/);
  assert.match(build, /OMOS_RELEASE_KEY_ALIAS/);
  assert.match(build, /OMOS_RELEASE_KEY_PASSWORD/);
  assert.doesNotMatch(build, /storePassword\s*=\s*".+"/);
  assert.doesNotMatch(build, /keyPassword\s*=\s*".+"/);
});

test('APK membatasi resolusi dan kualitas JPEG untuk jaringan lapangan', () => {
  const source = read('app/src/main/java/com/perusahaan/absensi/ui/AbsenActivity.kt');
  assert.match(source, /setTargetResolution\(Size\(720, 960\)\)/);
  assert.match(source, /setJpegQuality\(75\)/);
});
