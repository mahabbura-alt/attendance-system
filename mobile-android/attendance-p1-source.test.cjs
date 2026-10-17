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

test('APK V3 memakai gateway Biznet dan tetap dapat di-update dari server', () => {
  const build = read('app/build.gradle.kts');
  const api = read('app/src/main/java/com/perusahaan/absensi/network/ApiService.kt');
  const updater = read('app/src/main/java/com/perusahaan/absensi/update/UpdateManager.kt');
  assert.match(build, /versionCode = 6/);
  assert.match(build, /versionName = "3\.0\.1"/);
  assert.match(build, /https:\/\/103\.58\.101\.240\//);
  assert.match(api, /@GET\("api\/app\/version"\)/);
  assert.match(updater, /verifyPackageAndSigner/);
  assert.match(updater, /sha256\(file\)/);
  assert.match(updater, /isTrustedApkUrl/);
  assert.match(updater, /Izinkan & Update/);
  assert.match(updater, /saveApprovedRelease/);
  assert.match(updater, /resumeApprovedUpdate/);
  assert.match(updater, /DownloadManager\.Request/);
  assert.match(updater, /STATUS_FAILED/);
});

test('timestamp Riwayat Absensi dikonversi dari instant server ke WIB', () => {
  const history = read('app/src/main/java/com/perusahaan/absensi/ui/RiwayatActivity.kt');
  const formatter = read('app/src/main/java/com/perusahaan/absensi/util/WibDateTimeFormatter.kt');
  assert.match(history, /WibDateTimeFormatter\.time\(item\.waktu_datang\)/);
  assert.match(history, /WibDateTimeFormatter\.time\(item\.waktu_pulang\)/);
  assert.doesNotMatch(history, /Regex\("T\(/);
  assert.match(formatter, /ZoneId\.of\("Asia\/Jakarta"\)/);
  assert.match(formatter, /Instant\.parse\(value\)\.atZone\(wibZone\)/);
  assert.match(formatter, /"\$it WIB"/);
});

test('APK V3 menyediakan kalibrasi GPS presisi tanpa menulis absensi', () => {
  const home = read('app/src/main/java/com/perusahaan/absensi/ui/HomeActivity.kt');
  const calibration = read('app/src/main/java/com/perusahaan/absensi/ui/GpsCalibrationActivity.kt');
  const layout = read('app/src/main/res/layout/activity_home.xml');
  assert.match(home, /GpsCalibrationActivity::class\.java/);
  assert.match(layout, /btnMenuKalibrasiGps/);
  assert.match(calibration, /PRIORITY_HIGH_ACCURACY/);
  assert.match(calibration, /TARGET_ACCURACY_METERS = 15f/);
  assert.match(calibration, /REQUIRED_STABLE_FIXES = 3/);
  assert.doesNotMatch(calibration, /absenDatang|absenPulang|RetrofitClient/);
});

test('fitur penting APK V2.2 tetap tersedia pada V3', () => {
  const manifest = read('app/src/main/AndroidManifest.xml');
  const home = read('app/src/main/java/com/perusahaan/absensi/ui/HomeActivity.kt');
  const absen = read('app/src/main/java/com/perusahaan/absensi/ui/AbsenActivity.kt');
  assert.match(manifest, /RiwayatActivity/);
  assert.match(manifest, /RekapHmActivity/);
  assert.match(manifest, /SlipGajiActivity/);
  assert.match(home, /RiwayatActivity::class\.java/);
  assert.match(home, /RekapHmActivity::class\.java/);
  assert.match(home, /SlipGajiActivity::class\.java/);
  assert.match(absen, /PhotoCompressor\.compressJpeg/);
});

test('Riwayat Absensi dan Rekap HM memiliki slicer periode server-side', () => {
  const api = read('app/src/main/java/com/perusahaan/absensi/network/ApiService.kt');
  const history = read('app/src/main/java/com/perusahaan/absensi/ui/RiwayatActivity.kt');
  const hm = read('app/src/main/java/com/perusahaan/absensi/ui/RekapHmActivity.kt');
  const historyLayout = read('app/src/main/res/layout/activity_riwayat.xml');
  const hmLayout = read('app/src/main/res/layout/activity_rekap_hm.xml');
  assert.match(api, /suspend fun riwayat\([\s\S]*@Query\("tanggal_mulai"\)[\s\S]*@Query\("tanggal_akhir"\)/);
  assert.match(api, /suspend fun getRekapHm\([\s\S]*@Query\("tanggal_mulai"\)[\s\S]*@Query\("tanggal_akhir"\)/);
  assert.match(history, /riwayat\(tanggalMulai\.toString\(\), tanggalAkhir\.toString\(\)\)/);
  assert.match(hm, /getRekapHm\(tanggalMulai\.toString\(\), tanggalAkhir\.toString\(\)\)/);
  assert.match(historyLayout, /btnTerapkanPeriodeRiwayat/);
  assert.match(hmLayout, /btnTerapkanPeriodeHm/);
});
