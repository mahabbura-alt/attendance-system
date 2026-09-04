const UNIQUE_INDEX_NAME = 'users_employee_id_normalized_unique';

let uniqueIndexReadyPromise = null;

function normalizeEmployeeId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

async function ensureEmployeeIdUniqueIndex(queryable) {
  await queryable.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${UNIQUE_INDEX_NAME}
    ON users (LOWER(TRIM(employee_id)))
    WHERE NULLIF(TRIM(employee_id), '') IS NOT NULL
  `);
}

async function ensureEmployeeIdSchema(pool) {
  if (!uniqueIndexReadyPromise) {
    uniqueIndexReadyPromise = ensureEmployeeIdUniqueIndex(pool).catch((error) => {
      uniqueIndexReadyPromise = null;
      throw error;
    });
  }
  return uniqueIndexReadyPromise;
}

async function ensureEmployeeIdAvailable(queryable, employeeId, excludeUserId = null) {
  const normalized = normalizeEmployeeId(employeeId);
  if (!normalized) return null;

  const { rows } = await queryable.query(
    `SELECT id, nama
     FROM users
     WHERE LOWER(TRIM(employee_id)) = $1
       AND ($2::uuid IS NULL OR id <> $2::uuid)
     LIMIT 1`,
    [normalized.toLowerCase(), excludeUserId]
  );

  if (rows[0]) {
    const error = new Error(
      `Employee ID ${normalized} sudah digunakan oleh karyawan "${rows[0].nama}"`
    );
    error.statusCode = 409;
    throw error;
  }
  return normalized;
}

function isEmployeeIdUniqueViolation(error) {
  return error?.code === '23505' && (
    error.constraint === UNIQUE_INDEX_NAME ||
    /employee_id/i.test(error.detail || '')
  );
}

module.exports = {
  UNIQUE_INDEX_NAME,
  normalizeEmployeeId,
  ensureEmployeeIdAvailable,
  ensureEmployeeIdUniqueIndex,
  ensureEmployeeIdSchema,
  isEmployeeIdUniqueViolation,
};
