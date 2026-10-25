# Frontend (Angular + Ionic)

Interfaz de FoodAware. Permite buscar productos reales de Open Food Facts, ver su detalle con alérgenos y procedencia, consultar las métricas del sistema y, con sesión iniciada, saber si cada producto es apto según las alergias del usuario.

- **Stack:** Angular 22 (NgModules, sin zone.js, signals), Ionic 9, Capacitor 8.
- **Puerto local:** 4200 (`npm start`).
- **Comunicación:** solo con el backend NestJS (nunca directamente con FastAPI).

## Páginas

| Ruta | Página | Descripción |
|---|---|---|
| `/home` | Inicio | Análisis manual de un producto (heredado de la EP1). Toolbar con accesos a búsqueda, métricas y sesión |
| `/busqueda` | Búsqueda | Buscador con lista de resultados (imagen, nombre, marca y alérgenos), paginación con "Cargar más" e interruptor "Solo aptos para mí" con sesión |
| `/producto/:codigo` | Detalle | Imagen, Nutri-Score, alérgenos, trazas, dieta, ingredientes, explicación de los alérgenos, procedencia y atribución. Con sesión: "Apto para ti" / "No apto" |
| `/metricas` | Métricas | Calidad de los datos, evaluación de la búsqueda (Precision@K, Recall@K) y última ingesta |
| `/login`, `/registro` | Cuenta | Inicio de sesión y registro con selección de alergias |
| `/perfil` | Perfil (protegida) | Datos del usuario, edición de alergias y cierre de sesión |

## Servicios

| Servicio | Endpoints del backend |
|---|---|
| `ProductsService` | `/api/products/search`, `/api/products/:codigo_barras`, `/compatibilidad`, `/compatibles` |
| `MetricasService` | `/api/metricas/calidad`, `/api/metricas/evaluacion`, `/api/ingesta/ultima` |
| `AuthService` | `/api/auth/login`, `/api/users`, `/api/usuarios/me`, `/api/usuarios/me/alergias` |

Los modelos están tipados según el contrato (`docs/contratos/`), sin `any`.

## Manejo de errores y estados

- Todo error HTTP se convierte en un `ErrorApi` (`status`, `codigo`, `mensaje`, `requestId`): con el mensaje del contrato si viene, "No se pudo conectar con el servidor." si no hay respuesta, o un mensaje genérico en otros casos. Las páginas solo muestran `mensaje`.
- Cada página tiene estados de **carga**, **sin resultados** y **error** (con reintento en el detalle).
- **Aviso de respaldo:** si el backend responde con `X-Fuente-Datos: respaldo`, se muestra "El servicio de búsqueda no está disponible; mostrando productos guardados anteriormente."
- **Servidor dormido:** si la búsqueda tarda más de 5 s (por ejemplo, en el plan gratuito de Render), aparece "Despertando el servidor…".
- En el panel de métricas, cada tarjeta carga y falla por separado; sin ingestas muestra un aviso en vez de un error.

## Sesión

- `AuthService` guarda el token en `localStorage` (con `try/catch`) y expone `autenticado` y `usuario` como signals.
- Un interceptor funcional agrega `Authorization: Bearer` **solo** a las peticiones al backend; ante un 401 con token, cierra la sesión.
- `authGuard` protege `/perfil` y redirige a `/login?volver=<ruta>` (solo rutas internas).
- Sin sesión, la aplicación funciona completa, salvo el perfil y el veredicto personalizado.

## Atribución y procedencia

El detalle de cada producto muestra la fecha de recuperación, un enlace a la ficha original y la atribución exigida por la licencia de los datos:

> Datos de Open Food Facts (openfoodfacts.org), disponibles bajo la licencia Open Database License (ODbL).

## Tema visual

- Paleta propia en las variables de Ionic: fondo crema, verde bosque como color principal, lima solo para el botón principal, ámbar para los alérgenos y rojo para los errores, con contraste AA verificado.
- Fuente Inter empaquetada (`@fontsource-variable/inter`), disponible sin conexión.
- Solo tema claro. `index.html` con `lang="es"` y `translate="no"` para evitar que el navegador traduzca la app y rompa los componentes de Ionic.

## Configuración y build

La URL del backend se define **al compilar** con la variable `API_URL` (por defecto `http://localhost:3000`). El script `scripts/generar-api-url.js` genera `src/environments/api-url.ts` (ignorado por git) antes de `start`, `build`, `test` y `watch`.

```bash
cd frontend
npm ci
API_URL=https://<backend>.onrender.com npm run build   # salida en frontend/www/
```

## Pruebas

```bash
cd frontend
npm test -- --configuration ci
```

121 pruebas (Vitest) de servicios, interceptor, guard, formato y páginas: búsqueda, detalle, métricas, login, registro, perfil y compatibilidad.

## Ejecución local

Con el backend corriendo en `localhost:3000`:

```bash
cd frontend
npm start   # http://localhost:4200
```

## Evidencia

| Captura | Muestra |
|---|---|
| `docs/evidencia/respaldo-chocolate.png` | Aviso de respaldo con resultados desde la base |
| `docs/evidencia/panel-metricas.png` | Panel de métricas con la ingesta completada (P@5 = 56 %) |
| `docs/evidencia/detalle-producto.png` | Detalle con alérgenos, procedencia y atribución ODbL |
| `docs/evidencia/apto-para-ti.png` | Franja "Apto para ti" con sesión iniciada |
| `docs/evidencia/no-apto.png` | Franja "No apto: contiene …" |

## Limitaciones

- La app usa `IonicModule`, que Ionic 9 marca como obsoleto; la migración a `provideIonicAngular()` queda pendiente.
- En desarrollo (`npm start`), después de cambiar de rama o instalar dependencias, el navegador puede mezclar módulos en caché y dejar la página en blanco. Se resuelve borrando `frontend/.angular/cache` y la caché del navegador, o usando una ventana privada. No afecta al build de producción.
- `npm audit` reporta vulnerabilidades altas heredadas de Angular 22.0.1, que se corrigen subiendo a 22.2.3.
- Con el interruptor "Solo aptos para mí" activo, los resultados vienen solo de los productos guardados y no se muestra el aviso de respaldo.
