// Prueba local de la PWA tal como se publica: compila en producción (con
// service worker) y sirve www/ en un solo origen, con proxy hacia el backend
// local. Así no hay CORS y el service worker ve las mismas URL que en un
// despliegue real.
//
//   npm run pwa:local                    compila y sirve en http://localhost:8080
//   npm run pwa:local -- --sin-compilar  solo sirve el www/ que ya existe
//
// Variables opcionales: PUERTO (8080) y BACKEND_URL (http://localhost:3000).
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

const PUERTO = Number(process.env.PUERTO) || 8080;
const BACKEND = new URL(process.env.BACKEND_URL || 'http://localhost:3000');
const RAIZ = path.join(__dirname, '..');
const WWW = path.join(RAIZ, 'www');

// Rutas del backend (NestJS): todos los controladores van bajo el prefijo
// global /api (configurar-app.ts) y Swagger está fuera de él, en /docs
// (main.ts). Todo lo demás es la app: archivos de www/ o rutas de Angular.
const PREFIJOS_BACKEND = ['/api', '/docs'];

// Se revalidan siempre, igual que en nginx.conf.
const SIN_CACHE = new Set([
  '/index.html',
  '/ngsw-worker.js',
  '/ngsw.json',
  '/safety-worker.js',
  '/worker-basic.min.js',
  '/manifest.webmanifest',
]);

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** true para /api, /api/..., /docs, /docs/..., /docs-json y /docs-yaml. */
function esDelBackend(ruta) {
  return PREFIJOS_BACKEND.some(
    (prefijo) => ruta === prefijo || ruta.startsWith(`${prefijo}/`) || ruta.startsWith(`${prefijo}-`),
  );
}

function compilar() {
  const entorno = { ...process.env, API_URL: `http://localhost:${PUERTO}` };
  const pasos = [
    [path.join(RAIZ, 'scripts', 'generar-api-url.js')],
    [require.resolve('@angular/cli/bin/ng.js', { paths: [RAIZ] }), 'build', '--configuration', 'production'],
  ];
  for (const argumentos of pasos) {
    const { status } = spawnSync(process.execPath, argumentos, { cwd: RAIZ, env: entorno, stdio: 'inherit' });
    if (status !== 0) {
      process.exit(status ?? 1);
    }
  }
}

function proxy(req, res) {
  const destino = new URL(req.url, BACKEND);
  const peticion = http.request(
    destino,
    { method: req.method, headers: { ...req.headers, host: BACKEND.host } },
    (respuesta) => {
      res.writeHead(respuesta.statusCode ?? 502, respuesta.headers);
      respuesta.pipe(res);
    },
  );
  peticion.on('error', (error) => {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: `El backend local (${BACKEND.origin}) no responde: ${error.code ?? error.message}` }));
  });
  req.pipe(peticion);
}

function servirArchivo(ruta, res) {
  let archivo = path.resolve(WWW, `.${ruta}`);
  const dentroDeWww = archivo === WWW || archivo.startsWith(WWW + path.sep);
  const existe = dentroDeWww && fs.existsSync(archivo) && fs.statSync(archivo).isFile();
  if (!existe) {
    // Un archivo que no existe es 404; una ruta de Angular (/home, /producto/…) es la app.
    if (!dentroDeWww || path.extname(ruta) !== '') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }
    archivo = path.join(WWW, 'index.html');
    ruta = '/index.html';
  }
  res.writeHead(200, {
    'Content-Type': TIPOS[path.extname(archivo)] ?? 'application/octet-stream',
    'Cache-Control': SIN_CACHE.has(ruta) ? 'no-cache' : 'public, max-age=0',
  });
  fs.createReadStream(archivo).pipe(res);
}

if (!process.argv.includes('--sin-compilar')) {
  compilar();
}
if (!fs.existsSync(path.join(WWW, 'index.html'))) {
  console.error('No hay www/index.html: compila primero (sin --sin-compilar).');
  process.exit(1);
}

http
  .createServer((req, res) => {
    let ruta;
    try {
      ruta = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (esDelBackend(ruta)) {
      proxy(req, res);
    } else {
      servirArchivo(ruta, res);
    }
  })
  .listen(PUERTO, () => {
    console.log(`PWA en http://localhost:${PUERTO} (www/ compilado para producción)`);
    console.log(`Proxy hacia ${BACKEND.origin}: ${PREFIJOS_BACKEND.map((p) => `${p}, ${p}/*`).join(', ')}, /docs-json y /docs-yaml`);
  });
