'use strict';

require('dotenv').config();
const { pool } = require('../config/db');
const Workforce = require('../services/workforce');

Workforce.processDueMovements(pool, process.argv[2])
  .then(results => {
    const failed = results.filter(result => result.status === 'ERROR');
    console.log(JSON.stringify({ processed: results.length, failed: failed.length, results }));
    if (failed.length) process.exitCode = 1;
  })
  .catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => pool.end());
