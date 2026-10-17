'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const spo = fs.readFileSync(path.join(__dirname, 'spo.core.js'), 'utf8');
const production = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');

assert.match(spo, /\/api\/admin\/production\/master/, 'SPO must load JOB choices from Production Master');
assert.match(spo, /jobCode:selected\?\.job_code/, 'SPO planningData must persist canonical Master JOB code');
assert.match(spo, /deployedJobs\.push/, 'SPO planningData must expose only deployed JOB references');
assert.match(spo, /productionMode/, 'SPO planningData must persist Prod or Non Prod classification');
assert.match(spo, /data-spo-production-select/, 'SPO draft must use a single production classification select');
assert.match(spo, /data-spo-production-value/, 'deployed SPO must render its classification as a read-only value');
assert.doesNotMatch(spo, /data-spo-production-choice/, 'SPO must not render separate Prod and Non Prod buttons');
assert.match(spo, /klasifikasi Prod atau Non Prod/i, 'SPO deploy must require production classification');
assert.match(spo, /key==='ob removal'/, 'legacy OB Removal must map safely to Master JOB OB');
assert.match(spo, /expectedOptions=masterJobs\.length\+1\+\(hasUnresolvedLegacy\?1:0\)/, 'unresolved legacy JOB option count must be idempotent');
assert.match(spo, /\^job\$\/i\.test\(value\)\?'':value/, 'blank draft JOB label must not become an unresolved legacy JOB');
assert.doesNotMatch(spo, /spoJobObserved[\s\S]{0,900}observe\(root,\{childList:true,subtree:true\}\)/, 'SPO JOB observer must not watch all period-cell mutations');
assert.match(spo, /<select data-spo-job/, 'new SPO tables must render Master JOB select directly');
assert.match(spo, /loadMasterStandbyCodes/, 'SPO must load its parameter benchmark from Master Standby Codes');
assert.match(spo, /standbyCodeId/, 'SPO planningData must persist the Standby Code identity');
assert.match(spo, /version:8/, 'SPO material-type mapping must use structured planningData v8');
assert.match(spo, /data-spo-material-select/, 'SPO Prod draft must provide the OB/Coal material type selector');
assert.match(spo, /materialType/, 'SPO planningData must persist authoritative material type');
assert.match(spo, /<select data-spo-event/, 'new SPO parameter rows must use a Standby Code dropdown');
assert.doesNotMatch(spo, /<input data-spo-event/, 'new SPO parameter rows must not allow free-text parameter names');
assert.match(spo, /syncDeployedParameterLock/, 'deployed SPO must lock parameter identities in the UI');
assert.match(spo, /data-spo-event-value/, 'deployed SPO must replace the parameter dropdown with a read-only value');
assert.match(spo, /Hanya jam delay yang dapat diubah/, 'deployed parameter lock must explain the permitted change');
assert.match(production, /muatJobSpoDeployed/, 'Fleet modal must use deployed SPO JOB loader');
assert.match(production, /scope: 'production'/, 'Fleet JOB loader must request only SPO Prod jobs');
assert.match(production, /Pilih JOB Prod dari SPO/, 'Fleet JOB placeholder must state its production scope');
assert.match(production, /select id="ffJob" class="input-filter" required/, 'Fleet JOB selection must be mandatory');

console.log('SPO and Ritase JOB integration tests passed');
