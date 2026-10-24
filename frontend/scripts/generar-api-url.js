// Genera src/environments/api-url.ts con la URL del backend, tomada de la
// variable API_URL al compilar (por ejemplo, en Render). Sin ella usa
// http://localhost:3000. El archivo generado está en .gitignore: compilar no
// modifica archivos versionados.
const fs = require('fs');
const path = require('path');

const POR_DEFECTO = 'http://localhost:3000';
const valor = (process.env.API_URL || '').trim() || POR_DEFECTO;

if (!/^https?:\/\/[^\s'"`]+$/.test(valor)) {
  console.error(`API_URL no es una URL http(s) válida: "${valor}"`);
  process.exit(1);
}
// Sin barra final: los servicios agregan "/api/...".
const apiUrl = valor.replace(/\/+$/, '');

const destino = path.join(__dirname, '..', 'src', 'environments', 'api-url.ts');
fs.writeFileSync(
  destino,
  '// Generado por scripts/generar-api-url.js desde API_URL. No editar ni versionar.\n' +
    `export const API_URL = '${apiUrl}';\n`,
);
console.log(`API_URL del backend: ${apiUrl}`);
