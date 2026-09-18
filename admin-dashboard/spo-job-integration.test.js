'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const spo = fs.readFileSync(path.join(__dirname, 'spo.core.js'), 'utf8');
const production = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');

assert.match(spo, /\/api\/admin\/production\/master/, 'SPO must load JOB choices from Production Master');
assert.match(spo, /jobCode:selected\?\.job_code/, 'SPO planningData must persist canonical Master JOB code');
assert.match(spo, /deployedJobs\.push/, 'SPO planningData must expose only deployed JOB references');
assert.match(spo, /key==='ob removal'/, 'legacy OB Removal must map safely to Master JOB OB');
assert.match(spo, /expectedOptions=masterJobs\.length\+1\+\(hasUnresolvedLegacy\?1:0\)/, 'unresolved legacy JOB option count must be idempotent');
assert.match(spo, /\^job\$\/i\.test\(value\)\?'':value/, 'blank draft JOB label must not become an unresolved legacy JOB');
assert.doesNotMatch(spo, /spoJobObserved[\s\S]{0,900}observe\(root,\{childList:true,subtree:true\}\)/, 'SPO JOB observer must not watch all period-cell mutations');
assert.match(spo, /<select data-spo-job/, 'new SPO tables must render Master JOB select directly');
assert.match(production, /muatJobSpoDeployed/, 'Fleet modal must use deployed SPO JOB loader');
assert.match(production, /Pilih JOB dari SPO Deployed/, 'Fleet JOB placeholder must state its authoritative source');
assert.match(production, /select id="ffJob" class="input-filter" required/, 'Fleet JOB selection must be mandatory');

console.log('SPO and Ritase JOB integration tests passed');
