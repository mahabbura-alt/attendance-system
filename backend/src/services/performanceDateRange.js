const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIsoDate(value, label) {
  if (!ISO_DATE_RE.test(String(value || ''))) {
    const error = new Error(`${label} wajib berformat YYYY-MM-DD.`);
    error.statusCode = 400;
    throw error;
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    const error = new Error(`${label} tidak valid.`);
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function resolvePerformanceDateRange({ periode, tanggal_mulai, tanggal_akhir }) {
  if (periode !== 'rentang') return null;

  const tanggalMulai = parseIsoDate(tanggal_mulai, 'Tanggal awal');
  const tanggalAkhir = parseIsoDate(tanggal_akhir, 'Tanggal akhir');
  if (tanggalAkhir < tanggalMulai) {
    const error = new Error('Tanggal akhir tidak boleh lebih awal dari tanggal awal.');
    error.statusCode = 400;
    throw error;
  }

  return {
    tanggalMulai,
    tanggalAkhir,
    mulaiStr: tanggalMulai.toISOString().slice(0, 10),
    akhirStr: tanggalAkhir.toISOString().slice(0, 10),
    isHarian: false,
  };
}

module.exports = { resolvePerformanceDateRange };
