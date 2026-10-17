'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('dashboard static preview routes localhost and LAN port 8080 to backend port 3000', () => {
  const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(app, /window\.location\.port === '8080'/);
  assert.match(app, /requestedMode === 'biznet'/);
  assert.match(app, /http:\/\/127\.0\.0\.1:13000/);
  assert.match(app, /normalizedHost\}:3000/);
  assert.match(html, /app\.js\?v=47/);
});
