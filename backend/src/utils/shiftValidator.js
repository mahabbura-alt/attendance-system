/**
 * Semua perhitungan waktu di sini menggunakan `now` yang WAJIB berasal dari
 * jam server (new Date() di backend), BUKAN jam yang dikirim dari HP karyawan.
 * Ini penting karena tidak ada toleransi keterlambatan sama sekali.
 */

/** Gabungkan tanggal (Date, jam 00:00) dengan jam 'HH:MM:SS' menjadi Date lengkap. */
function gabungTanggalJam(tanggal, jamString) {
  const [h, m, s] = jamString.split(':').map(Number);
  const hasil = new Date(tanggal);
  hasil.setHours(h, m, s || 0, 0);
  return hasil;
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
 * Menentukan status absen pulang + validasi bahwa checkout tidak dilakukan
 * sebelum jam_pulang_min (checkout terlalu cepat harus ditolak).
 *
 * Window checkout "wajar":
 * - Shift non-lintas hari: mulai jam_pulang_min s.d. akhir hari yang sama (23:59:59), tanggalKerja
 * - Shift lintas hari    : mulai jam_pulang_min s.d. akhir hari berikutnya (23:59:59), tanggalKerja + 1
 *
 * Checkout yang terjadi setelah window wajar tsb (baru dilakukan di hari
 * berikutnya lagi) dianggap "checkout lewat".
 */
function statusAbsenPulang(shift, tanggalKerja, waktuPulang) {
  const hariPulangEkspektasi = shift.lintas_hari
    ? tambahHari(tanggalKerja, 1)
    : tanggalKerja;

  const batasMin = gabungTanggalJam(hariPulangEkspektasi, shift.jam_pulang_min);
  const akhirWindowWajar = gabungTanggalJam(hariPulangEkspektasi, '23:59:59');

  if (waktuPulang.getTime() < batasMin.getTime()) {
    const jamMinFormatted = String(shift.jam_pulang_min).substring(0, 5);
    const err = new Error(`Jam pulang belum tersedia (minimal jam ${jamMinFormatted})`);
    err.statusCode = 400;
    throw err;
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
