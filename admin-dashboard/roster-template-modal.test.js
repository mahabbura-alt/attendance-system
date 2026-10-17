'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');

test('Template Roster uses its own enlarged responsive modal shell', () => {
  const app = read('app.js');
  const css = read('style.css');
  const html = read('index.html');
  assert.match(app, /function bukaModalTemplateRoster\(\)/);
  assert.match(app, /class="roster-template-modal"/);
  assert.match(css, /#modalKonten:has\(\.roster-template-modal\) \{ width:min\(760px,94vw\);/);
  assert.match(css, /min-height:360px/);
  assert.match(css, /@media\(max-width:640px\)\{#modalKonten:has\(\.roster-template-modal\)/);
  assert.match(html, /style\.css\?v=65/);
  assert.match(html, /app\.js\?v=47/);
});
