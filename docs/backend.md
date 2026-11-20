# Backend (NestJS)

API principal de FoodAware. Recibe las peticiones del frontend, consulta al servicio FastAPI (que obtiene y prepara los datos de Open Food Facts), guarda los productos en PostgreSQL y relaciona esos datos con el perfil de cada usuario.

- **Stack:** NestJS 10, TypeORM, PostgreSQL, Passport JWT, nestjs-pino, Swagger.
- **Puerto:** `PORT` (3000 por defecto). Prefijo global `/api`.
- **Documentación interactiva:** Swagger en `/docs` (expuesto también en staging, a propósito, para la evaluación).

## Flujo general

```
Frontend ──► NestJS ──► FastAPI ──► Open Food Facts
               │
               └──► PostgreSQL (products, users)
```

1. El frontend llama a `GET /api/products/search?q=…`.
2. NestJS reenvía la consulta al `/search` de FastAPI, con `X-Request-ID`, timeout y reintentos.
3. Guarda los productos recibidos en `products` (upsert por código de barras).
4. Si FastAPI no responde, busca en `products` y responde con los datos guardados (respaldo).

## Módulos

| Módulo | Responsabilidad |
|---|---|
| `products` | Cliente de FastAPI, búsqueda, detalle, guardado (upsert), respaldo y compatibilidad con el usuario |
| `metricas` | Expone las métricas de calidad, evaluación e ingesta de FastAPI |
| `salud` | `GET /api/health` con chequeo real de PostgreSQL y FastAPI |
| `users` | Registro, perfil y alergias del usuario |
| `auth` | Login, estrategia JWT y guard global con `@Public()` |
| `ia` / `foods` | Análisis de un producto ingresado a mano (`/api/food/analizar`), heredado de la EP1 |
| `observabilidad` | Logs JSON, middleware `X-Request-ID` e interceptor de tiempo de respuesta |
| `config` | Puerto, CORS y configuración compartida entre `main.ts` y las pruebas |

## Endpoints

### Públicos

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del backend y sus dependencias (ver `docs/observabilidad.md`) |
| POST | `/api/auth/login` | Devuelve `access_token` (JWT, 1 h). Máximo 5 intentos por minuto por IP |
| POST | `/api/users` | Registro. Contraseña de al menos 8 caracteres. No devuelve la contraseña; 409 si el correo existe |
| GET | `/api/products/search?q=&limit=&offset=` | Búsqueda de productos (vía FastAPI, con respaldo) |
| GET | `/api/products/:codigo_barras` | Detalle de un producto (vía FastAPI, con respaldo) |
| POST | `/api/food/analizar` | Analiza un producto ingresado a mano; usa el usuario del token si viene |
| GET | `/api/metricas/calidad` | Métricas de calidad de los datos |
| GET | `/api/metricas/evaluacion` | Métricas de evaluación de la búsqueda (Precision@K, Recall@K) |
| GET | `/api/ingesta/ultima` | Resumen de la última ingesta |

### Protegidos (JWT `Authorization: Bearer <token>`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/usuarios/me` | Perfil del usuario autenticado |
| PUT | `/api/usuarios/me/alergias` | Reemplaza las alergias (códigos `AllergenCode`) |
| GET | `/api/products/:codigo_barras/compatibilidad` | `{ apto, alergenos_en_conflicto, trazas_en_conflicto }` |
| GET | `/api/products/compatibles?q=&limit=&offset=` | Productos guardados sin los alérgenos del usuario |
| GET | `/api/food` | Lista de análisis guardados |

### Formato de errores

Todos los errores de `/api/products/*`, `/api/metricas/*` e `/api/ingesta/*` siguen el contrato:

```json
{ "error": { "codigo": "SOURCE_UNAVAILABLE", "mensaje": "…", "request_id": "…" } }
```

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Parámetros inválidos (por ejemplo, `q` con menos de 2 caracteres) |
| `NOT_FOUND` | 404 | Producto o ingesta inexistente |
| `SOURCE_UNAVAILABLE` | 503 | FastAPI no responde y no hay respaldo |
| `SOURCE_TIMEOUT` | 504 | FastAPI no respondió a tiempo y no hay respaldo |
| `INTERNAL_ERROR` | 500 / 502 | Error interno o respuesta de FastAPI fuera del contrato |
| `TOO_MANY_REQUESTS` | 429 | Límite de peticiones por IP en `GET /api/products/:codigo_barras` (solo de NestJS; FastAPI no lo usa) |

El resto de las rutas (login, registro, análisis) usa el formato por defecto de NestJS, también para el 429:

```json
{ "statusCode": 429, "message": "Demasiados intentos, espera un minuto.", "error": "Too Many Requests" }
```

## Variables de entorno

| Variable | Obligatoria | Por defecto | Descripción |
|---|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Sí | — | Conexión a PostgreSQL |
| `JWT_SECRET` | **Sí** | — | Firma de los tokens. Sin ella, el backend no arranca |
| `PYTHON_API_URL` | Sí | `http://localhost:8000` | URL interna de FastAPI |
| `PYTHON_API_TIMEOUT_MS` | No | `2000` | Timeout por intento hacia FastAPI |
| `PYTHON_API_REINTENTOS` | No | `2` | Reintentos ante errores transitorios (0 los desactiva) |
| `PORT` | No | `3000` | Puerto de escucha (Render lo asigna) |
| `CORS_ORIGINS` | No | `http://localhost:4200,http://localhost:8100` | Orígenes permitidos, separados por comas |
| `LOG_LEVEL` | No | `info` | Nivel mínimo de los logs |
| `LIMITE_LOGIN_POR_MINUTO` | No | `5` | Intentos de `POST /api/auth/login` por minuto y por IP |
| `LIMITE_PUBLICO_POR_MINUTO` | No | `30` | Peticiones por minuto y por IP en `POST /api/users`, `POST /api/food/analizar` y `GET /api/products/:codigo_barras` |

## Persistencia

### Tabla `products`

Guarda los productos recibidos de FastAPI con su procedencia:

- **Clave primaria:** `codigo_barras` (`CHECK` de 8 a 14 dígitos).
- **Datos:** `nombre`, `marca`, `cantidad`, `ingredientes_texto`, `ingredientes` (`text[]`), `alergenos` (`text[]`), `trazas` (`text[]`), `etiquetas_dieta` (`text[]`), `nutriscore` (`CHECK` a–e), `imagen_url`.
- **Procedencia:** `fuente`, `url_fuente`, `recuperado_en`, `modificado_en_fuente`, `run_id`, `hash_contenido`.
- **Calidad:** `es_valido`, `problemas` (`text[]`), `completitud`.
- **Propias:** `creado_en`, `actualizado_en`.

Las listas usan `text[]` (no `simple-array`) para admitir comas dentro de un ingrediente.

**Sin duplicados:** cada búsqueda guarda los productos con un único `INSERT … ON CONFLICT (codigo_barras) DO UPDATE`, que solo actualiza si el dato entrante no es más antiguo (`recuperado_en`). Así, un dato de la caché de FastAPI no pisa uno más nuevo. Si el guardado falla, se registra en el log y el usuario igual recibe los resultados.

### Índices

| Índice | Uso |
|---|---|
| PK `codigo_barras` | Upsert y detalle |
| GIN `alergenos` | Filtrar por alérgenos (`alergenos && $1`) en `/compatibles` |
| GIN `trazas` | Filtrar por trazas |
| GIN `etiquetas_dieta` | Filtrar por dieta (`@>`) |
| Parcial `WHERE es_valido` sobre `(completitud DESC, codigo_barras)` | Respaldo y compatibles, ya ordenados |

Verificados con `EXPLAIN` (Bitmap Index Scan / Index Only Scan).

### Tabla `users`

`id`, `nombre`, `correo` (único), `password` (bcrypt) y `alergias` (`text[]` con códigos `AllergenCode`).

### Relación con los datos externos

Los alérgenos de cada producto (de Open Food Facts) se cruzan con las alergias del usuario (datos propios) en `/compatibilidad` y `/compatibles`. Ver `docs/capacidad-adaptativa.md`.

### Migraciones

Corren solas al arrancar (`migrationsRun: true`, `synchronize: false`). Manualmente:

```bash
cd backend
npm run migration:run      # aplicar
npm run migration:revert   # revertir la última
```

## Robustez frente a FastAPI

- **Timeout** de 2 s por intento.
- **Reintentos** con backoff (250 ms y 500 ms, con jitter) ante falta de conexión, timeout y 502/503/504. Nunca ante 4xx ni 500.
- **Respaldo desde la base:** si FastAPI falla con 500/502/503/504 tras los reintentos, la búsqueda y el detalle responden con los productos guardados, con `estado_fuente: "cache"` y el header `X-Fuente-Datos: respaldo`. Si la base no tiene resultados, se mantiene el error original.
- Con FastAPI caído, la búsqueda responde en ~0,8 s; en el peor caso (timeouts), ~7 s.

## Seguridad

- Guard JWT global con `@Public()` para las rutas públicas.
- `ValidationPipe` con `whitelist` y `forbidNonWhitelisted`: se rechazan los campos no declarados.
- Contraseñas con bcrypt; nunca se devuelven en las respuestas. Al registrarse se exigen al menos 8 caracteres (`@MinLength(8)` en `CreateUserDto`). El login no exige largo mínimo, para que las cuentas creadas antes de la regla sigan entrando.
- **Límite de peticiones por IP** (`@nestjs/throttler`, riesgo P1 de [modelo-amenazas.md](modelo-amenazas.md#5-riesgos-pendientes)):

  | Ruta | Límite por minuto y por IP | Contra qué |
  |---|---|---|
  | `POST /api/auth/login` | 5 (`LIMITE_LOGIN_POR_MINUTO`) | Fuerza bruta de contraseñas (S1) |
  | `POST /api/users` | 30 (`LIMITE_PUBLICO_POR_MINUTO`) | Creación de cuentas en masa (D3) |
  | `POST /api/food/analizar` | 30 (`LIMITE_PUBLICO_POR_MINUTO`) | Llenar la base, porque cada llamada guarda una fila (D2) |
  | `GET /api/products/:codigo_barras` | 30 (`LIMITE_PUBLICO_POR_MINUTO`) | Gastar el límite de lecturas a Open Food Facts (D1) |

  - Se aplica con el decorador `@LimitarPeticiones("login" | "publico")` ([`seguridad/limite-peticiones.ts`](../backend/src/seguridad/limite-peticiones.ts)); las demás rutas, incluida la búsqueda, no tienen límite. Cada ruta lleva su propio contador: fallar el login no bloquea el registro.
  - Al superarlo responde **429** con "Demasiados intentos, espera un minuto." y el header `Retry-After` (segundos). El formato es el mismo que el resto de los errores de esa ruta: el de NestJS en login, registro y análisis, y el del contrato (`TOO_MANY_REQUESTS`) en el detalle de producto. El log registra `limite_peticiones_superado` con el request id y la ruta, sin la IP ni el cuerpo.
  - **IP real:** en Render las peticiones llegan por su proxy, así que `configurar-app.ts` activa `trust proxy` con un salto: `req.ip` sale de `X-Forwarded-For` y no es la IP del proxy. Sin esto, todos los usuarios compartirían un mismo contador.
  - Los límites se leen en cada petición, así que basta cambiar la variable de entorno en Render (sin tocar el código) si hace falta subirlos, por ejemplo en una demo con muchas personas detrás de la misma red, que comparten IP.
  - El contador vive en memoria: alcanza para la única instancia de staging, se reinicia con cada despliegue y, con varias instancias, cada una contaría por su lado (habría que pasar a Redis).
- CORS restringido con `CORS_ORIGINS`.
- Imagen Docker `node:22-alpine`, sin npm ni npx en la etapa final, ejecutada como usuario `node`. Trivy (CRITICAL) sin hallazgos.
- `overrides` de `multer` (^2.5.0) y `body-parser` (^1.20.9) para corregir vulnerabilidades altas.

## Pruebas

| Suite | Comando | Cantidad | Qué cubre |
|---|---|---|---|
| Unitarias | `npm test` | 338 | Servicios, controladores, guards (JWT, roles y límite de peticiones), mapper, normalización, configuración |
| Integración | `npm run test:integration` | 92 (~50 s) | App NestJS real contra un FastAPI simulado (`node:http`), sin PostgreSQL |

La suite de integración cubre: búsqueda y guardado, `X-Request-ID`, validación, reintentos y respaldo ante 503, FastAPI apagado, timeout, `/api/health` (ok, degradado, error), `X-Response-Time-ms`, métricas, detalle, perfil, alergias, compatibilidad, 401 sin token y el límite de peticiones ([`limite-peticiones.int-spec.ts`](../backend/test/integracion/limite-peticiones.int-spec.ts): el sexto login en un minuto responde 429, otra IP en `X-Forwarded-For` no queda bloqueada y el detalle responde `TOO_MANY_REQUESTS`). Corre en el CI sin Docker.

Cada archivo de integración levanta su propia app, así que los contadores del límite no se comparten entre archivos, y las pruebas del límite usan una IP distinta en `X-Forwarded-For` en cada caso. Si una prueba futura necesita más intentos, se puede subir el límite con las variables de entorno.

## Ejecución local

```bash
docker compose up -d db python-service
cd backend
npm ci
DB_HOST=localhost DB_PORT=5433 PYTHON_API_URL=http://localhost:8000 npm run start:dev
```

## Evidencia

| Captura | Muestra |
|---|---|
| `docs/evidencia/respaldo-chocolate.png` | Búsqueda con FastAPI caído: respuesta desde la base con aviso |
| `docs/evidencia/compatibles-swagger.png` | `/compatibles` con alergia a lácteos: 9 de 32 chocolates |

## Limitaciones

- Quedan vulnerabilidades altas en `@nestjs/swagger` y herramientas de desarrollo, y una moderada en `@nestjs/core`; se corrigen solo subiendo Nest a la versión 12 (cambio mayor).
- La búsqueda del respaldo es más simple que BM25 (coincidencia por inicio de palabra con pesos por campo); su score no es comparable con el de FastAPI.
- Si la primera página viene de FastAPI y "Cargar más" cae al respaldo, el orden entre páginas puede no coincidir.
- `/compatibles` solo busca entre los productos ya guardados.
- `/api/food/analizar` y la entidad `Food` vienen de la EP1 y no forman parte del flujo principal de la EP2.
