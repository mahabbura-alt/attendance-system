const HM_EXCLUDED_JABATAN = 'driver sarana';

function normalizeJabatan(jabatan) {
  return String(jabatan || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isJabatanEligibleForHm(jabatan) {
  return normalizeJabatan(jabatan) !== HM_EXCLUDED_JABATAN;
}

module.exports = { isJabatanEligibleForHm };
