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
    return { valid: true, jarak_meter: 0, lokasi_terdekat: null };
  }

  let jarakTerdekat = Infinity;
  let lokasiTerdekat = null;
  let isValid = false;

  for (const lok of daftarLokasi) {
    const jarak = hitungJarakMeter(latKaryawan, lngKaryawan, Number(lok.latitude), Number(lok.longitude));
    const maxRadius = Number(lok.radius_meter || 100);

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

  return {
    valid: isValid,
    jarak_meter: Math.round(jarakTerdekat),
    lokasi_terdekat: lokasiTerdekat,
  };
}

module.exports = { hitungJarakMeter, dalamRadius, dalamRadiusMultiPoint };
