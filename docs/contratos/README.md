# Contrato FastAPI ↔ NestJS

Contrato HTTP entre `backend/` (NestJS) y `python-service/` (FastAPI) para la EP2.
La fuente de verdad es el código (modelos Pydantic en `python-service/app/schemas/`);
[`fastapi-openapi.json`](fastapi-openapi.json) se genera desde ahí.

> **Hoy los endpoints nuevos son stubs.** Productos, búsqueda, ingesta y métricas
> devuelven datos de ejemplo de `python-service/app/fixtures/` y responden con el
> header `X-Stub: true`. La integración con Open Food Facts, la limpieza y la
> búsqueda real se implementarán detrás de este mismo contrato.

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
| GET | `/products/{codigo_barras}` | `Producto` | 404, 422, 500, 503, 504 | stub |
| GET | `/search?q=&limit=&offset=` | `RespuestaBusqueda` | 422, 500, 503, 504 | stub |
| POST | `/ingest/runs` | `ResumenIngesta` (202, `en_curso`) | 422, 500, 503 | stub |
| GET | `/ingest/runs/latest` | `ResumenIngesta` | 404, 500 | stub |
| GET | `/metrics/quality` | `MetricasCalidad` | 500 | stub |
| GET | `/metrics/evaluation` | `MetricasEvaluacion` | 500 | stub |

Parámetros de búsqueda: `q` de 2 a 100 caracteres, `limit` de 1 a 50 (10 por
defecto), `offset` ≥ 0. Códigos de barras: 8 a 14 dígitos.

Fixtures disponibles: `7801234000018` (leche, `lacteos`), `7805678000023`
(pan, `gluten`) y `7809012000038` (galletas, varios alérgenos).

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
| `X-Stub` | respuesta | `true` en endpoints que aún devuelven datos de ejemplo. |
| `X-Simular-Error` | petición | Solo con `SIMULAR_ERRORES_HABILITADO=true` en `.env`. Valores: `SOURCE_UNAVAILABLE` (503), `SOURCE_TIMEOUT` (504), `INTERNAL_ERROR` (500). Solo en endpoints stub; no aparece en OpenAPI. |

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
