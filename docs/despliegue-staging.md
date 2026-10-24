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

Las URL de la tabla son las que Render asigna si el nombre está libre. Si ya
existe en otra cuenta, agrega un sufijo (por ejemplo
`foodaware-staging-python-a1b2.onrender.com`). Por eso las tres variables que
llevan URL (`PYTHON_API_URL`, `CORS_ORIGINS` y `API_URL`) no están fijas en
`render.yaml`: son `sync: false`, se completan al crear el Blueprint y, si
hace falta, se corrigen en Render sin tocar el repositorio (paso 6).

## Pendiente

Solo falta el workflow de despliegue automático. Mientras no exista, los
servicios (con `autoDeployTrigger: "off"`) se despliegan a mano (ver
"Despliegues siguientes").

Lo que estaba pendiente en el código antes de publicar ya está resuelto en
`main`: el frontend toma `API_URL` al compilar, el backend restringe CORS con
`CORS_ORIGINS` y escucha en `PORT`, y Trivy ya no encuentra vulnerabilidades
CRITICAL con arreglo en la imagen del backend.

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

   python-service debe responder `estado` `ok` o `degradado`, con unos 383
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

   El workflow de despliegue usa además el Secret `RENDER_API_KEY` del paso 3.

## Despliegues siguientes

Los tres servicios tienen `autoDeployTrigger: "off"`: un push a `main` no
despliega por sí solo. El despliegue automático lo dispara GitHub Actions
cuando pasa todo el CI de `main` (workflow de despliegue, en preparación).
Mientras tanto, se puede desplegar a mano desde cada servicio con
*Manual Deploy → Deploy latest commit*, en este orden: python-service, backend
y frontend.

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

## Recrear la base cada 30 días

La base gratuita vence 30 días después de crearse. Render avisa por correo;
después del vencimiento queda inaccesible, y a los 14 días se borra.

1. En Render, elimina `foodaware-staging-db` (*Settings → Delete Database*).
2. En el Blueprint, pulsa *Manual Sync*: crea una base nueva con el mismo nombre
   y conecta de nuevo las variables `DB_*` del backend.
3. Redespliega el backend: las migraciones crean las tablas al iniciar.

Se pierden los usuarios registrados y los productos que el backend guardó
desde las búsquedas (su respaldo); los productos vuelven a guardarse con las
búsquedas siguientes.

## Limitaciones del plan gratuito

Según la [documentación de Render](https://render.com/docs/free):

- **Se duerme:** cada web service se apaga tras 15 minutos sin tráfico entrante
  y tarda cerca de un minuto en despertar. La primera petición después de una
  pausa es lenta. Si python-service está dormido, el backend agota sus
  reintentos y responde desde la base (header `X-Fuente-Datos: respaldo`).
  Antes de una demo hay que despertar los servicios.
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
  frontend: conviene no desplegar en cada commit de prueba.
- **Sin Shell ni one-off jobs:** no se puede entrar al contenedor; los
  diagnósticos se hacen con los logs del Dashboard y los endpoints de salud.
- **Reinicios:** Render puede reiniciar los servicios o hacer mantenimiento de
  la base en cualquier momento.

## Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| La primera petición tarda ~1 min o da 502 | El servicio estaba dormido | Reintentar; despertar los servicios antes de usarlos |
| Búsqueda con `X-Fuente-Datos: respaldo` | python-service dormido o lento | Despertar python-service (`/health`) y repetir |
| `/api/health` del backend con `fastapi: error` | `PYTHON_API_URL` no coincide con la URL real o python-service está dormido | Revisar el paso 6; despertar python-service |
| El frontend no llega al backend (error de red o CORS) | `API_URL` o `CORS_ORIGINS` con una URL distinta, o `API_URL` terminada en `/api` | Revisar el paso 6 y redesplegar el frontend |
| El deploy falla porque Render no detecta un puerto abierto | El servicio no escucha en `PORT` | Revisar `PORT` en `render.yaml` (8000 y 3000) |
| python-service con `cache.productos` en 0 | La semilla no se cargó | Revisar los logs ("Semilla cargada…" o el error) |
