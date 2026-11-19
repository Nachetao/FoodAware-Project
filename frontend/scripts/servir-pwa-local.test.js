// Pruebas del proxy de npm run pwa:local: el destino nunca sale del backend
// configurado. Se ejecutan con: npm run test:scripts
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { destinoEnBackend, BACKEND } = require('./servir-pwa-local');

test('las rutas del backend van a BACKEND con el mismo path y query', () => {
  for (const ruta of [
    '/api/health',
    '/api/products/search?q=leche&limit=20&offset=0',
    '/api/usuarios/me',
    '/docs',
    '/docs/swagger-ui.css',
    '/docs-json',
  ]) {
    const destino = destinoEnBackend(ruta);
    assert.ok(destino, ruta);
    assert.equal(destino.origin, BACKEND.origin);
    assert.equal(destino.pathname + destino.search, ruta);
  }
});

test('una URL que apunta a otro host nunca se usa como destino', () => {
  for (const url of [
    'http://otro.example/api/health',
    'https://otro.example:8443/api/products/search?q=x',
    '//otro.example/api/health',
    '/\\otro.example/api/health',
    '\\\\otro.example/api/health',
    'otro.example/api/health',
  ]) {
    assert.equal(destinoEnBackend(url), null, url);
  }
});

test('una ruta que no es del backend no se reenvía', () => {
  for (const url of ['/', '/home', '/busqueda?q=leche', '/apix', '/documentos', '/api/../home', '/%61pi/health']) {
    assert.equal(destinoEnBackend(url), null, url);
  }
});

test('las rutas con ".." se resuelven antes de decidir', () => {
  const destino = destinoEnBackend('/docs/../api/health');
  assert.equal(destino?.href, `${BACKEND.origin}/api/health`);
});
