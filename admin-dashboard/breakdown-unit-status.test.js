'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(__dirname, 'production.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const routes = fs.readFileSync(path.join(__dirname, '../backend/src/routes/production.routes.js'), 'utf8');

test('Breakdown page contains grouped Update Status Unit board below release table', () => {
  const releaseIndex = html.indexOf('tbodyProdBreakdownCompleted');
  const boardIndex = html.indexOf('breakdownUnitStatusTitle');
  assert.ok(releaseIndex >= 0 && boardIndex > releaseIndex);
  assert.match(html, /Populasi berdasarkan jenis unit/i);
  assert.match(html, /data-unit-status-summary="Ready"/);
  assert.match(html, /data-unit-status-summary="BD"/);
});

test('equipment-type indicators expose separate Ready and BD counts', () => {
  assert.match(source, /Ready \$\{group\.ready\}/);
  assert.match(source, /BD \$\{group\.breakdown\}/);
  assert.match(source, /breakdownTypeIndicators/);
});

test('board includes quick breakdown, detail/history, compact/detail view, quality reconciliation, and no polling', () => {
  assert.match(source, /bukaModalInputBreakdown\('\$\{escapeMinePlanning\(unit\.equipmentId\)\}'\)/);
  assert.match(source, /bukaBreakdownUnitHistory/);
  assert.match(source, /bukaBreakdownUnitDataQuality/);
  assert.match(source, /setBreakdownUnitStatusView/);
  assert.match(css, /breakdown-unit-status-groups\.is-compact/);
  assert.doesNotMatch(source, /setInterval\([^)]*muatBreakdownUnitStatus/);
});

test('dedicated authenticated current and history API routes are registered before dynamic breakdown routes', () => {
  const current = routes.indexOf("'/breakdown/unit-status/current'");
  const history = routes.indexOf("'/breakdown/unit-status/:equipmentId/history'");
  const statusWrite = routes.indexOf("'/breakdown/:id/status'");
  assert.ok(current >= 0 && history > current && statusWrite > history);
});

