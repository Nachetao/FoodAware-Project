# Estado del proyecto y backlog

Estado de FoodAware al cierre de la EP2 (25 de octubre de 2026): qué hicimos
en esta entrega, qué corregimos de la EP1 y qué queda para la EP3 y el
Módulo 3. Lo hecho sale del historial de git y de los Pull Requests de
`main`.

## Resumen

- La aplicación funciona de punta a punta en local y en staging (Render):
  búsqueda BM25 sobre 385 productos chilenos de Open Food Facts, detalle con
  alérgenos y trazas, panel de métricas, registro con perfil de alergias y
  veredicto "Apto para ti" o "No apto".
- El pipeline tiene 7 workflows de CI y, desde esta entrega, un workflow de
  despliegue automático a staging con pruebas de salud.
- Valores de referencia en staging (semilla del 25 de octubre de 2026):
  Precision@5 = 0,53, 75,47 % de válidos, 70,96 % de duplicados y 75,31 % de
  cobertura de ingredientes.

## Lo hecho en la EP2

Trabajamos con una rama por funcionalidad y un Pull Request a `main` para
cada una. Dos cambios de Joaquín se integraron sin número de PR en el
mensaje; los identificamos por su commit.

### Ignacio Reyes

Python-service (FastAPI), pipeline, staging y documentación general.

| PR | Qué incluye |
|---|---|
| #3 | Contrato FastAPI ↔ NestJS: esquemas Pydantic, errores, request id, simulación de errores y exportación del OpenAPI con verificación en CI |
| #4 | Corrección de vulnerabilidades del backend y del frontend |
| #6 | Cliente de Open Food Facts con límites de tasa y reintentos, caché SQLite con payload crudo y procedencia, estrategia de actualización |
| #7 | Limpieza de ingredientes, detección de alérgenos y trazas, validación de calidad, duplicados y reprocesamiento por versión |
| #8 | Índice invertido, BM25 por campos con pesos e ingesta por categorías |
| #9 | Métricas de calidad reales, conjunto de evaluación con Precision@K y Recall@K, sinónimos y reintento de categorías fallidas |
| #10 | Logs JSON con `request_id`, `/health` real (caché, índice y Open Food Facts), usuario sin privilegios y healthchecks en Docker |
| #15 | Pipeline: workflows ordenados con versiones en Variables, Bandit, CodeQL, Trivy, CI Integración con Docker Compose, Variables y Secrets |
| #16 | Blueprint de Render, semilla del corpus y clave interna para `POST /ingest/runs` |
| #24 | Documentación de la EP2: fuente web, extracción y preparación, recuperación y evaluación, pipeline y limitaciones |
| #25 | Publicación del staging en Render y pruebas de integración del backend en CI |
| `feat/despliegue-automatico` | Historial real de ingestas en la semilla, workflow CD Staging con pruebas de salud, `scripts/despertar-staging.ps1` y esta documentación final |

### Joaquín Muñoz

Backend (NestJS), frontend (Angular + Ionic) y capacidad adaptativa.

| PR | Qué incluye |
|---|---|
| #5 | Módulo de productos: cliente de FastAPI con los tipos del contrato, proxy de `/search`, entidad `Product` y guardado con upsert |
| #11 | Página de búsqueda, tema visual propio y modelos del contrato en el frontend |
| #12 | Reintentos con backoff hacia FastAPI, respaldo desde la base y aviso de respaldo en el frontend |
| #13 | Logs JSON con pino, `X-Request-ID`, `/api/health` real (PostgreSQL y FastAPI) y `X-Response-Time-ms` |
| #14 | Prueba del formulario de la página de inicio |
| #17 | Preparación para staging: guard JWT global, quitar rutas de prueba, registro sin hash en la respuesta, `PORT` y `CORS_ORIGINS`, imagen Node 22 sin npm, `API_URL` al compilar |
| #18 | Pruebas de integración del backend contra un FastAPI simulado |
| commit `00b2a82` | Panel de métricas: endpoints del backend y página `/metricas` |
| commit `17070b3` | Detalle del producto con procedencia y atribución ODbL |
| #21 | Alergias del usuario como códigos, compatibilidad por usuario e índices GIN |
| #22 | Login, registro y perfil con alergias en el frontend; sesión, interceptor JWT y guard |
| #23 | Compatibilidad del producto con las alergias del usuario en el frontend |
| #26 | Documentación del backend, del frontend, de la observabilidad y de la capacidad adaptativa, con sus capturas |

## Correcciones de la EP1

Al empezar la EP2 revisamos lo que entregamos en la EP1 y encontramos varios
problemas. Esto es lo que corregimos. La retroalimentación formal de la
profesora sobre la EP1 todavía no llega: estas correcciones salen de nuestra
propia revisión, y cuando llegue la retroalimentación la vamos a sumar aquí.

| Problema en la EP1 | Qué hicimos | Dónde |
|---|---|---|
| Endpoints de prueba públicos en el backend: `GET /api/food/test-alergia` creaba un usuario con una contraseña escrita en el código, y existía también `GET /api/food/test-ia` | Los eliminamos | PR #17 |
| `POST /api/users` devolvía el hash de la contraseña en la respuesta | Ya no lo devuelve; responde 409 si el correo ya existe y valida el cuerpo con `whitelist` | PR #17 |
| Se emitían JWT, pero ninguna ruta los exigía | Guard JWT global; las rutas públicas están marcadas una por una | PR #17 |
| Los health checks devolvían siempre `{"status": "ok"}`, sin revisar nada | `/health` del python-service revisa la caché, el índice y la última ingesta; `/api/health` del backend revisa PostgreSQL y FastAPI. Docker Compose y Render los usan como healthcheck | PR #10 y PR #13 |
| El "staging" era Docker Compose en un computador local | Staging real en Render, declarado en `render.yaml` y validado en CI, con despliegue automático cuando pasa el CI de `main` | PR #16, PR #25 y esta entrega |
| `terraform/` no tenía recursos y se presentaba como la infraestructura de staging | Sigue sin recursos, y lo decimos así. El proveedor de Terraform para Render no puede crear ni modificar servicios del plan gratuito, así que la infraestructura como código real es el Blueprint. CI sigue validando `terraform/` ([despliegue-staging.md](despliegue-staging.md#por-qué-blueprint-y-no-terraform)) | PR #16 |
| El pipeline tenía un `ci.yml` que repetía Gitleaks y el lint y las pruebas del backend y del python-service, con Node 18, mientras la imagen del backend usaba Node 20 | Eliminamos `ci.yml`. Cada workflow toma su versión de una Variable, igual a la de su Dockerfile (hoy Node 22 y Python 3.11) | PR #15 y PR #17 |
| La única revisión de seguridad era Gitleaks | Agregamos Bandit, CodeQL, Trivy sobre las 3 imágenes, `pip-audit` y `npm audit`, con sus quality gates | PR #15 |
| El backend tenía código muerto (`AppService`) que llamaba al python-service con otra variable (`PYTHON_SERVICE_URL`) | Lo eliminamos; todo usa `PYTHON_API_URL` | PR #17 |

## Pendiente para la EP3 y el Módulo 3

### Capacidad adaptativa

La especificación preliminar está en
[capacidad-adaptativa.md](capacidad-adaptativa.md). Lo que falta:

- Llevar el veredicto apto o no apto a la búsqueda principal, no solo a
  `/compatibles`, que busca entre los productos guardados.
- Medir la utilidad de la adaptación con las métricas de la sección 8 de la
  especificación: tasa de falsos "apto" (objetivo cercano a 0), precisión del
  veredicto y Precision@5 en búsquedas con restricción, comparando la búsqueda
  no adaptativa con la adaptativa.
- En el Módulo 3: la comparación formal entre las dos versiones (prueba A/B si
  corresponde), la evaluación con usuarios y el registro de uso.

### Producto

- Aviso en la interfaz de que la información de alérgenos es orientativa.
- Atribución a Open Food Facts también en la lista de resultados.
- Que `/analizar` (de la EP1) use la misma detección de alérgenos que la
  búsqueda.
- Corrección de errores de tipeo en la búsqueda.
- Ampliar el corpus (más categorías o más productos por ingesta).

### Técnico

- Protección de la rama `main` con los checks obligatorios antes del merge.
- Actualizar el modelo de datos de [Arquitectura.md](Arquitectura.md) con las
  tablas de la EP2.
- Migrar el frontend de `IonicModule` a `provideIonicAngular()` y subir
  Angular a 22.2.3 y Nest a la versión 12 por las vulnerabilidades altas
  pendientes ([frontend.md](frontend.md), [backend.md](backend.md)).
- Agregación centralizada de logs ([observabilidad.md](observabilidad.md)).

### Operación del staging

- Recrear la base de Render antes de que venza: es gratuita, dura 30 días y
  la nuestra vence el 24 de noviembre de 2026
  ([despliegue-staging.md](despliegue-staging.md#recrear-la-base-cada-30-días)).
- Regenerar la semilla cuando haya ingestas nuevas en local, para que staging
  no se quede con datos cada vez más antiguos.

El resto de lo que sabemos que falta, con su impacto, está en
[limitaciones.md](limitaciones.md).
