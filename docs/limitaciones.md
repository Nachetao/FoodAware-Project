# Limitaciones conocidas

Aquí juntamos lo que sabemos que FoodAware no hace bien o no hace todavía.
Para cada limitación anotamos qué impacto tiene y qué hicimos para mitigarla,
o qué falta hacer. Las agrupamos por tema; el orden dentro de cada grupo va
de lo que más nos preocupa a lo que menos.

La más importante va primero, aunque se repita en varios documentos: la
información de alérgenos de FoodAware es orientativa y no reemplaza leer la
etiqueta del producto.

## 1. Fuente de datos

| Limitación | Impacto | Mitigación o plan |
|---|---|---|
| Open Food Facts es colaborativa y sus datos pueden estar mal o desactualizados | Un alérgeno mal transcrito o una receta antigua llega tal cual a la app | Unimos las etiquetas de la fuente con lo que detectamos en el texto, guardamos la procedencia de cada producto (`url_fuente`, `modificado_en_fuente`) y refrescamos la caché cada 24 h. El detalle de cada producto muestra la fecha en que se recuperó y enlaza a su ficha original. Falta advertir en la interfaz que los datos pueden tener errores |
| Muchos productos llegan incompletos | El 24 % de lo recuperado es inválido, sobre todo por no tener ingredientes (83 de los 86 inválidos de la última ingesta) | Esos productos no se guardan ni se buscan, porque sin ingredientes no se pueden revisar los alérgenos. La métrica de cobertura de ingredientes lo deja a la vista |
| `/api/v2/search` responde 503 seguido | En las ingestas que lo registran falló entre el 35 % y el 53 % de las páginas, y las 4 ingestas terminaron `completado_con_errores` | Reintentos con backoff más largo para las búsquedas, segunda ronda por categoría después de 60 s, semilla del corpus para no depender de una ingesta al arrancar |
| Límites de tasa de la fuente | Nuestras ingestas reales tardaron entre 3 y 7 minutos, y una petición de usuario puede recibir 503 si el limitador está lleno | Nos quedamos bajo los límites oficiales (12 lecturas y 8 búsquedas por minuto) y la búsqueda nunca consulta la fuente en vivo |
| Corpus chico | 383 productos de 7 categorías, solo de Chile. Si un producto no está, no aparece | Las categorías se eligieron por ser las más relevantes para alergias. Se puede ampliar con `INGESTA_CATEGORIAS` e `INGESTA_MAX_PRODUCTOS`, a costa de ingestas más largas |
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
| La interfaz no muestra un aviso de que la información es orientativa | Una persona podría confiar en la app sin leer la etiqueta | Pendiente en el frontend |

## 3. Búsqueda

| Limitación | Impacto | Mitigación o plan |
|---|---|---|
| BM25 es léxico y no entiende "sin" | Las consultas con restricción tienen Precision@5 de 0,20. En "chocolate sin leche", "snack sin maní" y "bebida vegetal sin soya", los 5 primeros resultados tienen justo el alérgeno que se quiere evitar | No se arregla con más sinónimos ni con otros pesos. Es lo que resuelve la capacidad adaptativa: filtrar por los alérgenos detectados según el perfil ([capacidad-adaptativa.md](capacidad-adaptativa.md)) |
| Sin corrección de errores de tipeo | "galeta" no encuentra "galleta" | Pendiente; se podría agregar una búsqueda aproximada sobre el vocabulario del índice |
| El singular y los sinónimos son reglas simples | Algunas palabras quedan mal ("pasas" pasa a "pasa", igual que el verbo) y faltan sinónimos que no vimos en el corpus | Como productos y consultas pasan por la misma función, los errores se cancelan en la mayoría de los casos. Los sinónimos se agregan solo si aparecen en el corpus real |
| El índice vive en memoria y se reconstruye entero | Con 383 productos tarda unos 120 ms; con decenas de miles sería lento y ocuparía mucha memoria | Para el tamaño actual sobra. Si el corpus crece, habría que pasar a un motor de búsqueda dedicado |
| El conjunto de evaluación es chico y lo armamos nosotros | 20 consultas pensadas por el equipo, con reglas que dependen de las categorías de Open Food Facts | Las reglas se aplican sobre todo el corpus (el recall es exacto) y comparamos siempre contra la misma línea base. Los números sirven para comparar versiones, no como nota absoluta |
| El respaldo del backend es más simple que BM25 | Si el python-service se cae, el orden de los resultados es peor y solo incluye productos que alguien buscó antes | Es un respaldo para que la app no quede en blanco, y el frontend avisa cuando se usa |
| `estado_fuente` es poco preciso | Vale `online` aunque la última ingesta haya tenido errores, y `cache` solo si falló entera | El detalle real está en `/health` y en `/ingest/runs/latest` |

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
| Las URL de Render se conocen recién al crear los servicios | Si Render agrega un sufijo a un nombre, la URL real no es la esperada y el backend o el frontend apuntan a otra parte | `PYTHON_API_URL`, `CORS_ORIGINS` y `API_URL` son `sync: false`: se completan al crear el Blueprint y se corrigen en Render sin tocar el repositorio ([paso 6](despliegue-staging.md#primer-despliegue-paso-a-paso)) |
| No hay workflow de despliegue | Cada despliegue es manual desde el panel de Render | Pendiente: un workflow que despliegue cuando pase todo el CI de `main` |
| El python-service tiene URL pública | En el plan gratuito no hay red privada, así que cualquiera puede llamar a `/search` o `/products`. `GET /products/{codigo}` con un código que no está en la caché consume el límite de lecturas a Open Food Facts | El limitador protege a la fuente (12 lecturas por minuto) y las ingestas están protegidas con `INGESTA_CLAVE`. Lo que no evita es que alguien gaste nuestra cuota de lecturas |

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
| `main` no exige los checks antes del merge | Los PR #15 y #16 se integraron con CI Seguridad en rojo | Activar la protección de rama con los checks obligatorios |
| Endpoints públicos del python-service | `/metrics/*`, `/health` y `/ingest/runs/latest` no tienen autenticación | No exponen datos personales ni secretos, solo conteos. La ingesta, que es lo costoso, sí está protegida |

## 6. Terraform y el Blueprint de Render

| Limitación | Impacto | Mitigación o plan |
|---|---|---|
| `terraform/` no despliega nada | Solo declara el proveedor de AWS y dos variables, sin recursos; `terraform plan` sale vacío. La infraestructura real de staging está en `render.yaml` | Al revisar el proveedor de Terraform para Render nos dimos cuenta de que su API no permite crear ni modificar web services del plan gratuito. Por eso usamos el Blueprint, que también es infraestructura como código y CI lo valida. Ver [despliegue-staging.md](despliegue-staging.md#por-qué-blueprint-y-no-terraform) |
| El estado del Blueprint lo guarda Render | No hay un `plan` local que muestre los cambios antes de aplicarlos | CI valida `render.yaml` contra la API de Render (que muestra lo que crearía un sync), Auto Sync está desactivado y los cambios se aplican a mano con *Manual Sync* después del merge |
| Si se pasara a un plan pagado | Se podría volver a Terraform, pero habría que agregarle un backend remoto para el estado, y ese estado guardaría las contraseñas | Por ahora no es necesario |

## 7. Resueltas antes de publicar staging

Estas limitaciones aparecían en versiones anteriores de este documento y ya
están corregidas en `main`:

| Limitación | Cómo se resolvió |
|---|---|
| CI Seguridad fallaba en `main` por el CRITICAL de `tar` (CVE-2026-59873) en la imagen del backend | La imagen final del backend usa `node:22-alpine` sin npm ni npx (PR #17). En el commit `545168e` de `main`, los 7 workflows están en verde |
| Endpoints de prueba de la EP1 sin autenticación (`GET /api/food/test-alergia` creaba usuarios) | Se quitaron, y el backend exige JWT en todas las rutas salvo las públicas (PR #17) |
| El frontend no leía `API_URL` y en Render llamaba a `http://localhost:3000` | La compilación toma la URL del backend de `API_URL` (PR #17) |
| El backend no leía `CORS_ORIGINS` y aceptaba cualquier origen | CORS queda restringido a los orígenes de `CORS_ORIGINS`, y el backend escucha en `PORT` (PR #17) |
