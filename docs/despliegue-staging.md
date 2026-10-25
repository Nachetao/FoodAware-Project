# Despliegue en staging (Render, plan gratuito)

El ambiente de staging de FoodAware corre en [Render](https://render.com) con el
plan gratuito, sin tarjeta de crédito. Toda la infraestructura está declarada
en el Blueprint [`render.yaml`](../render.yaml), en la raíz del repositorio.

## Arquitectura

| Componente | Tipo en Render | Nombre | URL pública |
|---|---|---|---|
| PostgreSQL 15 | Render Postgres `free` | `foodaware-staging-db` | ninguna: solo conexiones internas (`ipAllowList: []`) |
| python-service (FastAPI) | Web service Docker `free` | `foodaware-staging-python` | `https://foodaware-staging-python.onrender.com` |
| backend (NestJS) | Web service Docker `free` | `foodaware-staging-backend` | `https://foodaware-staging-backend.onrender.com` |
| frontend (Angular/Ionic) | Static site | `foodaware-staging-frontend` | `https://foodaware-staging-frontend.onrender.com` |

Todo está en la región `virginia`. El backend se conecta a la base por su host
interno y llama a python-service por su URL **pública**, porque los web
services gratuitos no reciben tráfico por la red privada de Render. El
frontend se compila en Render y toma la URL del backend de `API_URL`. El
backend escucha en `PORT` y solo acepta por CORS los orígenes de
`CORS_ORIGINS` (la URL del frontend).

Las URL de la tabla son las reales de nuestro staging: Render no les agregó
sufijo. Si el Blueprint se crea en otra cuenta y el nombre ya está ocupado,
Render agrega uno (por ejemplo `foodaware-staging-python-a1b2.onrender.com`).
Por eso las tres variables que llevan URL (`PYTHON_API_URL`, `CORS_ORIGINS` y
`API_URL`) no están fijas en `render.yaml`: son `sync: false`, se completan al
crear el Blueprint y, si hace falta, se corrigen en Render sin tocar el
repositorio (paso 6).

## Estado actual

Staging está publicado desde el 24 de octubre de 2026 (PR #25) y funciona de
punta a punta. Swagger del backend en
<https://foodaware-staging-backend.onrender.com/docs> y del python-service en
<https://foodaware-staging-python.onrender.com/docs>.

Desde la EP2 los despliegues son automáticos: cuando todo el CI de `main` pasa,
el workflow `CD Staging (Render)` despliega ese commit y prueba las URL
públicas (ver "Despliegue automático"). La evidencia está en
[`evidencia/ep2-render-servicios.png`](evidencia/ep2-render-servicios.png) (los
4 recursos del Blueprint en Render) y
[`evidencia/ep2-cd-staging.png`](evidencia/ep2-cd-staging.png) (el workflow en
verde con la tabla de las pruebas de salud).

## Por qué Blueprint y no Terraform

La carpeta [`terraform/`](../terraform/) se mantiene, y CI valida su formato y
su sintaxis, pero staging no la usa:

- El proveedor oficial de Terraform para Render (`render-oss/render`) funciona
  sobre la API REST de Render, y esa API **no permite crear web services del
  plan gratuito** (lo hacen como medida anti-abuso; ver el
  [issue #44](https://github.com/render-oss/terraform-provider-render/issues/44)).
- Tampoco puede actualizarlos: en la v1.9.1, cualquier `apply` que modifique un
  web service gratuito falla con `maintenance mode can only be configured for
  non-free tier services`
  ([issue #80](https://github.com/render-oss/terraform-provider-render/issues/80),
  abierto).
- Terraform además necesitaría un backend remoto para el estado, y ese estado
  guardaría las contraseñas.

El Blueprint sí admite `plan: free`, Render guarda su estado (no hay estado ni
secretos en el repositorio) y se valida sin crear nada: el workflow
[`ci-render.yml`](../.github/workflows/ci-render.yml) lo revisa contra el JSON
Schema oficial y, si existen `RENDER_OWNER_ID` y `RENDER_API_KEY`, con el
endpoint *Validate Blueprint* de la API, que no crea ni modifica recursos.

## Secretos y configuración

| Valor | Dónde vive | Origen |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Render (backend) | `fromDatabase`: Render los toma de la base; la contraseña la genera Render |
| `JWT_SECRET` | Render (backend) | `generateValue: true` (Render genera 256 bits aleatorios) |
| `INGESTA_CLAVE` | Render (python-service) | `generateValue: true` |
| `OFF_USER_AGENT` | Render (python-service) | `sync: false`: se escribe al crear el Blueprint, con el correo del equipo |
| `PYTHON_API_URL`, `CORS_ORIGINS` (backend) y `API_URL` (frontend) | Render | `sync: false`: se escriben al crear el Blueprint. No son secretas, pero dependen de las URL que asigne Render |
| Lo demás (puertos, timeouts, opciones de ingesta) | `render.yaml` | Valores no sensibles, versionados |
| `RENDER_API_KEY` | GitHub, Secret | Render → Account Settings → API Keys |
| `RENDER_OWNER_ID` | GitHub, Variable | ID del workspace (`tea-…` o `usr-…`), en Render → Workspace Settings |

Ningún secreto queda en el repositorio. Las variables con `sync: false` solo se
piden al crear el Blueprint; si después hay que cambiarlas, se editan en
Render, en la pestaña *Environment* del servicio.

## Primer despliegue, paso a paso

Requisitos: acceso de administrador al repositorio en GitHub. No se necesita
tarjeta de crédito.

1. **Cuenta en Render.** Entra a <https://dashboard.render.com> con tu cuenta
   de GitHub. Usa el workspace *Hobby* (gratuito).
2. **Conectar GitHub.** Autoriza la app de Render para GitHub con acceso al
   repositorio `Nachetao/FoodAware-Project`. Render lo pide al iniciar sesión o
   al elegir el repositorio en el paso 4.
3. **Credenciales para CI.**
   - En *Account Settings → API Keys*, crea una API key y guárdala en GitHub
     (*Settings → Secrets and variables → Actions*) como Secret `RENDER_API_KEY`.
     Da acceso completo a la cuenta: no la pegues en ningún archivo.
   - En *Workspace Settings*, copia el ID del workspace y guárdalo como
     Variable `RENDER_OWNER_ID`. Desde ese momento, `CI Render Blueprint`
     también valida `render.yaml` con la API.
4. **Crear el Blueprint.** En el Dashboard: *New → Blueprint*.
   - Elige el repositorio y la rama `main`. El *Blueprint Path* es `render.yaml`
     (el valor por defecto).
   - Nombre sugerido: `foodaware-staging`.
   - Render muestra lo que va a crear: 1 base (`foodaware-staging-db`) y
     3 servicios. Si el archivo tiene errores, aparecen aquí.
   - Render pide las variables con `sync: false`. Las URL todavía no existen,
     así que se escriben las esperadas (sin `/` al final) y se revisan en el
     paso 6:

     | Servicio | Variable | Valor |
     |---|---|---|
     | `foodaware-staging-python` | `OFF_USER_AGENT` | `FoodAware/1.0 (correo@del-equipo)` |
     | `foodaware-staging-backend` | `PYTHON_API_URL` | `https://foodaware-staging-python.onrender.com` |
     | `foodaware-staging-backend` | `CORS_ORIGINS` | `https://foodaware-staging-frontend.onrender.com` |
     | `foodaware-staging-frontend` | `API_URL` | `https://foodaware-staging-backend.onrender.com` |

   - Pulsa *Deploy Blueprint*. El primer despliegue construye las dos imágenes
     Docker y el frontend; puede tardar 10 a 15 minutos.
5. **Desactivar Auto Sync.** En el Blueprint, *Settings → Auto Sync → No*. Así
   un cambio en `render.yaml` no se aplica antes de que pase el CI: se aplica
   a mano con *Manual Sync* (ver "Cambiar la infraestructura").
6. **Revisar las URL.** Abre cada servicio y compara la URL que aparece bajo
   su nombre con la que escribiste en el paso 4. Si alguna tiene sufijo,
   corrígela en la pestaña *Environment* del servicio que la usa y guarda con
   *Save, rebuild, and deploy*:

   | Si cambió la URL de… | Corrige… | En el servicio |
   |---|---|---|
   | python-service | `PYTHON_API_URL` | backend |
   | frontend | `CORS_ORIGINS` | backend |
   | backend | `API_URL` | frontend (se recompila: la URL queda fija en el build) |

   No hace falta cambiar `render.yaml`: un *Manual Sync* no pisa las
   variables `sync: false`.
7. **Probar que responde.** En PowerShell, con las URL reales (la primera
   llamada a cada servicio puede tardar hasta un minuto si estaba dormido):

   ```powershell
   Invoke-RestMethod https://foodaware-staging-python.onrender.com/health
   Invoke-RestMethod https://foodaware-staging-backend.onrender.com/api/health
   Invoke-RestMethod "https://foodaware-staging-backend.onrender.com/api/products/search?q=galletas&limit=3"
   Start-Process https://foodaware-staging-frontend.onrender.com
   ```

   python-service debe responder `estado` `ok` o `degradado`, con 385
   productos en `detalle.cache.productos` (los de la semilla). El backend debe
   reportar `postgresql` y `fastapi` `ok`.
8. **Datos para el despliegue automático.** Copia el ID (`srv-…`, al final de
   la URL de cada servicio en el Dashboard) y la URL pública de los tres
   servicios. En GitHub, *Settings → Environments → New environment*, crea el
   Environment `staging` y agrégale estas Variables (no son secretas):

   | Variable | Valor |
   |---|---|
   | `RENDER_SERVICE_ID_PYTHON` | ID de `foodaware-staging-python` |
   | `RENDER_SERVICE_ID_BACKEND` | ID de `foodaware-staging-backend` |
   | `RENDER_SERVICE_ID_FRONTEND` | ID de `foodaware-staging-frontend` |
   | `STAGING_URL_PYTHON` | URL de python-service, sin `/` al final |
   | `STAGING_URL_BACKEND` | URL del backend, sin `/` al final |
   | `STAGING_URL_FRONTEND` | URL del frontend, sin `/` al final |

   En *Deployment branches and tags* del Environment, deja solo la rama
   `main`: así ningún workflow de otra rama puede desplegar. El workflow de
   despliegue usa además el Secret `RENDER_API_KEY` del paso 3.

## Despliegue automático

Los tres servicios tienen `autoDeployTrigger: "off"`: un push a `main` no
despliega por sí solo. Lo hace el workflow
[`cd-staging.yml`](../.github/workflows/cd-staging.yml) (*CD Staging
(Render)*), en tres jobs:

1. **Verificar el CI del commit.** Se dispara cada vez que termina uno de los
   7 workflows de CI en un push a `main`. Con la API de GitHub revisa que los
   7 (incluido CI Render Blueprint) hayan terminado bien para ese commit. Si
   falta alguno o alguno falló, no despliega y deja el motivo en el resumen de
   la ejecución. Tampoco despliega si `main` ya avanzó a otro commit (ese se
   desplegará con su propio CI) ni si el commit ya se desplegó, porque los 7
   CI terminan por separado y cada uno dispara el workflow.
2. **Desplegar en Render.** Usa el Environment `staging` y le pide a la API de
   Render un deploy de ese commit exacto (`commitId`) para python-service,
   después para el backend y al final para el frontend. Cada uno tiene que
   quedar `live` antes de pasar al siguiente: el backend necesita a
   python-service para su health check y el frontend apunta al backend. Si
   alguno termina en `build_failed`, `update_failed`, `canceled`,
   `pre_deploy_failed` o `deactivated`, o pasan 25 minutos, el workflow falla y
   no sigue con los demás.
3. **Pruebas de salud del staging.** Contra las URL públicas, con reintentos
   cada 15 segundos durante hasta 5 minutos por prueba, para tolerar el
   arranque en frío:

   | Prueba | Pasa si |
   |---|---|
   | `GET /health` de python-service | `estado` es `ok` o `degradado` |
   | `GET /api/health` del backend | `postgresql` y `fastapi` están `ok` |
   | Búsqueda `galletas` por el backend | Devuelve productos con `X-Fuente-Datos: fastapi` (con `respaldo` no quedaría probada la comunicación con FastAPI) |
   | `GET /api/metricas/calidad` | `porcentaje_validos` es mayor que 0 |
   | Frontend | Responde 200 con el HTML de la aplicación (`<app-root>`) |

   Al final escribe una tabla con el resultado y el detalle de cada prueba en
   el resumen de la ejecución.

Se ve en *Actions → CD Staging (Render)*. Una ejecución que no desplegó porque
faltaba algún CI termina en verde con el motivo en el resumen; es normal ver
varias de esas por cada push.

**Redesplegar a mano.** En *Actions → CD Staging (Render) → Run workflow*,
con la rama `main`. Despliega el último commit de `main` aunque ya estuviera
desplegado, pero igual exige que su CI haya pasado. Sirve, por ejemplo,
después de recrear la base o de cambiar una variable en Render.

**Si GitHub Actions no está disponible**, se puede desplegar desde cada
servicio en Render con *Manual Deploy → Deploy latest commit*, en el mismo
orden: python-service, backend y frontend.

## Antes de una demo

Los servicios gratuitos se duermen tras 15 minutos sin tráfico. Para
despertarlos y ver que todo responde:

```powershell
.\scripts\despertar-staging.ps1
```

El script llama a `/health` del python-service, a `/api/health` del backend y
al frontend hasta que todo responde (5 minutos como máximo, se cambia con
`-PlazoSegundos`) y muestra una tabla con el estado de cada uno. Termina con
código 0 si todo quedó listo y con 1 si algo no respondió. Solo hace
peticiones GET. Si PowerShell no deja correr scripts, se puede usar
`powershell -ExecutionPolicy Bypass -File .\scripts\despertar-staging.ps1`.

## Cambiar la infraestructura

1. Edita `render.yaml` en una rama y abre un PR: `CI Render Blueprint` lo valida.
2. Después del merge a `main`, abre el Blueprint en Render y pulsa *Manual Sync*.
   Render muestra los cambios antes de aplicarlos.

Las variables con `sync: false` no se actualizan con el sync: se editan en el
servicio. Los nombres de la base, su región, su usuario y su versión de
PostgreSQL no se pueden cambiar después de crearla.

## Lanzar una ingesta manual en staging

`POST /ingest/runs` exige la clave interna `INGESTA_CLAVE`, que Render generó.
Para verla: servicio `foodaware-staging-python` → *Environment* →
`INGESTA_CLAVE`. En PowerShell, sin dejar la clave en el historial ni en
archivos:

```powershell
$url = "https://foodaware-staging-python.onrender.com"
$segura = Read-Host "INGESTA_CLAVE" -AsSecureString
$clave = (New-Object System.Net.NetworkCredential("", $segura)).Password

# Despierta el servicio (puede tardar hasta un minuto).
Invoke-RestMethod "$url/health"

# Lanza la ingesta (responde 202 y la ejecuta en segundo plano).
Invoke-RestMethod -Method Post -Uri "$url/ingest/runs" `
  -Headers @{ "X-Clave-Ingesta" = $clave } `
  -ContentType "application/json" `
  -Body '{"categorias": ["en:biscuits", "en:dairies"], "max_productos": 100}'

# Revisa cómo terminó (estado "completado" y los conteos).
Invoke-RestMethod "$url/ingest/runs/latest"
Remove-Variable clave, segura
```

Sin la clave, o con una incorrecta, responde 403. El cuerpo admite `pais`
(`chile` por defecto), `categorias` (vacío = todas) y `max_productos` (1 a 500,
100 por defecto). Mantén el servicio con tráfico mientras corre: si pasa
15 minutos sin peticiones, Render lo apaga.

**Los productos que trae una ingesta manual se pierden cuando el servicio se
duerme, se reinicia o se redespliega:** la caché vive en el disco efímero del
contenedor. Al volver a arrancar, el servicio carga de nuevo la semilla. Para
que los datos nuevos sobrevivan hay que regenerar la semilla
(`scripts/exportar_semilla.py`, ver
[contratos/README.md](contratos/README.md)) y desplegar.

## Las ingestas de la semilla en staging

Además de los productos, la semilla trae los resúmenes de las 5 ingestas
reales que armaron el corpus en nuestra caché local (del 21 al 25 de octubre de
2026), con sus conteos, su detalle y las fallas de Open Food Facts que
registraron. Al arrancar con la caché vacía se importan con
`"origen": "semilla"`, para no confundirlas con ingestas hechas en staging. Por
eso, recién desplegado:

- `GET /metrics/quality` (y `/api/metricas/calidad` del backend) muestra los
  valores reales del corpus y no ceros: 75,47 % de válidos, 70,96 % de
  duplicados y 75,31 % de cobertura de ingredientes.
- `GET /ingest/runs/latest` (y `/api/ingesta/ultima` del backend) devuelve la
  última de esas ingestas, la del 25 de octubre, con `"origen": "semilla"`.
- `/health` sigue con `openfoodfacts` `no_verificado` y `/search` con
  `estado_fuente` `cache`: staging no ha consultado la fuente por su cuenta.
- La primera ingesta periódica no se adelanta: se programa 24 horas después
  del arranque, igual que antes.

Si se lanza una ingesta manual, queda con `"origen": "ingesta"`, pasa a ser la
última y sus conteos se suman a los de la semilla hasta que el servicio se
reinicie. Precision@5 sale del índice y no de las ingestas, así que no cambia:
sigue en 0,53.

Para regenerar la semilla desde la caché del volumen de Docker sin modificarla
(el script de exportación agrega columnas nuevas si la base es antigua), se
copia primero la base con la API de backup de SQLite:

```powershell
docker compose exec python-service python -c "import sqlite3; s=sqlite3.connect('file:/data/foodaware-cache.sqlite3?mode=ro', uri=True); d=sqlite3.connect('/tmp/copia.sqlite3'); s.backup(d); d.close()"
docker compose exec python-service python scripts/exportar_semilla.py --db /tmp/copia.sqlite3 --salida /tmp/corpus-off.json.gz
docker compose cp python-service:/tmp/corpus-off.json.gz python-service/semilla/corpus-off.json.gz
```

El script avisa si hay una ingesta en curso, porque esa no queda en la semilla.

## Recrear la base cada 30 días

La base gratuita vence 30 días después de crearse. Render avisa por correo;
después del vencimiento queda inaccesible, y a los 14 días se borra. La
nuestra vence el 24 de noviembre de 2026, según el Dashboard de la base.

1. En Render, elimina `foodaware-staging-db` (*Settings → Delete Database*).
2. En el Blueprint, pulsa *Manual Sync*: crea una base nueva con el mismo nombre
   y conecta de nuevo las variables `DB_*` del backend.
3. Redespliega con *Run workflow* en CD Staging (ver "Despliegue automático"),
   o solo el backend desde Render: las migraciones crean las tablas al iniciar.

Se pierden los usuarios registrados y los productos que el backend guardó
desde las búsquedas (su respaldo); los productos vuelven a guardarse con las
búsquedas siguientes.

## Limitaciones del plan gratuito

Según la [documentación de Render](https://render.com/docs/free):

- **Se duerme:** cada web service se apaga tras 15 minutos sin tráfico entrante
  y tarda cerca de un minuto en despertar. La primera petición después de una
  pausa es lenta. Si python-service está dormido, el backend agota sus
  reintentos y responde desde la base (header `X-Fuente-Datos: respaldo`).
  Antes de una demo hay que despertar los servicios (ver "Antes de una demo").
- **Disco efímero:** la caché SQLite de python-service se pierde en cada
  reinicio, despliegue o apagado; no se pueden agregar discos persistentes.
  Por eso el servicio arranca con la semilla del corpus.
- **La ingesta periódica no alcanza a correr:** está programada cada 24 horas
  desde el arranque, pero Render apaga el servicio tras 15 minutos sin tráfico
  y lo reinicia cuando quiere. En la práctica, los datos de staging son los de
  la semilla (`python-service/semilla/corpus-off.json.gz`) y no se actualizan
  solos. `INGESTA_AL_INICIAR` está en `false` para no repetir una ingesta
  completa en cada arranque en frío. Para traer datos nuevos, ver "Lanzar una
  ingesta manual".
- **Recursos:** 0.1 CPU y 512 MB por web service, una sola instancia. La base
  tiene 0.1 CPU, 256 MB, 1 GB de disco, sin backups ni pooling.
- **Base que vence:** una sola base gratuita por workspace, que vence a los
  30 días (ver "Recrear la base cada 30 días").
- **Cuotas del workspace:** 750 horas de instancia al mes (un servicio dormido
  no consume horas), unos 500 minutos de build y 5 GB de salida al mes. Sin
  tarjeta, al pasarse se bloquean los builds o se suspenden los servicios hasta
  el mes siguiente. Cada despliegue completo construye dos imágenes Docker y el
  frontend. Por eso el CD solo despliega commits de `main` con todo el CI en
  verde, una vez por commit, y no las ramas de trabajo.
- **Sin Shell ni one-off jobs:** no se puede entrar al contenedor; los
  diagnósticos se hacen con los logs del Dashboard y los endpoints de salud.
- **Reinicios:** Render puede reiniciar los servicios o hacer mantenimiento de
  la base en cualquier momento.

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| La primera petición tarda ~1 min o da 502 | El servicio estaba dormido | Reintentar, o correr `scripts/despertar-staging.ps1` antes de usarlo |
| Un push a `main` no se desplegó | Algún CI falló o todavía no terminaba, o `main` avanzó | Revisar el resumen de las ejecuciones de CD Staging: cada una dice por qué no desplegó |
| CD Staging falla en "Desplegar en Render" | El build o el arranque falló en Render, o falta una Variable del Environment o el Secret `RENDER_API_KEY` | El error dice qué servicio y en qué estado quedó; los logs del build están en el Dashboard de Render. Los servicios anteriores en el orden ya quedaron con el commit nuevo |
| CD Staging falla en las pruebas de salud | Un servicio no despertó en 5 minutos, o el despliegue quedó funcionando mal | La tabla del resumen dice qué prueba falló y qué respondió; repetir con *Re-run failed jobs* si fue un arranque lento |
| Búsqueda con `X-Fuente-Datos: respaldo` | python-service dormido o lento | Despertar python-service (`/health`) y repetir |
| `/api/health` del backend con `fastapi: error` | `PYTHON_API_URL` no coincide con la URL real o python-service está dormido | Revisar el paso 6; despertar python-service |
| El frontend no llega al backend (error de red o CORS) | `API_URL` o `CORS_ORIGINS` con una URL distinta, o `API_URL` terminada en `/api` | Revisar el paso 6 y redesplegar el frontend |
| El deploy falla porque Render no detecta un puerto abierto | El servicio no escucha en `PORT` | Revisar `PORT` en `render.yaml` (8000 y 3000) |
| python-service con `cache.productos` en 0 | La semilla no se cargó | Revisar los logs ("Semilla cargada…" o el error) |
| El panel de métricas muestra 0 % y "Todavía no hay ninguna ingesta" | Se desplegó una semilla anterior, sin el historial de ingestas | Regenerar la semilla (ver "Las ingestas de la semilla en staging") y desplegar; el log de arranque dice cuántas ejecuciones importó |
