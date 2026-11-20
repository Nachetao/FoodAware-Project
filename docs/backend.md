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
2. NestJS reenvía la consulta al `/search` de FastAPI, con `X-Request-ID`, `X-Clave-Servicio`, timeout y reintentos.
3. Guarda los productos recibidos en `products` (upsert por código de barras).
4. Si FastAPI no responde, busca en `products` y responde con los datos guardados (respaldo).

Con sesión iniciada, la compatibilidad de un producto y la búsqueda personalizada usan además el motor adaptativo de FastAPI, al que el backend le envía solo el perfil del usuario (ver [Motor adaptativo](#motor-adaptativo)).

## Módulos

| Módulo | Responsabilidad |
|---|---|
| `products` | Cliente de FastAPI, búsqueda, detalle, guardado (upsert), respaldo, y compatibilidad y búsqueda personalizada con el motor adaptativo |
| `metricas` | Expone las métricas de calidad, evaluación e ingesta de FastAPI |
| `salud` | `GET /api/health` con chequeo real de PostgreSQL y FastAPI |
| `users` | Registro, perfil (alergias, dietas, modo estricto), borrado de cuenta, lista de usuarios para administradores y rol |
| `auth` | Login, estrategia JWT (validada contra la base), guards globales (`@Public()`, `@Roles()`) |
| `ia` / `foods` | Análisis de un producto ingresado a mano (`POST /api/food/analizar`, público) y lista de análisis guardados (`GET /api/food`, solo administradores). Vienen de la EP1 |
| `seguridad` | Límite de peticiones por IP e IP real del cliente |
| `scripts` | `admin:asignar`, para crear administradores |
| `observabilidad` | Logs JSON, middleware `X-Request-ID` e interceptor de tiempo de respuesta |
| `config` | Puerto, CORS y configuración compartida entre `main.ts` y las pruebas |

## Endpoints

### Públicos

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/health` | Estado del backend y sus dependencias (ver `docs/observabilidad.md`) |
| POST | `/api/auth/login` | Devuelve `access_token` (JWT, 1 h). Máximo 5 intentos por minuto por IP |
| POST | `/api/users` | Registro. Contraseña de al menos 8 caracteres. No devuelve la contraseña; 409 si el correo existe |
| GET | `/api/products/search?q=&limit=&offset=` | Búsqueda de productos (vía FastAPI, con respaldo). Responde el header `X-Fuente-Datos` |
| GET | `/api/products/:codigo_barras` | Detalle de un producto (vía FastAPI, con respaldo). Máximo 30 peticiones por minuto por IP |
| POST | `/api/food/analizar` | Analiza un producto ingresado a mano; usa el usuario del token si viene |
| GET | `/api/metricas/calidad` | Métricas de calidad de los datos |
| GET | `/api/metricas/evaluacion` | Métricas de evaluación de la búsqueda (Precision@K, Recall@K) |
| GET | `/api/ingesta/ultima` | Resumen de la última ingesta |

### Protegidos (JWT `Authorization: Bearer <token>`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/usuarios/me` | Perfil: `id`, `nombre`, `correo`, `alergias`, `dietas`, `modo_estricto` y `rol` |
| PATCH | `/api/usuarios/me` | Edita solo los campos que vienen: `nombre`, `alergias`, `dietas` y `modo_estricto`. El correo, la contraseña y el rol no se pueden cambiar (400) |
| DELETE | `/api/usuarios/me` | Borra la cuenta y sus datos (204). Desde ese momento su token responde 401 |
| PUT | `/api/usuarios/me/alergias` | **Obsoleto**, se usa `PATCH /api/usuarios/me`. Reemplaza las alergias (códigos `AllergenCode`) |
| GET | `/api/products/:codigo_barras/compatibilidad` | Veredicto del motor adaptativo para el perfil del usuario: `veredicto`, `apto`, `explicacion`, `confianza`, `conflictos`… |
| GET | `/api/products/search/personalizada?q=&modo=&limit=&offset=` | Búsqueda con el perfil del usuario. `modo`: `filtrar` (por defecto, oculta los no aptos) o `reordenar` (los deja al final) |
| GET | `/api/products/compatibles?q=&limit=&offset=` | Solo los productos "apto", en modo estricto, con la forma de `/search`. **Disponible, pero el frontend ya no lo usa**: usa la búsqueda personalizada |

### Solo administradores (rol `administrador`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/usuarios` | Lista de usuarios: `id`, `nombre`, `correo` y `rol`. Sin contraseña ni alergias |
| GET | `/api/food` | Lista de análisis guardados |

Un usuario con rol `usuario` recibe **403** en estas rutas; sin token, 401.

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
| `CLAVE_SERVICIO` | En staging y Docker Compose | — | Clave que el backend envía a FastAPI en `X-Clave-Servicio`. FastAPI la exige en esos entornos (`CLAVE_SERVICIO_OBLIGATORIA=true`); si falta o no coincide responde 403 y el backend usa su respaldo. Es secreta: no se escribe en el repositorio y los logs la redactan |
| `DB_SSL` | No | `false` | `true` para conectarse (migraciones y `admin:asignar`) a una base que exige TLS |
| `PORT` | No | `3000` | Puerto de escucha (Render lo asigna) |
| `RENDER_GIT_COMMIT`, `GIT_COMMIT` | No | — | Commit que se muestra en `GET /api/health` (Render define la primera en cada despliegue) |
| `CORS_ORIGINS` | No | `http://localhost:4200,http://localhost:8100` | Orígenes permitidos, separados por comas |
| `LOG_LEVEL` | No | `info` | Nivel mínimo de los logs |
| `LIMITE_LOGIN_POR_MINUTO` | No | `5` | Intentos de `POST /api/auth/login` por minuto y por IP |
| `LIMITE_PUBLICO_POR_MINUTO` | No | `30` | Peticiones por minuto y por IP en `POST /api/users`, `POST /api/food/analizar` y `GET /api/products/:codigo_barras` |
| `SALTOS_PROXY` | No | `2` | Proxies delante del backend que agregan una IP a `X-Forwarded-For` (en Render, Cloudflare y su load balancer). Entero de 0 a 5; un valor inválido, incluido `true`, usa 2 |
| `IP_DESDE_CLOUDFLARE` | No | `true` | El límite de peticiones identifica al cliente por `CF-Connecting-IP` cuando viene con una IP válida. Solo `false` lo apaga (si el backend no está detrás de Cloudflare) |
| `DIAGNOSTICO_PROXY` | No | `false` | Con `true`, las rutas con límite escriben el log `diagnostico_proxy` (sin IPs) para revisar qué IP usa el límite |

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
| GIN `alergenos`, `trazas` y `etiquetas_dieta` | **Hoy sin uso.** Se crearon en la EP2 para filtrar `/compatibles` en SQL (`alergenos && $1`); desde que la compatibilidad considera trazas, dietas y modo estricto, el respaldo aplica la regla local en TypeScript sobre las coincidencias por texto y ninguna consulta los usa ([ADR 0004](adr/0004-postgresql-typeorm.md#consecuencias)) |
| Parcial `WHERE es_valido` sobre `(completitud DESC, codigo_barras)` | Coincide con el filtro `es_valido` de la búsqueda de respaldo y de las coincidencias de `/compatibles` y la búsqueda personalizada |

En la EP2 los verificamos con `EXPLAIN` (Bitmap Index Scan / Index Only Scan), cuando `/compatibles` filtraba en SQL; después del cambio a la regla local no lo volvimos a comprobar.

### Tabla `users`

| Columna | Tipo | Descripción |
|---|---|---|
| `id` | `uuid` | Clave primaria |
| `nombre` | `text` | |
| `correo` | `text` | Único |
| `password` | `text` | Hash bcrypt; nunca se devuelve |
| `alergias` | `text[]` | Códigos `AllergenCode`. Por defecto `{}` |
| `dietas` | `text[]` | Códigos `DietLabel`. Por defecto `{}` |
| `modo_estricto` | `boolean` | Por defecto `false`. Con `true`, las trazas, los indicios y los datos insuficientes hacen el producto no apto |
| `rol` | enum `rol_usuario` | `usuario` (por defecto) o `administrador` |

Las columnas `rol`, `dietas` y `modo_estricto` llegaron con las migraciones [`RolUsuarios`](../backend/src/migrations/1795109522236-RolUsuarios.ts) y [`PerfilDietasModoEstricto`](../backend/src/migrations/1795111067195-PerfilDietasModoEstricto.ts). Los usuarios que ya existían quedan como `usuario`, sin dietas y sin modo estricto.

### Relación con los datos externos

Los alérgenos de cada producto (de Open Food Facts) se cruzan con el perfil del usuario (datos propios) en el motor adaptativo de FastAPI. Ver [Motor adaptativo](#motor-adaptativo) y [capacidad-adaptativa.md](capacidad-adaptativa.md).

### Migraciones

Corren solas al arrancar (`migrationsRun: true`, `synchronize: false`). Manualmente:

```bash
cd backend
npm run migration:run      # aplicar
npm run migration:revert   # revertir la última
```

## Roles

Hay dos roles ([`users/rol.ts`](../backend/src/users/rol.ts)): `usuario` y `administrador`.

- **Todo registro nace como `usuario`.** La API no permite cambiar el rol: `POST /api/users` y `PATCH /api/usuarios/me` rechazan el campo (400).
- **El administrador se asigna con un script**, la única forma de crearlo ([`scripts/asignar-admin.ts`](../backend/src/scripts/asignar-admin.ts)). El usuario ya debe estar registrado:

  ```bash
  cd backend
  npm run admin:asignar -- ana@correo.cl            # pasa a administrador
  npm run admin:asignar -- ana@correo.cl --quitar   # vuelve a usuario
  ```

  Usa las variables `DB_*` (del entorno o del `.env`, `DB_SSL=true` si la base exige TLS), igual que las migraciones. La persona debe volver a iniciar sesión, porque el rol viaja en el token.
- **El JWT se valida contra la base en cada petición** ([`jwt.strategy.ts`](../backend/src/auth/jwt.strategy.ts)). El token lleva `sub`, `correo` y `rol`, pero `JwtStrategy` busca al usuario y exige que exista y que su rol sea el mismo del token. Si borró su cuenta o le cambiaron el rol, el token responde 401 aunque no haya vencido (dura 1 h).
- **`@Roles(Rol.ADMINISTRADOR)`** restringe una ruta o un controlador. `RolesGuard`, global y posterior al guard JWT, responde **403** a los demás roles. Las rutas sin `@Roles` solo piden un token válido. Hoy son de administrador `GET /api/usuarios` y `GET /api/food`.

## Perfil del usuario

El perfil son el nombre, las **alergias** (`AllergenCode`), las **dietas** (`DietLabel`) y el **modo estricto**.

- `PATCH /api/usuarios/me` cambia solo los campos que vienen. Las listas se reemplazan completas (`[]` las borra). El nombre se recorta y no puede quedar vacío (100 caracteres como máximo). Con `forbidNonWhitelisted`, cualquier otro campo (correo, contraseña, rol) responde 400.
- `DELETE /api/usuarios/me` borra al usuario con todos sus datos y responde 204. No quedan datos de salud asociados a esa persona.
- El administrador ve la lista de usuarios sin alergias ni dietas: `GET /api/usuarios` solo devuelve `id`, `nombre`, `correo` y `rol`.

## Motor adaptativo

La decisión de compatibilidad la toma FastAPI (`POST /products/{codigo}/compatibility` y `POST /search/personalized`, contrato en [contratos/README.md](contratos/README.md)). El backend la pide, adapta la respuesta y usa un respaldo si el motor no responde. Ver [capacidad-adaptativa.md](capacidad-adaptativa.md).

- **Perfil sin identidad:** el backend lee `alergias`, `dietas` y `modo_estricto` del usuario del token y envía solo eso. Nunca viajan su id, nombre, correo ni rol.
- **Compatibilidad:** `GET /api/products/:codigo_barras/compatibilidad` devuelve el veredicto del motor (`apto`, `apto_con_advertencia` o `no_apto`) con su explicación, confianza, conflictos y aviso orientativo, más el campo `apto`, que es `true` solo con veredicto `apto`.
- **Búsqueda personalizada:** `GET /api/products/search/personalizada` devuelve el ranking del motor: primero los aptos, después `apto_con_advertencia` y al final los `no_apto`. En `filtrar` los no aptos se ocultan, y en las dos modalidades `no_aptos` cuenta cuántos hay y por qué. También trae la interpretación de la consulta (por ejemplo, "sin leche"), la comparación con `/search` y el aviso.
- **`/compatibles`:** sigue disponible, pero el frontend ya no lo usa. Pide al motor la búsqueda personalizada en modo `filtrar` con el modo estricto activado solo en esa llamada, para ocultar también las trazas y los datos insuficientes, y devuelve solo los `apto`. Como con dietas el motor también devuelve `apto_con_advertencia` (dieta no declarada), `total` cuenta solo los `apto` pidiendo como máximo 5 páginas extra al motor; si llega al tope, `total` es lo contado.
- **Respaldo local** ([`compatibilidad-local.ts`](../backend/src/products/compatibilidad-local.ts), [`respaldo-local.ts`](../backend/src/products/respaldo-local.ts)): si el motor falla (500, 502, 503 o 504 tras los reintentos), el backend aplica una revisión básica del perfil (alergias, dietas y modo estricto) a los productos guardados. La respuesta lleva `X-Fuente-Datos: respaldo` y `estado_fuente: "cache"`. Ante la duda es conservadora: la confianza es baja (con `evaluacion_de_respaldo` en `motivos_confianza`) y **nunca devuelve `apto`**. La búsqueda personalizada de respaldo no interpreta las restricciones de la consulta y devuelve `comparacion: null`. El orden y los no aptos salen de la misma regla del veredicto, así que no se contradicen.
- **Header `X-Fuente-Datos`:** `fastapi` o `respaldo`, en la búsqueda, el detalle, la compatibilidad, la búsqueda personalizada y `/compatibles`. CORS lo expone para que el frontend lo lea.
- **Clave entre servicios:** todas las llamadas a FastAPI llevan `X-Clave-Servicio` (`CLAVE_SERVICIO`). Los POST del motor también se reintentan, porque no guarda estado.

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
  - **IP real:** en Render todas las peticiones pasan por Cloudflare y por el load balancer de Render ([artículo de Render](https://render.com/articles/how-render-handles-ddos-attacks)). El límite identifica al cliente así ([`seguridad/ip-cliente.ts`](../backend/src/seguridad/ip-cliente.ts)):
    1. **`CF-Connecting-IP`**, si viene y trae exactamente una IP válida (IPv4 o IPv6). Cloudflare lo arma con la IP de la conexión del cliente y recomienda leerlo en vez de `X-Forwarded-For` ([documentación de Cloudflare](https://developers.cloudflare.com/fundamentals/reference/http-headers/)). Se desactiva con `IP_DESDE_CLOUDFLARE=false`.
    2. **`req.ip`** en cualquier otro caso: sin el header, vacío, con algo que no es una IP o con varias. Sale de `X-Forwarded-For` con `trust proxy` en `SALTOS_PROXY` saltos (2 por defecto, [`config/proxy-confiable.ts`](../backend/src/config/proxy-confiable.ts)).

    Por qué no basta con `X-Forwarded-For`:
    - **Con un salto**, `req.ip` era la IP de Cloudflare y clientes de redes distintas compartían el contador.
    - **Con dos saltos** funciona para un navegador, que no manda el header. Pero la prueba en staging mostró que un cliente que manda su propio `X-Forwarded-For` logra que `req.ip` sea la IP que inventó: con una distinta en cada intento, el sexto login no respondía 429. Render no documenta cómo arma este header, así que no sirve para seguridad.
    - **Nunca se usa `trust proxy` en `true`**: tomaría la IP de la izquierda, que el cliente elige.

    Suposiciones y casos límite:
    - **Todo el tráfico pasa por Cloudflare.** Cloudflare advierte que, si se acepta tráfico que no viene de él, el header se puede falsificar. Render dice que todo el tráfico entrante de sus web services pasa por Cloudflare. Si el backend se despliega en otro lado sin Cloudflare, hay que poner `IP_DESDE_CLOUDFLARE=false`.
    - **IPv6:** el contador agrupa las IPv6 por prefijo /64, como hace `@nestjs/throttler`.
    - **Workers de Cloudflare:** las peticiones que llegan desde un Worker de otra zona traen una IP fija de Cloudflare y comparten un contador.
    - **En local** no hay Cloudflare: un cliente podría escribir `CF-Connecting-IP` o `X-Forwarded-For` y elegir su IP. Solo importa en Render.
    - **Para revisar qué IP se usa** sin escribirla en los logs está el log `diagnostico_proxy` ([observabilidad.md](observabilidad.md#diagnóstico-de-la-ip-del-cliente-diagnostico_proxy)).
  - Los límites se leen en cada petición, así que basta cambiar la variable de entorno en Render (sin tocar el código) si hace falta subirlos, por ejemplo en una demo con muchas personas detrás de la misma red, que comparten IP.
  - El contador vive en memoria: alcanza para la única instancia de staging, se reinicia con cada despliegue y, con varias instancias, cada una contaría por su lado (habría que pasar a Redis).
- CORS restringido con `CORS_ORIGINS`.
- Imagen Docker `node:22-alpine`, sin npm ni npx en la etapa final, ejecutada como usuario `node`. Trivy (CRITICAL) sin hallazgos.
- `overrides` de `multer` (^2.5.0) y `body-parser` (^1.20.9) para corregir vulnerabilidades altas.

## Pruebas

| Suite | Comando | Cantidad | Qué cubre |
|---|---|---|---|
| Unitarias | `npm test` | 432 | Servicios, controladores, guards (JWT, roles y límite de peticiones), IP del cliente, mapper, normalización, compatibilidad y respaldo local, `X-Clave-Servicio`, redacción de logs, script `admin:asignar`, configuración (incluido `trust proxy`) |
| Integración | `npm run test:integration` | 99 (~55 s) | App NestJS real contra un FastAPI simulado (`node:http`), sin PostgreSQL |
| PostgreSQL real | `npm run test:postgres` | 30 (~11 s) | App NestJS real contra PostgreSQL, con FastAPI simulado. Cada ejecución crea una base temporal y la borra al terminar |

Cifras del 20 de noviembre de 2026. La suite `test:postgres` **no corre en el CI**: se ejecuta a mano, con la base de Docker Compose:

```bash
docker compose up -d db     # PostgreSQL en localhost:5433
cd backend
npm run test:postgres
```

Toma `DB_USER` y `DB_PASSWORD` del `.env` de la raíz; en otro servidor se definen `PRUEBA_DB_HOST`, `PRUEBA_DB_PORT`, `PRUEBA_DB_USER` y `PRUEBA_DB_PASSWORD`. Nunca toca la base de la aplicación (`foodaware_db`): se detiene si `DB_NAME` no es la base temporal que creó. Cubre lo que el FastAPI simulado y los mocks no ven: que las migraciones se apliquen sobre una base vacía y dejen un esquema igual al de las entidades, el enum `rol_usuario` (la base rechaza un rol desconocido), el upsert condicionado por `recuperado_en`, el SQL de la búsqueda de respaldo (pesos, inicio de palabra, acentos, paginación), el correo único (409), las dietas y alergias como arreglos reales, y la sesión: el borrado de cuenta, el ascenso y la degradación de un administrador después del login (el token deja de servir).

La suite de integración cubre: búsqueda y guardado, `X-Request-ID`, validación, reintentos y respaldo ante 503, FastAPI apagado, timeout, `/api/health` (ok, degradado, error), `X-Response-Time-ms`, métricas, detalle, perfil, alergias, compatibilidad, búsqueda personalizada, `X-Clave-Servicio`, 401 sin token y el límite de peticiones ([`limite-peticiones.int-spec.ts`](../backend/test/integracion/limite-peticiones.int-spec.ts): el sexto login en un minuto responde 429, otro cliente detrás de la misma IP de Cloudflare no queda bloqueado, inventar la IP de la izquierda de `X-Forwarded-For` no evita el 429, con `SALTOS_PROXY=1` se reproduce el contador compartido, con el mismo `CF-Connecting-IP` un `X-Forwarded-For` distinto en cada intento recibe 429 en el sexto, dos `CF-Connecting-IP` distintos no comparten contador, sin el header o con uno inválido se usa `req.ip`, `IP_DESDE_CLOUDFLARE=false` ignora el header y el detalle responde `TOO_MANY_REQUESTS`). Corre en el CI sin Docker.

Cada archivo de integración levanta su propia app, así que los contadores del límite no se comparten entre archivos, y las pruebas del límite usan una IP de cliente distinta en cada caso, con `X-Forwarded-For` armado como en Render (`<cliente>, <Cloudflare>`). Si una prueba futura necesita más intentos, se puede subir el límite con las variables de entorno.

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
| `docs/evidencia/compatibles-swagger.png` | `/compatibles` con alergia a lácteos: 9 de 32 chocolates (de la EP2, cuando filtraba en SQL; hoy usa el motor) |

## Limitaciones

- Quedan vulnerabilidades altas en `@nestjs/swagger` y herramientas de desarrollo, y una moderada en `@nestjs/core`; se corrigen solo subiendo Nest a la versión 12 (cambio mayor).
- La búsqueda del respaldo es más simple que BM25 (coincidencia por inicio de palabra con pesos por campo); su score no es comparable con el de FastAPI.
- Si la primera página viene de FastAPI y "Cargar más" cae al respaldo, el orden entre páginas puede no coincidir.
- El respaldo de la búsqueda personalizada y de `/compatibles` solo busca entre los productos ya guardados, y nunca marca un producto como `apto`.
- El rol de administrador solo se asigna con el script `admin:asignar`; no hay pantalla ni endpoint para hacerlo.
- Los tokens no se pueden revocar antes de que venzan (1 h), salvo borrando la cuenta o cambiando el rol, que se comparan con la base.
- `/api/food/analizar` y la entidad `Food` vienen de la EP1 y no forman parte del flujo principal de la EP2.
