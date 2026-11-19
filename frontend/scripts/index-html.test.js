// Accesibilidad de src/index.html (el runner de Angular no lee este archivo).
// Se ejecuta con: npm run test:scripts
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');

test('el idioma de la página es español', () => {
  assert.match(html, /<html[^>]*\blang="es"/);
});

test('el viewport permite hacer zoom (WCAG 1.4.4)', () => {
  const viewport = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/)?.[1];
  assert.ok(viewport, 'falta el meta viewport');
  assert.match(viewport, /width=device-width/);
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*(no|0)/);
  assert.doesNotMatch(viewport, /maximum-scale/);
});
