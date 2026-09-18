/**
 * Ambang akurasi GPS maksimum (meter). Jika radius ketidakpastian koordinat
 * melebihi nilai ini, koordinat dianggap terlalu kasar untuk validasi radius
 * (sinyal GPS lemah / network-based positioning), sehingga absen ditolak.
 *
 * Dinaikkan dari 100 m menjadi 500 m agar lebih toleran terhadap area tambang
 * terbuka dengan sinyal GPS fluktuatif, sementara validasi radius geofence
 * (Haversine) tetap menjadi lapisan kedua yang memastikan koordinat berada di
 * dalam area resmi.
 */
const MAX_ACCURACY_METER = 500;

/**
 * Validasi nilai akurasi GPS yang dikirim klien (dalam meter).
 * @param {number|string|undefined} accuracy
 * @returns {{ valid: boolean, accuracy: number|null, reason?: string }}
 */
function validasiAkurasi(accuracy) {
  if (accuracy === undefined || accuracy === null || accuracy === '') {
    // Klien tidak mengirim akurasi -> tidak bisa dinilai, biarkan lolos
    // (validasi radius tetap berjalan sebagai lapisan kedua).
    return { valid: true, accuracy: null };
  }
  const acc = Number(accuracy);
  if (!Number.isFinite(acc) || acc < 0) {
    return { valid: false, accuracy: null, reason: 'Nilai akurasi GPS tidak valid' };
  }
  if (acc > MAX_ACCURACY_METER) {
    return {
      valid: false,
      accuracy: acc,
      reason: `Akurasi GPS terlalu rendah (±${Math.round(acc)}m). Mendekatlah ke area terbuka & tunggu sinyal GPS stabil, lalu coba lagi.`,
    };
  }
  return { valid: true, accuracy: acc };
}

/**
 * Menghitung jarak antara dua koordinat GPS menggunakan formula Haversine.
 * @returns {number} jarak dalam meter
 */
function hitungJarakMeter(lat1, lng1, lat2, lng2) {
  const R = 6371000; // radius bumi dalam meter
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Cek apakah koordinat karyawan berada dalam radius toleransi lokasi kantor.
 */
function dalamRadius(latKaryawan, lngKaryawan, lokasiKantor) {
  const jarak = hitungJarakMeter(
    latKaryawan,
    lngKaryawan,
    lokasiKantor.latitude,
    lokasiKantor.longitude
  );

  return {
    valid: jarak <= (lokasiKantor.radius_meter || 100),
    jarak_meter: Math.round(jarak),
  };
}

/**
 * Cek apakah koordinat karyawan berada dalam radius toleransi SALAH SATU lokasi kantor/tambang resmi.
 */
function dalamRadiusMultiPoint(latKaryawan, lngKaryawan, daftarLokasi = []) {
  if (!daftarLokasi || !daftarLokasi.length) {
    return {
      valid: false,
      jarak_meter: null,
      lokasi_terdekat: null,
      configuration_error: true,
    };
  }

  let jarakTerdekat = Infinity;
  let lokasiTerdekat = null;
  let isValid = false;
  let validLocationCount = 0;

  for (const lok of daftarLokasi) {
    if (lok?.latitude === null || lok?.latitude === undefined || lok?.latitude === ''
      || lok?.longitude === null || lok?.longitude === undefined || lok?.longitude === ''
      || lok?.radius_meter === null || lok?.radius_meter === undefined || lok?.radius_meter === '') {
      continue;
    }
    const latitude = Number(lok?.latitude);
    const longitude = Number(lok?.longitude);
    const configuredRadius = Number(lok?.radius_meter);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || !Number.isFinite(configuredRadius) || configuredRadius <= 0) {
      continue;
    }
    validLocationCount += 1;
    const jarak = hitungJarakMeter(latKaryawan, lngKaryawan, latitude, longitude);
    const maxRadius = configuredRadius;

    if (jarak < jarakTerdekat) {
      jarakTerdekat = jarak;
      lokasiTerdekat = lok;
    }

    if (jarak <= maxRadius) {
      isValid = true;
      lokasiTerdekat = lok;
      break;
    }
  }

  if (!validLocationCount) {
    return {
      valid: false,
      jarak_meter: null,
      lokasi_terdekat: null,
      configuration_error: true,
    };
  }

  return {
    valid: isValid,
    jarak_meter: Math.round(jarakTerdekat),
    lokasi_terdekat: lokasiTerdekat,
  };
}

module.exports = { hitungJarakMeter, dalamRadius, dalamRadiusMultiPoint, validasiAkurasi, MAX_ACCURACY_METER };
