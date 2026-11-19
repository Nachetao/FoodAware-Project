import { Generator } from '@angular/service-worker/config';
import type { Config, Filesystem } from '@angular/service-worker/config';
import config from '../../../ngsw-config.json';
import { presentarVeredicto } from '../products/models/veredicto';

// Lo que hace el service worker de Angular con los dataGroups: el Generator
// convierte cada patrón de ngsw-config.json en un regex sin anclar, y el
// worker lo prueba contra la URL completa de la petición (con la query). Este
// test usa el mismo Generator, así que falla si un patrón deja entrar a la
// caché una respuesta con datos personales.

// Los dos montajes que usamos: en staging la API está en otro origen que la
// app; con npm run pwa:local, en el mismo (proxy de /api).
const ORIGENES: Array<[string, string]> = [
  ['staging, otro origen', 'https://foodaware-staging-backend.onrender.com'],
  ['pwa:local, mismo origen', 'http://localhost:8080'],
];

const PUBLICOS: Array<[string, string]> = [
  ['/api/products/search?q=leche&limit=20&offset=0', 'catalogo-publico'],
  ['/api/products/7801234000018', 'catalogo-publico'],
  ['/api/products/78012340', 'catalogo-publico'],
  ['/api/metricas/calidad', 'metricas-publicas'],
  ['/api/metricas/evaluacion', 'metricas-publicas'],
  ['/api/ingesta/ultima', 'metricas-publicas'],
];

const PERSONALES = [
  '/api/usuarios',
  '/api/usuarios/me',
  '/api/auth/login',
  '/api/users',
  '/api/products/search/personalizada?q=leche&modo=filtrar&limit=20&offset=0',
  '/api/products/compatibles?q=leche',
  '/api/products/7801234000018/compatibilidad',
  '/api/food',
  '/api/food/analizar',
  '/api/health',
];

const sinArchivos: Filesystem = {
  list: async () => [],
  read: async () => '',
  hash: async () => '',
  write: async () => undefined,
};

interface GrupoDatos {
  name: string;
  patterns: string[];
  strategy: string;
}

async function gruposDeDatos(): Promise<GrupoDatos[]> {
  const manifiesto = (await new Generator(sinArchivos, '/').process(config as Config)) as {
    dataGroups: GrupoDatos[];
  };
  return manifiesto.dataGroups;
}

/** Nombre del dataGroup que guardaría la respuesta, o null si va directo a la red. */
async function grupoQueGuarda(url: string): Promise<string | null> {
  const grupo = (await gruposDeDatos()).find((g) =>
    g.patterns.some((patron) => new RegExp(patron).test(url)),
  );
  return grupo?.name ?? null;
}

describe('ngsw-config.json: qué respuestas del backend se guardan', () => {
  describe.each(ORIGENES)('API en %s (%s)', (_montaje, origen) => {
    it.each(PUBLICOS)('guarda el endpoint público %s (%s)', async (ruta, grupo) => {
      await expect(grupoQueGuarda(`${origen}${ruta}`)).resolves.toBe(grupo);
    });

    it.each(PERSONALES)('nunca guarda %s (datos personales o con token)', async (ruta) => {
      await expect(grupoQueGuarda(`${origen}${ruta}`)).resolves.toBeNull();
    });
  });

  it('prioriza la red: la caché solo responde si la red falla o tarda', async () => {
    for (const grupo of await gruposDeDatos()) {
      expect(grupo.strategy).toBe('freshness');
    }
  });
});

describe('ngsw-config.json: precarga para funcionar sin conexión', () => {
  const archivosDe = (grupo: string) =>
    (config.assetGroups.find((g) => g.name === grupo)?.resources.files ?? []) as string[];

  // Ionic descarga cada ícono la primera vez que se usa, antes de que el
  // service worker controle la página: si no se precarga, falta sin conexión.
  it.each([
    ...(['apto', 'apto_con_advertencia', 'no_apto'] as const).map((v) => presentarVeredicto(v).icono),
    'cloud-offline-outline',
    'download-outline',
    'search-outline',
    'stats-chart-outline',
    'person-circle-outline',
    'shield-checkmark-outline',
  ])('precarga el ícono %s', (icono) => {
    expect(archivosDe('iconos')).toContain(`/svg/${icono}.svg`);
  });

  it('precarga la interfaz, el manifiesto y la fuente', () => {
    expect(archivosDe('app')).toEqual(
      expect.arrayContaining(['/index.html', '/manifest.webmanifest', '/*.js', '/*.css', '/media/inter-latin-*.woff2']),
    );
  });
});
