'use strict';

/**
 * Proses harian OMOS People (jalankan via cron sekali sehari, 00:10 WIB):
 *   1. pergerakan APPROVED yang tanggal efektifnya sudah tiba → EFFECTIVE
 *   2. people_outbox (mis. karyawan keluar → roster setelah hari terakhir dihapus)
 *
 *   node src/scripts/run_people_daily.js              # tanggal hari ini (WIB)
 *   node src/scripts/run_people_daily.js 2026-10-21   # tanggal tertentu
 *
 * Contoh crontab server (zona waktu server UTC → 00:10 WIB = 17:10 UTC):
 *   10 17 * * * cd /opt/omos/backend && node src/scripts/run_people_daily.js >> /var/log/omos/people_daily.log 2>&1
 */
require('dotenv').config();
const { pool } = require('../config/db');
const Daily = require('../services/peopleDaily');

const arg = process.argv[2];
Daily.runDaily(pool, arg ? { today: arg } : {})
  .then((result) => {
    console.log(JSON.stringify(result));
    if (result.movements.failed || result.outbox.failed) process.exitCode = 1;
  })
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => pool.end());
