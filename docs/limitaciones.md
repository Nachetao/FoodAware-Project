# Limitaciones conocidas

Aquí juntamos lo que sabemos que FoodAware no hace bien o no hace todavía.
Para cada limitación anotamos qué impacto tiene y qué hicimos para mitigarla,
o qué falta hacer. Las agrupamos por tema; el orden dentro de cada grupo va
de lo que más nos preocupa a lo que menos.

La más importante va primero, aunque se repita en varios documentos: la
información de alérgenos de FoodAware es orientativa y no reemplaza leer la
etiqueta del producto.

Los riesgos de seguridad, ordenados por categoría STRIDE y con los controles
que ya existen, están en el [modelo de amenazas](modelo-amenazas.md).

## 1. Fuente de datos

| Limitación | Impacto | Mitigación o plan |
|---|---|---|
| Open Food Facts es colaborativa y sus datos pueden estar mal o desactualizados | Un alérgeno mal transcrito o una receta antigua llega tal cual a la app | Unimos las etiquetas de la fuente con lo que detectamos en el texto, guardamos la procedencia de cada producto (`url_fuente`, `modificado_en_fuente`) y refrescamos la caché cada 24 h. El detalle de cada producto muestra la fecha en que se recuperó y enlaza a su ficha original. Falta advertir en la interfaz que los datos pueden tener errores |
| Muchos productos llegan incompletos | El 24,5 % de lo recuperado en las 5 ingestas es inválido, sobre todo por no tener ingredientes (94 de los 101 inválidos de la última, del 25 de octubre) | Esos productos no se guardan ni se buscan, porque sin ingredientes no se pueden revisar los alérgenos. La métrica de cobertura de ingredientes lo deja a la vista |
| `/api/v2/search` responde 503 seguido | En las ingestas que lo registran falló entre el 21 % y el 53 % de las páginas, y las 5 ingestas terminaron `completado_con_errores` | Reintentos con backoff más largo para las búsquedas, segunda ronda por categoría después de 60 s, semilla del corpus para no depender de una ingesta al arrancar |
| Límites de tasa de la fuente | Nuestras ingestas reales tardaron entre 3 y 7 minutos, y una petición de usuario puede recibir 503 si el limitador está lleno | Nos quedamos bajo los límites oficiales (12 lecturas y 8 búsquedas por minuto) y la búsqueda nunca consulta la fuente en vivo |
| Corpus chico | 385 productos de 7 categorías, solo de Chile. Si un producto no está, no aparece | Las categorías se eligieron por ser las más relevantes para alergias. Se puede ampliar con `INGESTA_CATEGORIAS` e `INGESTA_MAX_PRODUCTOS`, a costa de ingestas más largas |
| Categorías desbalanceadas | De 31 panes a 100 cereales, lo que afecta qué consultas tienen buenos resultados | El reparto de la cuota por categoría lo atenúa; la evaluación informa cuántos relevantes tiene cada consulta |
| La atribución no aparece en la lista de resultados | La licencia ODbL pide atribuir la fuente donde se muestran los datos | La atribución está en cada producto (`procedencia`), en la semilla y en el detalle del producto en el frontend ("Datos de Open Food Facts", con la licencia ODbL). Falta agregarla a la lista de resultados de la búsqueda |

## 2. Detección de alérgenos

| Limitación | Impacto | Mitigación o plan |
|---|---|---|
| La negación no pasa de la primera coma | En "libre de leche, lactosa, caseína, gluten" (producto 10248188) solo se descarta "leche" y se marcan lácteos y gluten: un falso positivo | Lo dejamos así a propósito: extender la negación crearía falsos negativos en textos como "cacao sin azúcar, leche". Está cubierto por pruebas y documentado en el contrato |
| Solo detecta lo que está en el diccionario | Un sinónimo o un nombre técnico que no agregamos pasa sin marcar: un falso negativo, que es el error más grave | El diccionario tiene sinónimos en español de Chile y en inglés para los 14 alérgenos, y se une con las etiquetas de Open Food Facts. Cada nuevo caso que encontremos se agrega con su prueba y subiendo la versión de procesamiento |
| Términos ambiguos se marcan siempre | "harina" sin más se marca como gluten y "manteca" como lácteo, aunque a veces no lo sean | Es la regla de "ante la duda, se marca". Solo excluimos los casos claros ("harina de arroz", "manteca de cacao") |
| No corregimos las etiquetas de Open Food Facts | Si la fuente marca un alérgeno de más, nosotros también. Pasa con el Not Milk Zero Sugar (7804659650998), etiquetado `en:milk` | Preferimos un falso positivo antes que borrar lo que declara la fuente. Las marcas que vienen solo del texto quedan identificadas en `calidad.problemas` |
| La lecitina sin origen (E322) queda como "posible" | No se cuenta como soya, aunque muchas veces lo es | Queda registrada como `alergeno_posible:soya` para que la capacidad adaptativa pueda decidir según el perfil |
| Las trazas dependen de frases conocidas | Una advertencia escrita de otra forma ("se fabrica junto a productos con...") puede no reconocerse | La lista de frases cubre las formas más comunes en español e inglés; se amplía igual que el diccionario |
| Productos sin texto de ingredientes | No se pueden revisar | Se marcan como inválidos y no aparecen en la búsqueda |
| El análisis manual de la EP1 (`/analizar`) usa otra lista | Da resultados distintos a la búsqueda para los mismos ingredientes, y devuelve "lácteos" con tilde en vez del código `lacteos` | Pendiente: hacer que `/analizar` use la misma detección que la búsqueda |
| Las dietas vegana y vegetariana solo se revisan por alérgenos | La carne, la miel y la gelatina no son alérgenos, así que el veredicto no puede saber si un producto las tiene | Un producto sin la etiqueta de la dieta queda en `apto_con_advertencia` ("No declara cumplir la dieta vegana"), nunca en `apto`. Solo es `apto` si Open Food Facts lo etiqueta con esa dieta, y `no_apto` si trae un alérgeno de origen animal (lácteos, huevo, pescado, crustáceos o moluscos para la vegana; los tres últimos para la vegetariana). Ver la tabla de reglas en el [contrato](contratos/README.md#capacidad-adaptativa) |

## 3. Búsqueda

| Limitación | Impacto | Mitigación o plan |
|---|---|---|
| BM25 es léxico y no entiende "sin" | Las consultas con restricción tienen Precision@5 de 0,20. En "chocolate sin leche", "snack sin maní" y "bebida vegetal sin soya", los 5 primeros resultados tienen justo el alérgeno que se quiere evitar | No se arregla con más sinónimos ni con otros pesos. Es lo que resuelve la capacidad adaptativa: filtrar por los alérgenos detectados según el perfil ([capacidad-adaptativa.md](capacidad-adaptativa.md)) |
| "leche sin lactosa" rinde peor en la búsqueda personalizada | "Sin lactosa" se interpreta como la dieta `sin_lactosa`, que solo se confirma con la etiqueta de Open Food Facts. Los deslactosados sin esa etiqueta, como la Leche Descremada Zero Lacto, quedan en `apto_con_advertencia` y bajan (del puesto 1 al 46), mientras suben kéfires y yogures que sí la tienen. Precision@5 baja de 0,40 en `/search` a 0,20 en la personalizada | Ninguno queda como `apto` sin la etiqueta, que es lo seguro, pero el orden empeora. Se podría confirmar la dieta también por el nombre ("sin lactosa", "deslactosada", "zero lacto") y dejar esas palabras en el texto que busca BM25 ([recuperacion-y-evaluacion.md](recuperacion-y-evaluacion.md#8-evaluación-de-la-capacidad-adaptativa)) |
| Sin corrección de errores de tipeo | "galeta" no encuentra "galleta" | Pendiente; se podría agregar una búsqueda aproximada sobre el vocabulario del índice |
| El singular y los sinónimos son reglas simples | Algunas palabras quedan mal ("pasas" pasa a "pasa", igual que el verbo) y faltan sinónimos que no vimos en el corpus | Como productos y consultas pasan por la misma función, los errores se cancelan en la mayoría de los casos. Los sinónimos se agregan solo si aparecen en el corpus real |
| El índice vive en memoria y se reconstruye entero | Con unos 380 productos tarda unos 120 ms; con decenas de miles sería lento y ocuparía mucha memoria | Para el tamaño actual sobra. Si el corpus crece, habría que pasar a un motor de búsqueda dedicado |
| El conjunto de evaluación es chico y lo armamos nosotros | 20 consultas pensadas por el equipo, con reglas que dependen de las categorías de Open Food Facts | Las reglas se aplican sobre todo el corpus (el recall es exacto) y comparamos siempre contra la misma línea base. Los números sirven para comparar versiones, no como nota absoluta |
| El respaldo del backend es más simple que BM25 | Si el python-service se cae, el orden de los resultados es peor y solo incluye productos que alguien buscó antes | Es un respaldo para que la app no quede en blanco, y el frontend avisa cuando se usa |
| `estado_fuente` es poco preciso | Vale `online` aunque la última ingesta haya tenido errores, y `cache` solo si falló entera o si no hay ninguna propia (en staging recién desplegado, donde solo están las de la semilla) | El detalle real está en `/health` y en `/ingest/runs/latest` |

## 4. Staging en el plan gratuito

Las limitaciones propias de Render gratuito (se duerme tras 15 minutos, disco
efímero, la base vence a los 30 días, 0,1 CPU, sin shell, cuotas mensuales)
están explicadas en
[despliegue-staging.md](despliegue-staging.md#limitaciones-del-plan-gratuito).
Lo que importa para el proyecto:

| Limitación | Impacto | Mitigación o plan |
|---|---|---|
| El servicio se duerme y el disco se borra | La primera petición tarda cerca de un minuto y la caché se pierde en cada reinicio | El servicio carga la semilla del corpus al arrancar; el backend responde desde su respaldo si el python-service tarda |
| La ingesta periódica no alcanza a correr | Los datos de staging son los de la semilla y no se actualizan solos; la antigüedad crece todos los días | Regenerar la semilla (`scripts/exportar_semilla.py`) y desplegar cuando haga falta |
| Las métricas de ingesta de staging vienen de la semilla | El panel muestra los conteos de las 5 ingestas que hicimos en local (del 21 al 25 de octubre), no de ingestas hechas en staging | Es a propósito, para que el panel no quede en cero: esas ejecuciones vienen con `origen: "semilla"` y no cuentan para `/health` ni para el planificador ([despliegue-staging.md](despliegue-staging.md#las-ingestas-de-la-semilla-en-staging)) |
| Las URL de Render se conocen recién al crear los servicios | Si Render agrega un sufijo a un nombre, la URL real no es la esperada y el backend o el frontend apuntan a otra parte | `PYTHON_API_URL`, `CORS_ORIGINS` y `API_URL` son `sync: false`: se completan al crear el Blueprint y se corrigen en Render sin tocar el repositorio ([paso 6](despliegue-staging.md#primer-despliegue-paso-a-paso)). En nuestro staging no hubo sufijos |
| El despliegue no es atómico entre servicios | Si python-service queda `live` y el backend falla, staging queda un rato con versiones de commits distintos | El CD despliega en orden y se detiene en el primero que falla, así que nunca queda un frontend nuevo sobre un backend viejo. El CD no vuelve atrás solo: deja en su resumen cómo correr "Rollback staging", que redespliega la última versión que pasó todas las pruebas de salud ([despliegue-staging.md](despliegue-staging.md#versión-desplegada-y-rollback)). No es automático a propósito, y un rollback no deshace las migraciones de la base |
| Las pruebas de salud corren después de desplegar | Si una falla, el commit ya está publicado en staging | Es staging y no producción: la prueba deja el workflow en rojo y la tabla del resumen dice qué falló |
| El python-service tiene URL pública | En el plan gratuito no hay red privada, así que cualquiera puede llegar a sus endpoints. `GET /products/{codigo}` con un código que no está en la caché consume el límite de lecturas a Open Food Facts | Los endpoints que consume el backend exigen `X-Clave-Servicio` (obligatoria: sin ella, 403) y las ingestas, `INGESTA_CLAVE`; el limitador protege a la fuente (12 lecturas por minuto). Solo `/health`, `/` y la documentación quedan públicos ([despliegue-staging.md](despliegue-staging.md#activar-la-clave-entre-servicios)) |

## 5. Seguridad y vulnerabilidades

Corrimos Trivy en local sobre las imágenes del python-service y del frontend
el 23 de octubre de 2026 (construidas desde `main`). En CI las cifras pueden
variar un poco, porque ahí se baja la imagen base más nueva. La imagen del
backend cambió después; en CI, en el commit `545168e` de `main`, pasa el gate
de Trivy.

| Imagen | CRITICAL | HIGH | De dónde vienen |
|---|---:|---:|---|
| backend | 0 con arreglo | ver la pestaña Security | Desde el PR #17 la imagen usa `node:22-alpine`, sin npm ni npx en la imagen final, y fuerza versiones parcheadas de `multer` y `body-parser`. Con eso desapareció el CRITICAL de `tar` y las 23 HIGH que venían del npm de la imagen base. El recuento actual de HIGH está en el reporte de Trivy que CI sube a la pestaña Security |
| python-service | 0 | 44 | Todas de paquetes del sistema de Debian 13 (`util-linux`, `ncurses`, `systemd`, `perl-base`...), ninguna con arreglo publicado |
| frontend | 0 | 0 | La imagen final es nginx con archivos estáticos |

| Limitación | Impacto | Mitigación o plan |
|---|---|---|
| Las HIGH no bloquean el pipeline | Quedan vulnerabilidades altas conocidas en producción | Se reportan en la pestaña Security. Las del backend que vienen de dependencias se corrigen actualizándolas; las 44 del python-service dependen de que Debian publique el arreglo |
| `npm audit` solo bloquea con críticas | Una dependencia de Node con una vulnerabilidad alta pasa | Decidimos ese umbral para que el pipeline no quede siempre en rojo; las altas aparecen igual en Trivy |
| `main` exige los 15 checks, pero no una revisión aprobada | Antes de la protección, los PR #15 y #16 se integraron con CI Seguridad en rojo. Hoy un integrante puede unir su propio Pull Request sin que el otro lo revise, siempre que los 15 checks estén en verde | El ruleset `Proteger main` está activo: exige Pull Request, los 15 checks con la rama al día, y bloquea el borrado y los force push, sin excepciones ni para administradores. Pedimos 0 aprobaciones porque somos dos y GitHub no deja aprobar el propio Pull Request. Además, el CD no despliega un commit de `main` con algún CI en rojo. El ruleset está declarado en Terraform ([pipeline-devsecops.md](pipeline-devsecops.md#protección-de-main)) |
| La vuelta atrás de la clave entre servicios es manual | Con la clave obligatoria (`CLAVE_SERVICIO_OBLIGATORIA=true`), si el backend se queda sin `CLAVE_SERVICIO` FastAPI lo rechaza con 403: la búsqueda y el detalle siguen desde el respaldo de la base, pero las métricas responden 502 y los resultados no son los del motor | CI Integración prueba los tres casos (clave incorrecta, sin clave y correcta) en cada push. En staging la clave la copia Render con `fromService`. Si pasara, se vuelve a `false` en la pestaña *Environment* de python-service ([despliegue-staging.md](despliegue-staging.md#activar-la-clave-entre-servicios)). `/health` sigue público a propósito: lo usan Render y Docker |
| La clave entre servicios es una sola clave compartida | Si se filtra, sirve para llamar a todos los endpoints internos hasta que se cambie | Render la genera y la copia al backend con `fromService`, así no pasa por personas ni por el repositorio. No hay rotación automática: para cambiarla se regenera en Render y se redespliegan los dos servicios |

## 6. Terraform y el Blueprint de Render

| Limitación | Impacto | Mitigación o plan |
|---|---|---|
| Terraform no administra Render | `terraform/` declara la configuración de GitHub (el ruleset de `main` y el Environment `staging` con sus Variables); los servicios de staging están en `render.yaml` | Al revisar el proveedor de Terraform para Render nos dimos cuenta de que su API no permite crear ni modificar web services del plan gratuito. Por eso usamos el Blueprint, que también es infraestructura como código y CI lo valida. Ver [despliegue-staging.md](despliegue-staging.md#por-qué-blueprint-y-no-terraform) |
| El `apply` de Terraform es manual y local | Un cambio unido a `main` no llega a GitHub hasta que alguien lo aplica; mientras tanto, el plan de CI lo muestra como diferencia (sin fallar) | Es a propósito: así ningún token con escritura sobre la configuración del repositorio pasa por CI. Los pasos están en [pipeline-devsecops.md](pipeline-devsecops.md#aplicar-un-cambio-powershell-con-docker) |
| Terraform no administra los Secrets ni las Variables del repositorio | `RENDER_API_KEY`, `CLAVE_SERVICIO_STAGING` y las Variables a nivel de repositorio se siguen creando a mano | Los Secrets quedarían en el estado. Las Variables del repositorio tienen todas un valor por defecto en los workflows |
| Los tags `staging-verificado-*` no están protegidos | Alguien con permiso de escritura podría crear, mover o borrar uno a mano, y "Rollback staging" volvería a un commit que no pasó las pruebas en staging (o no encontraría a dónde volver) | Mejora futura: un ruleset de tags que solo deje crearlos a los workflows y nadie los mueva ni borre. Lo intentamos en Terraform, pero GitHub rechazó su creación con un error 422 de validación, y por el plazo de la entrega lo dejamos fuera. Mientras tanto, solo los dos integrantes tienen escritura y el CD solo crea el tag cuando pasan todas las pruebas |
| El provider de GitHub no conoce todas las opciones del ruleset de `main` | Opciones nuevas de GitHub (por ejemplo `require_extra_approval_for_unattributed_changes`) no aparecen en el plan; un cambio hecho solo ahí en la interfaz no se detecta | Hoy esas opciones tienen el valor que GitHub les dio al crear el ruleset a mano. Se revisan en la interfaz al cambiar el ruleset |
| El estado del Blueprint lo guarda Render | No hay un `plan` local que muestre los cambios antes de aplicarlos | CI valida `render.yaml` contra la API de Render (que muestra lo que crearía un sync), Auto Sync está desactivado y los cambios se aplican a mano con *Manual Sync* después del merge |
| Si se pasara a un plan pagado | Se podrían llevar los servicios de Render a Terraform (el backend remoto ya existe en HCP Terraform), pero ese estado guardaría las contraseñas de la base | Por ahora no es necesario |

## 7. Resueltas

Estas limitaciones aparecían en versiones anteriores de este documento y ya
están corregidas en `main`; las primeras se resolvieron en la EP2. Las que
venían de la EP1 están también en
[estado-del-proyecto.md](estado-del-proyecto.md#correcciones-de-la-ep1).

| Limitación | Cómo se resolvió |
|---|---|
| No había workflow de despliegue y cada despliegue era manual desde Render | `CD Staging (Render)` despliega cada commit de `main` con todo el CI en verde y prueba las URL públicas ([despliegue-staging.md](despliegue-staging.md#despliegue-automático)) |
| El panel de métricas de staging mostraba 0 % y "Todavía no hay ninguna ingesta" | La semilla trae el historial real de las ingestas que armaron el corpus, marcado con `origen: "semilla"` |
| CI Seguridad fallaba en `main` por el CRITICAL de `tar` (CVE-2026-59873) en la imagen del backend | La imagen final del backend usa `node:22-alpine` sin npm ni npx (PR #17). En el commit `545168e` de `main`, los 7 workflows están en verde |
| Endpoints de prueba de la EP1 sin autenticación (`GET /api/food/test-alergia` creaba usuarios) | Se quitaron, y el backend exige JWT en todas las rutas salvo las públicas (PR #17) |
| El frontend no leía `API_URL` y en Render llamaba a `http://localhost:3000` | La compilación toma la URL del backend de `API_URL` (PR #17) |
| El backend no leía `CORS_ORIGINS` y aceptaba cualquier origen | CORS queda restringido a los orígenes de `CORS_ORIGINS`, y el backend escucha en `PORT` (PR #17) |
| La interfaz no mostraba un aviso de que la información es orientativa | El frontend muestra un aviso permanente ([`aviso-orientativo.ts`](../frontend/src/app/compartido/aviso-orientativo.ts)) en el inicio, en la búsqueda y en el detalle del producto, con el mismo texto que el campo `aviso` de cada veredicto: "revisa siempre la etiqueta del envase" (PR #39) |
