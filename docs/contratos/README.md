# Contrato FastAPI ↔ NestJS

Contrato HTTP entre `backend/` (NestJS) y `python-service/` (FastAPI) para la EP2.
La fuente de verdad es el código (modelos Pydantic en `python-service/app/schemas/`);
[`fastapi-openapi.json`](fastapi-openapi.json) se genera desde ahí.

> **Todos los endpoints son reales** (Open Food Facts + caché local SQLite), con
> limpieza de ingredientes, detección de alérgenos, validación de calidad,
> ranking BM25, métricas de calidad de los datos y evaluación de la búsqueda.
> Ninguno devuelve datos de ejemplo.

### Cómo se obtienen los datos

- **Fuente:** API pública de Open Food Facts. Lectura de producto con
  `/api/v3/product/{código}` y búsqueda estructurada por país y categoría con
  `/api/v2/search`, pidiendo solo los campos necesarios (`fields`).
- **Límites:** el servicio se queda bajo los oficiales (15 lecturas y 10
  búsquedas por minuto por IP): como máximo 12 lecturas y 8 búsquedas por minuto.
  Reintenta hasta 3 veces con backoff exponencial y jitter solo ante errores de
  red, timeouts, 429 y 5xx, respetando `Retry-After` si viene. Las lecturas
  parten con 1 s de espera; las búsquedas de la ingesta, con 2 s, porque
  `/api/v2/search` devuelve 503 en ráfagas más largas.
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
| GET | `/metrics/quality` | `MetricasCalidad` | 500 | real |
| GET | `/metrics/evaluation` | `MetricasEvaluacion` | 500 | real |

Parámetros de búsqueda: `q` de 2 a 100 caracteres, `limit` de 1 a 50 (10 por
defecto), `offset` ≥ 0. Códigos de barras: 8 a 14 dígitos.

`/search` declara 503 y 504 en OpenAPI, pero hoy no los produce porque no
consulta la fuente. `estado_fuente` vale `"online"` si la última ingesta
terminada fue `completado` o `completado_con_errores`, y `"cache"` si fue
`fallido` o si todavía no hay ninguna.

### Búsqueda (score BM25)

- **Tokenización** (la misma para productos y consultas): minúsculas, sin
  tildes, singular básico, sin stopwords y con **sinónimos de vocabulario**
  llevados a una forma canónica: variantes regionales (soja → soya, cacahuete →
  maní, yoghurt → yogurt, galletita → galleta, fresa → frutilla, patata → papa)
  y el inglés que mezcla Open Food Facts, cuyas categorías vienen en inglés
  (almond → almendra, milk → leche, biscuits → galleta…). "Galletas de AVENA" y
  "galleta avena" dan los mismos términos, igual que "Bebida de Soja" y
  "bebida de soya"; una consulta solo con stopwords ("de la") no devuelve
  resultados. Los sinónimos son solo equivalencias de palabras encontradas en
  el corpus, no reglas pensadas para alguna consulta.
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
distintos. Si una categoría falla (la fuente sigue fallando tras los reintentos),
sigue con las demás y le reserva la cuota que no alcanzó a usar. Al final, tras
una pausa de 60 s, una segunda ronda reintenta esas categorías desde la página
que falló. `errores` cuenta solo las categorías que siguen fallando en esa
ronda (páginas perdidas de verdad); cada falla, recuperada o no, queda en el
registro de errores de la fuente. Todas las búsquedas respetan el límite de 8 por
minuto. Al terminar:
`recuperados` (descargados), `validos`, `invalidos` (no cumplen las reglas de
validez de `calidad`; no se guardan), `duplicados` (válidos que no aportaron
un producto nuevo: repetidos en la misma ingesta o ya en la caché con el mismo
contenido; ver [Métricas de calidad](#métricas-de-calidad-get-metricsquality)),
`errores` (categorías con páginas perdidas tras el reintento) y `estado`. Una
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

## Métricas de calidad (`GET /metrics/quality`)

**Estrategia de evaluación:** medir el pipeline de datos con los registros reales
que deja cada ingesta (cuántos productos llegaron, cuántos sirven, cuántos se
repiten) y con el estado de la caché (cuántos hay y qué tan recientes son). Las
ingestas se agregan **sumando conteos**, no promediando porcentajes: una ingesta
de 400 productos pesa más que una de 10. Solo cuentan las ejecuciones
terminadas (no `en_curso`).

| Métrica | Definición | Qué indica |
|---|---|---|
| `porcentaje_validos` | Σ `validos` / Σ `recuperados` · 100 | Qué parte de lo que entrega Open Food Facts cumple las reglas mínimas (nombre, ingredientes, código válido). |
| `porcentaje_duplicados` | Σ `duplicados` / Σ `validos` · 100 | Qué parte de los válidos no aportó un producto nuevo. |
| `cobertura_ingredientes` | Σ recuperados con ingredientes utilizables tras limpiar / Σ `recuperados` · 100 | Sin ingredientes no se pueden detectar alérgenos. Solo usa ingestas que registraron este conteo. |
| `antiguedad_promedio_horas` | promedio de horas desde la última verificación de cada producto de la caché contra la fuente | Qué tan al día está la caché (la ingesta periódica y el TTL la refrescan). |
| `total_productos` | productos válidos en la caché | Tamaño del corpus que se busca. |

Los porcentajes van de 0 a 100 con 2 decimales. Sin ingestas terminadas, las
métricas de ingesta valen 0 y las de la caché se calculan igual.

**Los dos tipos de duplicado.** `duplicados` del contrato es la suma de dos
conteos que la caché guarda por separado en cada ejecución:

- **Repetidos en la ingesta:** el mismo producto llegó más de una vez en la
  misma ejecución (por ejemplo, en dos categorías). Se procesa y guarda una vez.
- **Ya estaban en la caché sin cambios:** el producto ya existía con el mismo
  hash de contenido; solo se registra que se volvió a verificar.

Con ingestas periódicas domina el segundo tipo, y es lo esperable: significa que
la caché ya estaba al día, no que haya datos duplicados. La evidencia de que no
se almacenan duplicados es que la caché tiene **0 códigos de barras repetidos**
(cada código es la clave primaria y cada guardado es un upsert). Aparte, los
productos con mismo nombre, marca y cantidad y distinto código se marcan como
`posible_duplicado` sin descartarse.

`python scripts/estadisticas_corpus.py` (desde `python-service/`, o con
`docker compose exec python-service ...`) muestra estas métricas, el desglose de
duplicados, la verificación de códigos repetidos y, de la última ingesta, los
motivos de invalidez y la **tasa de fallas de la fuente**: fallas registradas
sobre páginas pedidas a `/api/v2/search`, separando las categorías que se
recuperaron en el reintento de las que se perdieron. Las ingestas anteriores a
este registro aparecen sin desglose.

## Evaluación de la búsqueda (Precision@K y Recall@K)

**Estrategia de evaluación:** evaluación offline con un conjunto de consultas y
juicios de relevancia, al estilo de los benchmarks de recuperación de
información. Cada consulta se corre contra el mismo índice BM25 que usa
`/search` y se compara su top K con el conjunto de productos relevantes.

**Conjunto de evaluación** (`python-service/app/evaluacion/consultas.json`,
versionado): 20 consultas realistas para una app de alergias en Chile, de dos
tipos que se promedian por separado:

- **Producto** (12): "galletas de avena", "leche de almendras", "chocolate
  amargo", "pan integral", "yogurt natural", "papas fritas", "granola", etc.
- **Restricción** (8): "galletas sin gluten", "chocolate sin leche", "snack sin
  maní", "leche sin lactosa", "pan sin gluten", etc.

La relevancia no se fija con códigos de barras, sino con **reglas verificables
sobre atributos del producto**, que deben cumplirse todas: categorías de Open
Food Facts (`categorias_alguna`), frases en el nombre normalizado
(`nombre_alguno`, `nombre_todos`) y presencia o ausencia de alérgenos
(`con_alergenos`, `sin_alergenos`; la ausencia exige que no esté ni como
ingrediente ni como traza). Por ejemplo, "galletas sin gluten" es relevante si
el producto está en `en:biscuits` y no tiene gluten ni trazas de gluten. Como la
regla se aplica a todo el corpus, se conoce el conjunto completo de relevantes:
el recall es exacto y el conjunto sirve para cualquier corpus. El conjunto se
diseñó revisando el corpus real (categorías y nombres frecuentes).

| Métrica | Definición | Qué responde |
|---|---|---|
| Precision@K | relevantes en el top K / K | De lo que el usuario ve en la primera pantalla, ¿qué parte le sirve? |
| Recall@K | relevantes en el top K / relevantes en el corpus | De todo lo que le serviría, ¿qué parte alcanzó a ver? |
| Promedio macro | promedio simple entre consultas | Cada consulta pesa lo mismo, tenga 2 o 40 relevantes. |

K = 5 por defecto: lo que cabe en una pantalla de celular. Precision@K se divide
por K aunque el buscador devuelva menos resultados. Con pocos relevantes en el
corpus, el máximo posible de P@K es relevantes / K; con muchos, el de R@K es
K / relevantes. Por eso se informan juntas. Las consultas sin relevantes en el
corpus se excluyen del promedio y se informan aparte. También se mide el tiempo
de cada búsqueda.

**Cómo correrla:** `python scripts/evaluar_busqueda.py [--k 5] [--markdown
reporte.md]` desde `python-service/` (o con `docker compose exec python-service
...`). Muestra una tabla por consulta (tipo, relevantes, P@K, R@K, tiempo) y los
promedios por tipo y globales.

**Línea base:** `python-service/app/evaluacion/linea_base.json` guarda el
resultado de la versión 1 del conjunto sobre el corpus real (347 productos), con
BM25 **sin sinónimos**. El reporte compara cada evaluación con ella, consulta
por consulta y por grupo, si usa el mismo K y la misma versión del conjunto
(`--guardar-linea-base` guarda una nueva). Con los sinónimos:

| Grupo | P@5 antes | P@5 ahora | R@5 antes | R@5 ahora |
|---|---:|---:|---:|---:|
| Producto | 0.62 | 0.72 | 0.59 | 0.66 |
| Restricción | 0.25 | 0.20 | 0.23 | 0.22 |
| Global | 0.47 | 0.51 | 0.44 | 0.48 |

Mejoran las consultas cuyo vocabulario no coincidía con el de los productos
("bebida de soya" frente a "Soja …": P@5 de 0.20 a 1.00; "yogurt natural",
"leche de almendras"). Y empeora "bebida vegetal sin soya" (0.40 a 0.00): ahora
"soya" también encuentra las bebidas de soja, que son justo las que hay que
excluir. Mejorar el emparejamiento léxico ayuda a las consultas de producto y
perjudica a las de restricción, lo que confirma que la negación no se resuelve
con texto.

**Cómo interpretarla:** es esperable que las consultas con restricción tengan
menor precisión. BM25 trata "sin" como una palabra más y premia los productos
que mencionan "gluten" en el nombre, los ingredientes o las categorías, que son
justamente los que la persona quiere evitar. Solo acierta cuando el producto dice
"sin gluten" en el nombre. No es un error de la implementación sino un límite de
un ranking solo léxico: responder bien exige entender la restricción y filtrar
por los alérgenos detectados, que es la capacidad adaptativa del Módulo 3.

### `GET /metrics/evaluation`

Devuelve la evaluación del índice que está respondiendo `/search`. Se calcula
cada vez que el índice se reconstruye (al iniciar el servicio y al terminar cada
ingesta), junto con el índice nuevo, y se publica con él: no se evalúa en cada
petición, y la evaluación siempre corresponde al índice vigente.

| Campo | Definición |
|---|---|
| `k` | Resultados que se miran por consulta (5). |
| `precision_at_k` | Promedio macro de Precision@K de las consultas evaluadas (0 a 1, 4 decimales). |
| `recall_at_k` | Promedio macro de Recall@K de las consultas evaluadas (0 a 1, 4 decimales). |
| `consultas_evaluadas` | Consultas del conjunto con al menos un relevante en el corpus. |
| `tiempo_promedio_ms` | Tiempo promedio de búsqueda de esas consultas, en el servicio. |

Incluye ambos tipos de consulta, de producto y con restricción. El desglose por
consulta y por tipo, y la comparación con la línea base, están en
`scripts/evaluar_busqueda.py`. Con el índice vacío responde 200 con
`consultas_evaluadas: 0` y el resto en 0.

**Cómo interpretar el endpoint:** `precision_at_k` 0.51 significa que, en
promedio, la mitad de los 5 primeros resultados le sirve al usuario. Como el
máximo posible depende de cuántos relevantes tenga cada consulta en el corpus,
el número sirve sobre todo para **comparar** el mismo conjunto entre versiones
del buscador o corpus (por ejemplo, antes y después de los sinónimos), no como
nota absoluta. Si `consultas_evaluadas` baja, el corpus perdió cobertura de
algún tipo de producto.

## Convenciones

- Campos en español `snake_case`.
- Fechas en ISO 8601 UTC con `Z` (`2026-10-20T14:30:00Z`).
- Campos opcionales llegan como `null`; las listas vacías, como `[]`.

## Regenerar el contrato

Después de cambiar un esquema o endpoint, desde `python-service/`:

```powershell
python scripts/export_openapi.py
```
