# Observabilidad del backend

El backend NestJS usa el mismo formato de logs y el mismo identificador de solicitud que el servicio FastAPI, para poder seguir una petición de punta a punta entre ambos servicios.

## Logs estructurados (JSON)

Se usa `nestjs-pino`. Cada línea es un JSON con los campos acordados con FastAPI:

| Campo | Formato |
|---|---|
| `timestamp` | ISO 8601 en UTC |
| `level` | En minúsculas: `info`, `warning`, `error` |
| `service` | `"backend"` (en FastAPI, `"python-service"`) |
| `request_id` | Identificador de la solicitud; `null` fuera de una petición |
| `message` | Texto del evento |
| `logger` | Componente que lo emitió |

Ejemplo:

```json
{"level":"warning","timestamp":"2026-10-22T21:42:20.773Z","service":"backend","request_id":"e2e-respaldo","logger":"FastApiClientService","message":"Reintento 1/2 de GET /search tras ECONNREFUSED; espera 271 ms"}
```

El nivel mínimo se configura con `LOG_LEVEL` (por defecto `info`).

### Eventos registrados

| Evento | Nivel | Ejemplo |
|---|---|---|
| Acceso por petición (`evento: acceso_http`) | info | `GET /api/products/search 200 en 39.0 ms` |
| Reintento hacia FastAPI | warning | `Reintento 1/2 de GET /search tras ECONNREFUSED; espera 271 ms` |
| FastAPI no disponible | warning | `FastAPI no disponible: ECONNREFUSED` |
| Uso del respaldo | warning | `FastAPI falló con 503 SOURCE_UNAVAILABLE; respondiendo desde la base: 3 de 61 productos` |
| Respaldo sin resultados | warning | `… el respaldo no tiene resultados; se mantiene el error` |
| Fallo del respaldo o del guardado | error | `No se pudieron guardar N productos: …` |

El log de acceso incluye `metodo`, `ruta`, `codigo_estado` y `duracion_ms`, igual que el de FastAPI.

## Identificador de solicitud (`X-Request-ID`)

1. Un middleware global lee el header `X-Request-ID` de la petición. Si es válido (`[A-Za-z0-9._-]`, máximo 128 caracteres), lo reutiliza; si no, genera un UUID.
2. El id queda disponible en el contexto de la petición (`AsyncLocalStorage`), así que todos los logs lo incluyen sin pasarlo a mano.
3. El backend lo **reenvía a FastAPI**, que lo usa en sus propios logs.
4. Se devuelve en el header `X-Request-ID` de la respuesta y en `error.request_id` de los errores.

CORS expone `X-Request-ID` y `X-Fuente-Datos` para que el frontend pueda leerlos.

## Endpoint de salud: `GET /api/health`

Público. Usa el mismo formato que el `/health` de FastAPI:

```json
{
  "estado": "ok",
  "servicio": "backend",
  "version": "1.0.0",
  "verificado_en": "2026-10-22T21:52:24Z",
  "dependencias": { "postgresql": "ok", "fastapi": "ok" },
  "detalle": {
    "postgresql": { "latencia_ms": 25.3, "error": null },
    "fastapi": { "estado": "ok", "latencia_ms": 21.5, "error": null }
  }
}
```

| Situación | `estado` | HTTP |
|---|---|---|
| PostgreSQL (`SELECT 1`) caído o sin respuesta en 2 s | `error` | **503** |
| FastAPI caído, con timeout o reportándose degradado | `degradado` | 200 |
| Todo responde | `ok` | 200 |

FastAPI caído no hace fallar el health, porque la búsqueda tiene respaldo desde la base. Este endpoint se usa como healthcheck en `docker-compose.yml` y en las pruebas de salud posteriores al despliegue.

## Tiempo de respuesta

Un interceptor global agrega el header **`X-Response-Time-ms`** (3 decimales) a cada respuesta, también cuando la petición termina en error, y registra el log `acceso_http` con la duración. FastAPI agrega el mismo header.

## Cómo verificarlo

```bash
curl -s http://localhost:3000/api/health
curl -i -H "X-Request-ID: prueba-obs" "http://localhost:3000/api/products/search?q=leche&limit=1"
```

La segunda respuesta trae `X-Request-ID: prueba-obs` y `X-Response-Time-ms`, y en la consola del backend aparece la línea `acceso_http` con `"request_id":"prueba-obs"`. El mismo id aparece en los logs de FastAPI.

Para probar los estados de salud:

```bash
docker compose stop python-service   # /api/health → degradado (200)
docker compose start python-service
```

## Limitaciones

- Las rutas inexistentes (404 de NestJS) no pasan por el interceptor, así que no llevan `X-Response-Time-ms` ni log de acceso.
- Si FastAPI se reporta a sí mismo como `degradado` (por ejemplo, porque su última ingesta tuvo errores), el health del backend también queda `degradado` aunque todo funcione.
- Los logs se escriben en la salida estándar; no hay todavía agregación centralizada ni métricas tipo Prometheus.
