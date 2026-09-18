'use strict';

// Regression tests untuk bug roster: ubahan per-hari ke S/M "kembali ke CP"
// setelah disimpan (OMOS).
//
// Akar masalah: pada cabang re-anchor S/M di applyRosterDailyOverride, baris
// roster ber-source='manual_override' (mis. CP dari Import Excel atau reset CP
// sebelumnya) pada tanggal yang diubah tidak dihapus, dan generateRosterRange
// hanya menimpa baris ber-source='generated'. Akibatnya nilai S/M hasil
// re-anchor terblokir oleh baris CP manual sehingga tampak "kembali ke CP".
//
// Perbaikan: seluruh proyeksi mulai tanggal yang diubah dihapus, sehingga nilai
// S/M hasil re-anchor konsisten dengan preview dan dapat mengganti sisa CP.
// Override manual yang ditimpa disalin ke audit log sebelum penghapusan.
//
// Pola pengujian mengikuti test lain di repo (regex atas source file, tanpa
// koneksi database / DOM runtime).

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const controller = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'controllers', 'rosterController.js'),
  'utf8'
);

// --- Override manual yang akan ditimpa harus dibaca untuk audit ---
assert.match(
  controller,
  /SELECT tanggal::text,status,catatan\s+FROM employee_roster_daily\s+WHERE user_id=\$1 AND tanggal >= \$2::date AND source='manual_override'/,
  'cabang re-anchor S/M harus merekam override manual yang akan ditimpa'
);

// --- Seluruh jadwal mulai tanggal re-anchor harus diregenerasi ---
assert.match(
  controller,
  /DELETE FROM employee_roster_daily\s+WHERE user_id=\$1 AND tanggal >= \$2::date/,
  're-anchor S/M harus menghapus seluruh proyeksi dari tanggal yang dipilih'
);

assert.match(
  controller,
  /superseded_manual_overrides: supersededManualOverridesResult\.rows/,
  'nilai override lama harus disertakan dalam audit re-anchor'
);

assert.match(
  controller,
  /replacementEffectiveTo = continuationResult\.rows\[0\]\?\.effective_to_iso \|\| null/,
  're-anchor dalam celah CP harus mewarisi horizon assignment reset berikutnya'
);

console.log('Roster S/M override manual-CP regression tests passed');
