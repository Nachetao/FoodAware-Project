# Estado del proyecto y backlog

Estado de FoodAware al cierre de la Entrega Final (21 de noviembre de 2026):
qué hicimos en cada entrega, qué corregimos de la EP1, cómo respondimos la
retroalimentación de la profesora y qué queda pendiente. Lo hecho sale del
historial de git y de los Pull Requests de `main`.

## Resumen

- La aplicación funciona de punta a punta en local y en staging (Render), en
  la web, como PWA instalable y como app de Android: búsqueda BM25 sobre 385
  productos chilenos de Open Food Facts, detalle con alérgenos y trazas,
  panel de métricas, roles de usuario y administrador, y la capacidad
  adaptativa (veredicto y búsqueda personalizada según el perfil).
- La evaluación de la capacidad adaptativa dio 0 falsos "apto" y subió la
  Precision@5 de las consultas con restricción de 0,20 a 0,83.
- El pipeline tiene 7 workflows de CI, un despliegue automático a staging con
  10 pruebas posteriores y un rollback a la última versión verificada. `main`
  exige los 15 checks en verde.
- Valores de referencia en staging (semilla del 25 de octubre de 2026):
  Precision@5 = 0,53, 75,47 % de válidos, 70,96 % de duplicados y 75,31 % de
  cobertura de ingredientes.

## Lo hecho en la Entrega Final

Como en la EP2, una rama por funcionalidad y un Pull Request a `main` para
cada una. La autoría sale de los commits de cada PR.

### Ignacio Reyes

| PR | Qué incluye |
|---|---|
| #27 | Historial real de las ingestas en la semilla |
| #30 a #33 | Contrato de la capacidad adaptativa, motor del veredicto, búsqueda personalizada, etiquetado manual y evaluación, y lectura de trazas a mitad de un fragmento |
| #34 | Commit desplegado en `/health` y workflow Rollback staging |
| #42 | `Cache-Control` del service worker en staging y `X-Clave-Servicio` obligatoria, con su prueba en CI Integración |
| #43 | Modelo de amenazas STRIDE |
| #44 | Respuesta a la retroalimentación de la EP1: actores, clasificación frente a garantía, ADR 0001 a 0003 y el fallo de Trivy documentado |
| `docs/cierre-final` | Límite de peticiones en el modelo de amenazas, `test:postgres` en CI Backend, README y revisión final de la documentación |

### Joaquín Muñoz

| PR | Qué incluye |
|---|---|
| #35 a #37 | Compatibilidad que nunca responde "apto" con alérgenos, trazas o datos insuficientes; cliente del motor adaptativo con `X-Clave-Servicio`; veredicto completo y búsqueda personalizada en el frontend |
| #38 y #39 | Barra superior compartida, y el inicio rediseñado con el aviso orientativo y un servicio de análisis sin `HttpClient` en la página |
| #40 | Roles de usuario y administrador, guard de roles y script `admin:asignar` |
| #41 | PWA, app de Android con Capacitor, accesibilidad y diseño adaptable |
| #45, #48 y #49 | Límite de peticiones por IP (con la IP desde `CF-Connecting-IP`) y contraseña mínima de 8 caracteres |
| #46 | ADR 0004 (PostgreSQL y TypeORM) y modelo de base de datos actualizado |
| #47 | Commit en `/api/health` y alérgenos en neutro salvo los del perfil |
| #50 | Pruebas de guards, roles y navegación, y pruebas con PostgreSQL real |
| #51 a #53 | Búsqueda normalizada para la caché de la PWA, documentación del backend, del frontend, de la observabilidad y de la capacidad adaptativa, y las capturas de la entrega |

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
problemas. Esto es lo que corregimos. Estas correcciones salen de nuestra
propia revisión; la retroalimentación formal de la profesora llegó después y
está en [Retroalimentación de la EP1](#retroalimentación-de-la-ep1).

| Problema en la EP1 | Qué hicimos | Dónde |
|---|---|---|
| Endpoints de prueba públicos en el backend: `GET /api/food/test-alergia` creaba un usuario con una contraseña escrita en el código, y existía también `GET /api/food/test-ia` | Los eliminamos | PR #17 |
| `POST /api/users` devolvía el hash de la contraseña en la respuesta | Ya no lo devuelve; responde 409 si el correo ya existe y valida el cuerpo con `whitelist` | PR #17 |
| Se emitían JWT, pero ninguna ruta los exigía | Guard JWT global; las rutas públicas están marcadas una por una | PR #17 |
| Los health checks devolvían siempre `{"status": "ok"}`, sin revisar nada | `/health` del python-service revisa la caché, el índice y la última ingesta; `/api/health` del backend revisa PostgreSQL y FastAPI. Docker Compose y Render los usan como healthcheck | PR #10 y PR #13 |
| El "staging" era Docker Compose en un computador local | Staging real en Render, declarado en `render.yaml` y validado en CI, con despliegue automático cuando pasa el CI de `main` | PR #16, PR #25 y esta entrega |
| `terraform/` no tenía recursos y se presentaba como la infraestructura de staging | El proveedor de Terraform para Render no puede crear ni modificar servicios del plan gratuito, así que la infraestructura de staging es el Blueprint. `terraform/` ahora administra la configuración de GitHub de la que depende el despliegue (el ruleset de `main` y el Environment `staging`), con el estado en HCP Terraform ([pipeline-devsecops.md](pipeline-devsecops.md#terraform-la-configuración-de-github-como-código)) | PR #16 y esta entrega |
| El pipeline tenía un `ci.yml` que repetía Gitleaks y el lint y las pruebas del backend y del python-service, con Node 18, mientras la imagen del backend usaba Node 20 | Eliminamos `ci.yml`. Cada workflow toma su versión de una Variable, igual a la de su Dockerfile (hoy Node 22 y Python 3.11) | PR #15 y PR #17 |
| La única revisión de seguridad era Gitleaks | Agregamos Bandit, CodeQL, Trivy sobre las 3 imágenes, `pip-audit` y `npm audit`, con sus quality gates | PR #15 |
| El backend tenía código muerto (`AppService`) que llamaba al python-service con otra variable (`PYTHON_SERVICE_URL`) | Lo eliminamos; todo usa `PYTHON_API_URL` | PR #17 |

## Retroalimentación de la EP1

Las observaciones de la profesora sobre la EP1, qué hicimos con cada una y
dónde está la evidencia. Las respondimos en la documentación de la Entrega
Final.

| Observación | Qué hicimos | Evidencia |
|---|---|---|
| "No es clara la documentación de actores y sistemas externos" | Nuevo diagrama de contexto con los tres actores, que corresponden a los roles reales del backend (visitante sin sesión, usuario registrado y administrador), y los sistemas externos (Open Food Facts, Render, GitHub Actions y HCP Terraform). Una tabla dice qué puede hacer cada actor y dónde se controla, y otra, para qué usamos cada sistema externo | [Arquitectura.md](Arquitectura.md#diagrama-de-contexto): [actores](Arquitectura.md#actores) y [sistemas externos](Arquitectura.md#sistemas-externos) |
| "Diferenciar una clasificación de compatibilidad alimentaria de una garantía de seguridad para el consumo" | Una sección que explica qué decide el sistema (los tres veredictos), qué no garantiza, el aviso permanente que muestra el frontend y por qué el error más grave es un falso "apto" | [README](../README.md#clasificación-no-garantía-de-seguridad), [Arquitectura.md](Arquitectura.md#clasificación-de-compatibilidad-no-garantía-de-seguridad), [`aviso-orientativo.ts`](../frontend/src/app/compartido/aviso-orientativo.ts) (PR #39) y [modelo-amenazas.md](modelo-amenazas.md#4-riesgos-del-dominio) |
| "¿Monolito o microservicios, y cómo llegaron a esa decisión?" | ADR que nombra el estilo real: servicios separados por responsabilidad (un backend principal y un servicio especializado), no microservicios completos. Explica por qué descartamos un monolito NestJS, un monolito Python y los microservicios completos. En la EP1 lo habíamos llamado "microservicio"; lo corregimos también en Arquitectura.md | [ADR 0001](adr/0001-estilo-servicios-separados.md) |
| "¿Por qué Python y FastAPI como servicio independiente?" | ADR con las alternativas (NestJS, Flask, Django y scripts llamados desde NestJS). Reconoce que hoy no usamos el ecosistema de Python que justificó la decisión: es una opción a futuro | [ADR 0002](adr/0002-python-fastapi.md) |
| "¿Por qué REST entre NestJS y FastAPI?" | ADR con las alternativas (gRPC, colas de mensajes y GraphQL) y por qué REST alcanza: consultas síncronas que el usuario espera, poco volumen y un contrato OpenAPI que CI verifica | [ADR 0003](adr/0003-rest-entre-servicios.md) |
| "¿Por qué PostgreSQL y TypeORM?" | ADR con las alternativas (MongoDB, MySQL y SQLite para la base; Prisma, Sequelize y SQL directo para el acceso a datos). Explica el paso de `simple-array` a `text[]`, reconoce que los índices GIN de la EP2 hoy no se usan y recuerda que la base gratuita de Render vence cada 30 días | [ADR 0004](adr/0004-postgresql-typeorm.md) |
| "Separar componentes de interfaz y servicios HTTP en el frontend" | Corregido: `home.page.ts` ya no inyecta `HttpClient` y usa `AnalisisService`. En todo el frontend, `HttpClient` solo se inyecta en los servicios (`admin`, `analisis`, `auth`, `metricas` y `products`) | Commit `30b3b71` (PR #39), [`home.page.ts`](../frontend/src/app/home/home.page.ts), [`analisis.service.ts`](../frontend/src/app/analisis/analisis.service.ts) y sus pruebas (`analisis.service.spec.ts`, `home.page.spec.ts`) |
| "Documentar los fallos controlados" | Una sección explícita con el caso real de Trivy: la CVE-2026-59873 de `tar` en la imagen del backend, el bloqueo de CI Seguridad, la corrección en el PR #17, la verificación y lo que aprendimos (el ruleset de `main`). Se suma al fallo provocado de Gitleaks de la EP1 | [pipeline-devsecops.md](pipeline-devsecops.md#fallo-de-seguridad-detectado-bloqueo-del-pipeline-y-corrección), [`ep2-trivy-backend-critical.png`](evidencia/ep2-trivy-backend-critical.png) y [`ep2-ci-verde.png`](evidencia/ep2-ci-verde.png) |

## Demostración de la EP2

Los 10 puntos de la demostración mínima de la EP2 y dónde se ve cada uno. Los
valores son los de staging con la semilla del 25 de octubre de 2026: 385
productos, Precision@5 = 0,53, 75,47 % de válidos, 70,96 % de duplicados y
75,31 % de cobertura de ingredientes. Desde la Entrega Final, los endpoints de
FastAPI que consume el backend exigen `X-Clave-Servicio`, así que los datos
de las ingestas y de la calidad se consultan por el backend. La demostración
de la Entrega Final está en el [README](../README.md#demostración-de-la-entrega-final).

| # | Punto | Qué mostrar | Evidencia |
|---|---|---|---|
| 1 | Recuperación automatizada de información real | Las ingestas desde la API de Open Food Facts, por país y categoría, con límites de tasa, reintentos y segunda ronda. La última que trajo datos al corpus (25 de octubre de 2026, 387 productos recuperados) se ve en [`/api/ingesta/ultima`](https://foodaware-staging-backend.onrender.com/api/ingesta/ultima), con `origen: "semilla"` | [fuente-web.md](fuente-web.md), [extraccion-y-preparacion.md](extraccion-y-preparacion.md) |
| 2 | Validación y preparación | Limpieza de ingredientes, alérgenos y trazas, reglas de calidad y deduplicación. En [`/api/metricas/calidad`](https://foodaware-staging-backend.onrender.com/api/metricas/calidad): 75,47 % de válidos | [extraccion-y-preparacion.md](extraccion-y-preparacion.md), [detalle-producto.png](evidencia/detalle-producto.png) |
| 3 | Procesamiento mediante FastAPI | El [Swagger del python-service](https://foodaware-staging-python.onrender.com/docs): `/search` con BM25 y `/products/{codigo_barras}` con alérgenos, calidad y procedencia | [contratos/README.md](contratos/README.md) |
| 4 | Comunicación NestJS-FastAPI | [Búsqueda por el backend](https://foodaware-staging-backend.onrender.com/api/products/search?q=galletas&limit=5) con `X-Fuente-Datos: fastapi`; el mismo `X-Request-ID` aparece en los logs de los dos servicios | [observabilidad.md](observabilidad.md), [backend.md](backend.md), [ep2-cd-staging.png](evidencia/ep2-cd-staging.png) |
| 5 | Persistencia o indexación | Caché SQLite con el payload crudo y la procedencia, índice invertido BM25 en memoria (385 productos en `detalle.indice` de [`/health`](https://foodaware-staging-python.onrender.com/health)) y tabla `products` de PostgreSQL como respaldo | [recuperacion-y-evaluacion.md](recuperacion-y-evaluacion.md#1-persistencia-e-indexación), [backend.md](backend.md#persistencia) |
| 6 | Consulta y visualización desde el frontend | En el [frontend de staging](https://foodaware-staging-frontend.onrender.com): buscar "galletas de avena", abrir un producto y, con sesión, ver "Apto para ti" o "No apto" | [frontend.md](frontend.md), [detalle-producto.png](evidencia/detalle-producto.png), [apto-para-ti.png](evidencia/apto-para-ti.png), [no-apto.png](evidencia/no-apto.png) |
| 7 | Ejecución del pipeline DevSecOps | La pestaña Actions: los 7 workflows de CI y CD Staging, con los quality gates y los Secrets y Variables | [pipeline-devsecops.md](pipeline-devsecops.md), [ep2-ci-verde.png](evidencia/ep2-ci-verde.png), [ep2-trivy-backend-critical.png](evidencia/ep2-trivy-backend-critical.png), [ep2-github-secrets.png](evidencia/ep2-github-secrets.png), [ep2-github-variables.png](evidencia/ep2-github-variables.png) |
| 8 | Acceso a la versión en staging | Las tres URL de staging y el despliegue automático del último commit de `main` | [despliegue-staging.md](despliegue-staging.md), [ep2-render-servicios.png](evidencia/ep2-render-servicios.png), [ep2-cd-staging.png](evidencia/ep2-cd-staging.png) |
| 9 | Presentación de una métrica de evaluación | La página [Métricas](https://foodaware-staging-frontend.onrender.com/metricas): Precision@5 = 0,53 sobre 20 consultas (0,75 en las de producto y 0,20 en las de restricción), más las métricas de calidad | [recuperacion-y-evaluacion.md](recuperacion-y-evaluacion.md#7-métricas), [panel-metricas.png](evidencia/panel-metricas.png) |
| 10 | Manejo de un escenario de error | Con FastAPI caído, el backend responde desde la base con `X-Fuente-Datos: respaldo` y el frontend lo avisa. En staging: un [código de barras inválido](https://foodaware-staging-backend.onrender.com/api/products/123) responde 422 `VALIDATION_ERROR` con su `request_id`, y `POST /ingest/runs` sin la clave responde 403 | [respaldo-chocolate.png](evidencia/respaldo-chocolate.png), [backend.md](backend.md#robustez-frente-a-fastapi), [limitaciones.md](limitaciones.md) |

## Pendiente después de la Entrega Final

### Capacidad adaptativa

- Evaluarla con usuarios reales: una comparación formal (prueba A/B) entre la
  búsqueda normal y la personalizada, y el registro de uso.
- Ampliar el conjunto etiquetado a mano: con pocos casos, 0 falsos "apto" no
  prueba que no existan
  ([recuperacion-y-evaluacion.md](recuperacion-y-evaluacion.md#8-evaluación-de-la-capacidad-adaptativa)).
- Si hay datos suficientes, probar un clasificador entrenado frente a las
  reglas actuales.

### Producto

- Atribución a Open Food Facts también en la lista de resultados.
- Que `/analizar` (de la EP1) use la misma detección de alérgenos que la
  búsqueda.
- Corrección de errores de tipeo en la búsqueda.
- Ampliar el corpus (más categorías o más productos por ingesta).
- Escaneo de códigos de barras con la cámara, iOS y la publicación de la app.

### Seguridad

Los riesgos pendientes del [modelo de amenazas](modelo-amenazas.md#5-riesgos-pendientes):
verificar el correo, comparar contra un hash falso en el login, una
Content-Security-Policy, un contador del límite de peticiones compartido
(Redis), una clave por consumidor entre servicios y proteger los tags
`staging-verificado-*`.

### Técnico

- Migrar el frontend de `IonicModule` a `provideIonicAngular()` y subir
  Angular a 22.2.3 y Nest a la versión 12 por las vulnerabilidades altas
  pendientes ([frontend.md](frontend.md), [backend.md](backend.md)).
- Agregación centralizada de logs ([observabilidad.md](observabilidad.md)).

### Operación del staging

- **Recrear la base de Render**: es gratuita, dura 30 días y la nuestra vence
  el 24 de noviembre de 2026
  ([despliegue-staging.md](despliegue-staging.md#recrear-la-base-cada-30-días)).
- Regenerar la semilla cuando haya ingestas nuevas en local, para que staging
  no se quede con datos cada vez más antiguos.

Ya resueltos en la Entrega Final, del backlog de la EP2: la protección de
`main` con los checks obligatorios, el modelo de datos de
[Arquitectura.md](Arquitectura.md), el veredicto en la búsqueda principal
(búsqueda personalizada) y la medición de los falsos "apto".

El resto de lo que sabemos que falta, con su impacto, está en
[limitaciones.md](limitaciones.md).
