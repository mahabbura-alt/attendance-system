const { pool } = require('../config/db');

const AUTO_CHECKOUT_HOURS = 13;

/**
 * Tutup sesi nyata yang tidak di-checkout setelah melewati 13 jam.
 * userId opsional: tanpa userId seluruh sesi kedaluwarsa akan diproses.
 */
async function autoCloseExpiredSessions(userId = null) {
  const params = [];
  let userFilter = '';
  if (userId) {
    params.push(userId);
    userFilter = `AND user_id = $${params.length}`;
  }

  const { rows } = await pool.query(
    `UPDATE absensi
     SET waktu_pulang = waktu_datang + INTERVAL '${AUTO_CHECKOUT_HOURS} hours',
         status_pulang = 'checkout lewat',
         updated_at = now()
     WHERE waktu_pulang IS NULL
       AND waktu_datang IS NOT NULL
       AND waktu_datang < now() - INTERVAL '${AUTO_CHECKOUT_HOURS} hours'
       ${userFilter}
     RETURNING id, user_id, waktu_datang, waktu_pulang, status_pulang`,
    params
  );

  if (rows.length) {
    console.log(`[Auto Checkout] Closed ${rows.length} session(s) older than ${AUTO_CHECKOUT_HOURS} hours`);
  }
  return rows;
}

module.exports = { AUTO_CHECKOUT_HOURS, autoCloseExpiredSessions };
