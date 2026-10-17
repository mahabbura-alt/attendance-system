'use strict';

/**
 * Eskalasi hazard lewat batas sekali jalan (cadangan bila worker di dalam app dimatikan, HSE_ESCALATION=off).
 *   node backend/src/scripts/run_hse_escalation.js
 */
require('dotenv').config();
const { pool } = require('../config/db');
const { escalateOverdueActions } = require('../services/hseMobile');

escalateOverdueActions(pool)
  .then(r => console.log(`Tindak lanjut lewat batas yang dieskalasi: ${r.escalated}`))
  .catch(err => { console.error('Gagal eskalasi:', err.code || err.message); process.exitCode = 1; })
  .finally(() => pool.end().catch(() => {}));
