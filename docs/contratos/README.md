# Contrato FastAPI ↔ NestJS

Contrato HTTP entre `backend/` (NestJS) y `python-service/` (FastAPI) para la EP2.
La fuente de verdad es el código (modelos Pydantic en `python-service/app/schemas/`);
[`fastapi-openapi.json`](fastapi-openapi.json) se genera desde ahí.

> **Productos, búsqueda e ingesta ya son reales** (Open Food Facts + caché local
> SQLite). **Las métricas siguen siendo stubs** hasta el Bloque 5: devuelven datos
> de ejemplo y responden con el header `X-Stub: true`. La limpieza profunda de
> ingredientes (Bloque 3) y el ranking BM25 (Bloque 4) llegarán detrás de este
> mismo contrato.

### Cómo se obtienen los datos

- **Fuente:** API pública de Open Food Facts. Lectura de producto con
  `/api/v3/product/{código}` y búsqueda estructurada por país y categoría con
  `/api/v2/search`, pidiendo solo los campos necesarios (`fields`).
- **Límites:** el servicio se queda bajo los oficiales (15 lecturas y 10
  búsquedas por minuto por IP): como máximo 12 lecturas y 8 búsquedas por minuto.
  Reintenta hasta 3 veces con backoff exponencial y jitter solo ante errores de
  red, timeouts, 429 y 5xx.
- **`/search` nunca consulta Open Food Facts en vivo:** busca sobre la caché
  local, que se llena con `POST /ingest/runs`. Solo se buscan productos válidos.
- **`/products/{codigo_barras}`** lee primero la caché; si no está, lo trae de
  Open Food Facts y lo guarda. Si la fuente falla y no está en la caché,
  responde 503 o 504.
- Requiere `OFF_USER_AGENT` en `.env` (formato `AppName/Version (correo)`); sin
  él, los endpoints que necesitan la fuente responden 503.

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

**Ingesta:** `POST /ingest/runs` responde 202 con la ejecución `en_curso` y la
procesa en segundo plano; el resultado se consulta en `GET /ingest/runs/latest`.
Si ya hay una en curso, devuelve esa misma en lugar de lanzar otra. Al terminar:
`recuperados` (descargados), `validos`, `invalidos` (sin nombre o sin
ingredientes; no se guardan), `duplicados` (válidos que ya estaban con el mismo
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
