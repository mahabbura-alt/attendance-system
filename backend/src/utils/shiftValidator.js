/**
 * Semua perhitungan waktu di sini menggunakan `now` yang WAJIB berasal dari
 * jam server (new Date() di backend), BUKAN jam yang dikirim dari HP karyawan.
 * Ini penting karena tidak ada toleransi keterlambatan sama sekali.
 */

/** Gabungkan tanggal (WIB) dengan jam 'HH:MM:SS' menjadi Date UTC yang tepat. */
function gabungTanggalJam(tanggalStrOrDate, jamString) {
  let tglStr = '';
  if (typeof tanggalStrOrDate === 'string') {
    tglStr = tanggalStrOrDate.split('T')[0];
  } else if (tanggalStrOrDate instanceof Date) {
    const wibDate = new Date(tanggalStrOrDate.getTime() + (7 * 60 * 60 * 1000));
    const yyyy = wibDate.getUTCFullYear();
    const mm = String(wibDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(wibDate.getUTCDate()).padStart(2, '0');
    tglStr = `${yyyy}-${mm}-${dd}`;
  } else {
    tglStr = new Date().toISOString().split('T')[0];
  }
  const jamNorm = jamString.length === 5 ? `${jamString}:00` : jamString;
  return new Date(`${tglStr}T${jamNorm}+07:00`);
}

function tambahHari(tanggal, jumlahHari) {
  const hasil = new Date(tanggal);
  hasil.setDate(hasil.getDate() + jumlahHari);
  return hasil;
}

/**
 * Menentukan status absen datang.
 * @param {object} shift - row dari tabel shifts
 * @param {Date} tanggalKerja - tanggal mulai shift (00:00)
 * @param {Date} waktuDatang - timestamp server saat absen datang
 */
function statusAbsenDatang(shift, tanggalKerja, waktuDatang) {
  const batasMaks = gabungTanggalJam(tanggalKerja, shift.jam_masuk_maks);
  return waktuDatang.getTime() <= batasMaks.getTime() ? 'tepat waktu' : 'telat';
}

/**
 * Menentukan status absen pulang + validasi jam checkout.
 * Jika checkout dilakukan sebelum jam_pulang_min, diberikan status 'pulang awal'
 * dan tetap diizinkan agar karyawan/tester tidak terblokir.
 */
function statusAbsenPulang(shift, tanggalKerja, waktuPulang) {
  const hariPulangEkspektasi = shift.lintas_hari
    ? tambahHari(tanggalKerja, 1)
    : tanggalKerja;

  const batasMin = gabungTanggalJam(hariPulangEkspektasi, shift.jam_pulang_min);
  const akhirWindowWajar = gabungTanggalJam(hariPulangEkspektasi, '23:59:59');

  if (waktuPulang.getTime() < batasMin.getTime()) {
    return 'pulang awal';
  }

  return waktuPulang.getTime() <= akhirWindowWajar.getTime()
    ? 'tepat waktu'
    : 'checkout lewat';
}

module.exports = {
  gabungTanggalJam,
  tambahHari,
  statusAbsenDatang,
  statusAbsenPulang,
};
