# Contrato FastAPI ↔ NestJS

Contrato HTTP entre `backend/` (NestJS) y `python-service/` (FastAPI) para la EP2.
La fuente de verdad es el código (modelos Pydantic en `python-service/app/schemas/`);
[`fastapi-openapi.json`](fastapi-openapi.json) se genera desde ahí.

> **Productos, búsqueda e ingesta ya son reales** (Open Food Facts + caché local
> SQLite), con limpieza de ingredientes, detección de alérgenos, validación de
> calidad y ranking BM25. **Las métricas siguen siendo stubs** hasta el Bloque 5:
> devuelven datos de ejemplo y responden con el header `X-Stub: true`.

### Cómo se obtienen los datos

- **Fuente:** API pública de Open Food Facts. Lectura de producto con
  `/api/v3/product/{código}` y búsqueda estructurada por país y categoría con
  `/api/v2/search`, pidiendo solo los campos necesarios (`fields`).
- **Límites:** el servicio se queda bajo los oficiales (15 lecturas y 10
  búsquedas por minuto por IP): como máximo 12 lecturas y 8 búsquedas por minuto.
  Reintenta hasta 3 veces con backoff exponencial y jitter solo ante errores de
  red, timeouts, 429 y 5xx.
- **`/search` nunca consulta Open Food Facts en vivo:** busca en un índice en
  memoria construido desde la caché local, que se llena con `POST /ingest/runs`.
  Solo se indexan productos válidos (ver [Búsqueda](#búsqueda-score-bm25)).
- **`/products/{codigo_barras}`** lee primero la caché; si no está, lo trae de
  Open Food Facts y lo guarda. Si la fuente falla y no está en la caché,
  responde 503 o 504. Una petición nunca espera al limitador de tasa más de
  `LIMITADOR_ESPERA_MAX_SEGUNDOS` (3 por defecto): si tendría que esperar más,
  responde de inmediato 503 `SOURCE_UNAVAILABLE` con el mensaje "Se alcanzó el
  límite de consultas a Open Food Facts; intenta de nuevo en N s".
- Requiere `OFF_USER_AGENT` en `.env` (formato `AppName/Version (correo)`); sin
  él, los endpoints que necesitan la fuente responden 503.

### Estrategia de actualización

| Variable | Por defecto | Efecto |
|---|---|---|
| `INGESTA_AL_INICIAR` | `true` | Si la caché está vacía al arrancar, lanza una ingesta inicial. |
| `INGESTA_INTERVALO_HORAS` | `24` | Refresco periódico; la próxima se calcula desde el inicio de la última ejecución, así un reinicio no la pospone. |
| `CACHE_TTL_HORAS` | `72` | Un producto verificado hace más de este tiempo se refresca al pedirlo si la fuente responde; si no, se devuelve el de la caché. |
| `INGESTA_CATEGORIAS` | ver abajo | Categorías de Open Food Facts de las ingestas automáticas, separadas por comas (máximo 20; vacío = sin filtrar). |
| `INGESTA_MAX_PRODUCTOS` | `500` | Tope de productos de cada ingesta automática (1 a 500). |

Las ingestas automáticas buscan productos de Chile en las categorías de
`INGESTA_CATEGORIAS`, elegidas por ser relevantes para alergias: galletas
(`en:biscuits`), lácteos (`en:dairies`), panes (`en:breads`), chocolates
(`en:chocolates`), cereales (`en:breakfast-cereals`), snacks salados
(`en:salty-snacks`; `en:snacks` ya incluye galletas y chocolates) y bebidas
vegetales (`en:plant-based-milk-alternatives`). No se lanzan si ya hay una en
curso. Para probar contra la API real (fuera del pipeline):
`python scripts/probar_off.py` desde `python-service/`. Para ver cómo quedó el
corpus: `python scripts/estadisticas_corpus.py` (productos válidos, productos por
categoría, términos distintos del índice y largo promedio).

## Levantar el servicio

```powershell
docker compose up --build -d python-service
```

- Swagger UI: http://localhost:8000/docs
- OpenAPI en vivo: http://localhost:8000/openapi.json
- Desde el contenedor de NestJS, la URL base es `PYTHON_API_URL` (`http://python-service:8000`).

## Endpoints

| Método | Ruta | Respuesta | Errores | Estado |
|---|---|---|---|---|
| GET | `/health` | `{"status", "service"}` | — | real |
| POST | `/analizar` | análisis por reglas (sin cambios) | 422 nativo de FastAPI | real |
| GET | `/products/{codigo_barras}` | `Producto` | 404, 422, 500, 503, 504 | real |
| GET | `/search?q=&limit=&offset=` | `RespuestaBusqueda` | 422, 500 | real |
| POST | `/ingest/runs` | `ResumenIngesta` (202, `en_curso`) | 422, 500, 503 | real |
| GET | `/ingest/runs/latest` | `ResumenIngesta` | 404, 500 | real |
| GET | `/metrics/quality` | `MetricasCalidad` | 500 | stub |
| GET | `/metrics/evaluation` | `MetricasEvaluacion` | 500 | stub |

Parámetros de búsqueda: `q` de 2 a 100 caracteres, `limit` de 1 a 50 (10 por
defecto), `offset` ≥ 0. Códigos de barras: 8 a 14 dígitos.

`/search` declara 503 y 504 en OpenAPI, pero hoy no los produce porque no
consulta la fuente. `estado_fuente` vale `"online"` si la última ingesta
terminada fue `completado` o `completado_con_errores`, y `"cache"` si fue
`fallido` o si todavía no hay ninguna.

### Búsqueda (score BM25)

- **Tokenización** (la misma para productos y consultas): minúsculas, sin
  tildes, singular básico y sin stopwords. "Galletas de AVENA" y "galleta avena"
  dan los mismos términos; una consulta solo con stopwords ("de la") no
  devuelve resultados.
- **Índice:** un índice invertido por campo (término → productos y cuántas
  veces aparece, más el largo de cada producto y el largo promedio). Se arma en
  memoria al iniciar el servicio y se reconstruye al terminar cada ingesta; las
  búsquedas en curso usan el índice anterior hasta que el nuevo está listo. Un
  producto traído con `GET /products` aparece en la búsqueda desde la siguiente
  reconstrucción.
- **Score:** suma ponderada de Okapi BM25 por campo (`k1 = 1.5`, `b = 0.75`):

  ```text
  score = 3·BM25(nombre) + 2·BM25(marca) + 1·BM25(ingredientes) + 1.5·BM25(categorías)

  BM25(campo) = Σ_t  idf(t) · tf·(k1+1) / (tf + k1·(1 − b + b·largo/largo_promedio))
  idf(t)      = ln(1 + (N − df + 0.5) / (df + 0.5))
  ```

  Un término raro pesa más que uno común (idf), repetirlo suma cada vez menos
  (k1) y una mención en un texto largo vale menos que en uno corto (b). Las
  categorías salen del payload crudo de Open Food Facts (no son parte de
  `Producto`).
- **Resultados:** solo con `score > 0`, redondeado a 4 decimales. Orden por
  `score` descendente; en empate, `calidad.completitud` descendente y luego
  `codigo_barras`. `total` cuenta todas las coincidencias antes de paginar,
  `posicion` es global (con `offset=10`, el primero es el 11) y `tiempo_ms` es
  lo que tardó la búsqueda en el servicio. Con el índice vacío responde 200 con
  `total: 0` y `resultados: []`.

**Ingesta:** `POST /ingest/runs` responde 202 con la ejecución `en_curso` y la
procesa en segundo plano; el resultado se consulta en `GET /ingest/runs/latest`.
Si ya hay una en curso, devuelve esa misma en lugar de lanzar otra. Con
`categorias`, hace una búsqueda por categoría y reparte `max_productos` entre
ellas: a cada una le toca lo que queda dividido por las categorías restantes
(500 entre 7 = 72, 72, 72, 71, 71, 71, 71), así lo que no usa una categoría con
pocos productos pasa a las siguientes. Un producto que aparece en dos
categorías se procesa y se guarda una sola vez, y su repetición no gasta la
cuota de la segunda categoría, pero sí se cuenta: suma a `recuperados` y, si es
válido, a `validos` y `duplicados` (si es inválido, a `invalidos`). Por eso
`recuperados` puede superar a `max_productos`, que limita los productos
distintos. Si una categoría falla, se registra el error y sigue con las demás. Todas las búsquedas respetan el límite de 8 por
minuto. Al terminar:
`recuperados` (descargados), `validos`, `invalidos` (no cumplen las reglas de
validez de `calidad`; no se guardan), `duplicados` (válidos que ya estaban con el mismo
contenido), `errores` (peticiones a la fuente que fallaron) y `estado`. Una
ejecución interrumpida por un reinicio queda como `fallido`.

## Errores

Los endpoints del contrato responden siempre con esta forma:

```json
{"error": {"codigo": "NOT_FOUND", "mensaje": "Producto 7800000000000 no encontrado", "request_id": "3f2b8c1e-..."}}
```

| Código | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Parámetros o cuerpo inválidos |
| `NOT_FOUND` | 404 | Producto, ejecución o ruta inexistente |
| `SOURCE_UNAVAILABLE` | 503 | Open Food Facts no responde |
| `SOURCE_TIMEOUT` | 504 | Open Food Facts excede el timeout |
| `INTERNAL_ERROR` | 500 | Error no controlado (sin detalles internos) |

`/`, `/health` y `/analizar` conservan los errores nativos de FastAPI (`{"detail": ...}`)
porque NestJS ya los consume.

## Headers

| Header | Dirección | Uso |
|---|---|---|
| `X-Request-ID` | petición y respuesta | Si NestJS lo envía, se devuelve igual (letras, números, `.`, `_`, `-`, máx. 128); si no, se genera un uuid4. También va en `error.request_id`. |
| `X-Stub` | respuesta | `true` en endpoints que aún devuelven datos de ejemplo (hoy, solo `/metrics/*`). |
| `X-Simular-Error` | petición | Solo con `SIMULAR_ERRORES_HABILITADO=true` en `.env`. Valores: `SOURCE_UNAVAILABLE` (503), `SOURCE_TIMEOUT` (504), `INTERNAL_ERROR` (500). Funciona en los endpoints del contrato (no en `/`, `/health` ni `/analizar`); no aparece en OpenAPI. |

## Códigos de alérgenos (`AllergenCode`)

Sin tildes: `lacteos`, `gluten`, `huevo`, `mani`, `frutos_secos`, `soya`, `pescado`,
`crustaceos`, `moluscos`, `sesamo`, `mostaza`, `apio`, `sulfitos`, `altramuces`.

Etiquetas de dieta (`DietLabel`): `vegano`, `vegetariano`, `sin_gluten`, `sin_lactosa`.

`alergenos` y `trazas` son la unión de las etiquetas de Open Food Facts y de lo
detectado en el texto de ingredientes (sinónimos en español e inglés, con
excepciones como "leche de coco" o "manteca de cacao" y negaciones como "sin
gluten"). Lo que sigue a "puede contener", "trazas de" o "elaborado en una línea
que procesa" va a `trazas`. Ante la duda se marca el alérgeno. Lo detectado
solo en el texto queda en `calidad.problemas` como
`alergeno_detectado_en_texto:<código>` o `traza_detectada_en_texto:<código>`.

## Calidad (`calidad`)

`es_valido` es `false` si aparece alguno de estos problemas:

| Problema | Regla |
|---|---|
| `sin_nombre` | La fuente no trae nombre (`nombre` queda como "Producto <código>"). |
| `sin_ingredientes` | La fuente no trae texto de ingredientes. |
| `ingredientes_vacios` | Hay texto, pero tras limpiarlo no queda ningún ingrediente. |
| `codigo_barras_longitud_invalida` | No es EAN-8, UPC-A ni EAN-13 (8, 12 o 13 dígitos). |
| `codigo_barras_digito_verificador_invalido` | El dígito verificador GS1 no coincide. |

Los demás problemas solo informan: `sin_marca`, `sin_cantidad`, `sin_nutriscore`,
`sin_imagen`, `alergenos_no_reconocidos`, `alergeno_detectado_en_texto:<código>`,
`traza_detectada_en_texto:<código>`, `alergeno_posible:<código>` (indicio sin
confirmar, como la lecitina E322 sin origen: no va en `alergenos`) y
`posible_duplicado:<código de barras>` (mismo nombre, marca y cantidad
normalizados con otro código; ninguno se descarta). `completitud` es la fracción
de nombre, marca, cantidad, ingredientes limpios, Nutri-Score e imagen presentes.

**Reprocesamiento:** la caché guarda el payload crudo de Open Food Facts y la
versión de procesamiento de cada producto. Al iniciar, el servicio rehace desde
ese payload los productos procesados con una versión anterior, sin consultar la
fuente. A mano: `python scripts/reprocesar_cache.py [--todos]` desde
`python-service/` (o con `docker compose exec python-service ...`).

`/analizar` todavía devuelve `"lácteos"` y `"maní"` con tilde; para cruzarlo con
estos códigos, NestJS debe normalizarlos.

## Convenciones

- Campos en español `snake_case`.
- Fechas en ISO 8601 UTC con `Z` (`2026-10-20T14:30:00Z`).
- Campos opcionales llegan como `null`; las listas vacías, como `[]`.

## Regenerar el contrato

Después de cambiar un esquema o endpoint, desde `python-service/`:

```powershell
python scripts/export_openapi.py
```
