const crypto = require('crypto');
const { normalizeEmployeeId } = require('./employeeIdentity');

// Karakter ambigu (0/O, 1/l/I) dihindari agar sandi sementara mudah didiktekan di lapangan.
const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const TEMP_PASSWORD_LENGTH = 10;

let schemaReadyPromise = null;

/**
 * Login menerima Employee ID (OMOS Safety) atau email (aplikasi lama).
 * Employee ID didahulukan bila keduanya dikirim.
 */
function resolveLoginIdentifier(body = {}) {
  const employeeId = normalizeEmployeeId(body.employee_id);
  if (employeeId) return { type: 'employee_id', value: employeeId.toLowerCase() };
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email) return { type: 'email', value: email };
  return null;
}

function generateTemporaryPassword(randomInt = crypto.randomInt) {
  let out = '';
  for (let i = 0; i < TEMP_PASSWORD_LENGTH; i += 1) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(0, TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}

async function ensurePasswordResetSchema(pool) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS password_reset_requests (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'rejected')),
          source VARCHAR(32) NOT NULL DEFAULT 'mobile',
          requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          handled_by UUID REFERENCES users(id) ON DELETE SET NULL,
          handled_at TIMESTAMPTZ
        )`);
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_password_reset_requests_pending
          ON password_reset_requests (user_id) WHERE status = 'pending'`);
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}

module.exports = {
  TEMP_PASSWORD_ALPHABET,
  TEMP_PASSWORD_LENGTH,
  resolveLoginIdentifier,
  generateTemporaryPassword,
  ensurePasswordResetSchema,
};
