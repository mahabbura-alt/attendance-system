const MAX_RANGE_DAYS = 31;

let schemaReadyPromise = null;

function parseIsoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const error = new Error(`${label} wajib memakai format YYYY-MM-DD`);
    error.statusCode = 400;
    throw error;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    const error = new Error(`${label} tidak valid`);
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function validateDateRange(tanggalMulai, tanggalAkhir) {
  const start = parseIsoDate(tanggalMulai, 'Tanggal awal');
  const end = parseIsoDate(tanggalAkhir, 'Tanggal akhir');
  const dayCount = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;

  if (dayCount < 1) {
    const error = new Error('Tanggal akhir tidak boleh mendahului tanggal awal');
    error.statusCode = 400;
    throw error;
  }
  if (dayCount > MAX_RANGE_DAYS) {
    const error = new Error(`Rentang periode maksimal ${MAX_RANGE_DAYS} hari`);
    error.statusCode = 400;
    throw error;
  }

  return { start, end, dayCount };
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function buildDateRange(tanggalMulai, tanggalAkhir) {
  const { start, dayCount } = validateDateRange(tanggalMulai, tanggalAkhir);
  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return formatIsoDate(date);
  });
}

function sumDailyHm(harian) {
  return Object.values(harian || {}).reduce((total, value) => {
    const numericValue = Number(value || 0);
    return total + (Number.isFinite(numericValue) ? numericValue : 0);
  }, 0);
}

function validateJamOperasi(value) {
  const jam = Number(value);
  if (!Number.isFinite(jam) || jam < 0) {
    const error = new Error('Jam HM harian harus berupa angka 0 atau lebih');
    error.statusCode = 400;
    throw error;
  }
  return jam;
}

async function createHmDailySchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS database_hm_harian (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tanggal DATE NOT NULL,
      jam_operasi NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (jam_operasi >= 0),
      keterangan TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, tanggal)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_database_hm_harian_user_tanggal
    ON database_hm_harian (user_id, tanggal)
  `);

  // Migrasi kompatibel satu arah. Data baru tidak pernah ditimpa oleh data legacy.
  await pool.query(`
    INSERT INTO database_hm_harian (user_id, tanggal, jam_operasi, keterangan)
    SELECT
      user_id,
      tanggal,
      GREATEST(0, SUM(COALESCE(total_hm, 0))) AS jam_operasi,
      NULLIF(STRING_AGG(NULLIF(TRIM(keterangan), ''), '; '), '') AS keterangan
    FROM database_hm
    WHERE user_id IS NOT NULL
    GROUP BY user_id, tanggal
    ON CONFLICT (user_id, tanggal) DO NOTHING
  `);
}

async function ensureHmDailySchema(pool) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = createHmDailySchema(pool).catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}

module.exports = {
  MAX_RANGE_DAYS,
  buildDateRange,
  validateDateRange,
  validateJamOperasi,
  sumDailyHm,
  ensureHmDailySchema,
};
