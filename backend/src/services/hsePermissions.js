'use strict';

/** Izin khusus modul HSE. */

const MERGE_PERMISSION = 'hse.merge';

function hasPermission(user, permission) {
  let perms = user?.permissions;
  if (typeof perms === 'string') {
    try { perms = JSON.parse(perms); } catch (_) { perms = perms.replace(/[{}"]/g, '').split(','); }
  }
  return Array.isArray(perms) && perms.map(p => String(p).trim()).includes(permission);
}

/** Gabung / tolak saran hazard ganda: Admin Utama, atau admin yang diberi izin hse.merge. */
function canMergeHazard(user) {
  if (user?.is_super_admin === true) return true;
  return user?.role === 'admin' && hasPermission(user, MERGE_PERMISSION);
}

function assertCanMergeHazard(user) {
  if (!canMergeHazard(user)) {
    const e = new Error('Anda tidak memiliki izin menggabungkan/menolak laporan hazard ganda (hse.merge).');
    e.statusCode = 403;
    e.code = 'HSE_MERGE_FORBIDDEN';
    e.details = { code: e.code };
    throw e;
  }
}

module.exports = { MERGE_PERMISSION, hasPermission, canMergeHazard, assertCanMergeHazard };
