# Fuente web: Open Food Facts

FoodAware necesita saber qué ingredientes tiene un producto real para poder
avisar si contiene algo que la persona no puede comer. Esa información no la
inventamos ni la escribimos a mano: la sacamos de Open Food Facts.

## Qué es Open Food Facts

[Open Food Facts](https://world.openfoodfacts.org) es una base de datos
abierta y colaborativa de productos alimenticios. La mantiene una
organización sin fines de lucro y la completan voluntarios, que suben fotos
de las etiquetas y transcriben el nombre, la marca, los ingredientes, los
alérgenos y la información nutricional. Cualquiera puede consultarla por su
API pública sin crear una cuenta ni pedir una clave.

Cada producto se identifica por su código de barras (EAN-13, EAN-8 o UPC-A),
y la base clasifica los productos con taxonomías propias: categorías
(`en:biscuits`, `en:dairies`...), países (`en:chile`), alérgenos
(`en:milk`, `en:gluten`...) y etiquetas (`en:vegan`, `en:no-gluten`...).

## Por qué la elegimos

Buscábamos una fuente que cumpliera cuatro cosas, y Open Food Facts las
cumplía todas:

1. Tiene productos vendidos en Chile. La API permite filtrar por país, y
   hoy nuestro corpus son 385 productos chilenos válidos (galletas, lácteos,
   panes, chocolates, cereales, snacks salados y bebidas vegetales).
2. Trae el texto de ingredientes y los alérgenos declarados, que es justo
   lo que necesita el análisis de restricciones alimentarias.
3. Es abierta y gratuita. La licencia permite usar y redistribuir los
   datos, citando la fuente (ver más abajo). Eso nos dejó guardar una
   semilla del corpus en el repositorio.
4. Tiene una API documentada para leer un producto y para buscar por país
   y categoría, con límites de uso publicados.

La desventaja es la otra cara de que sea colaborativa: los datos son
incompletos y a veces están mal. En nuestras ingestas reales, alrededor de
1 de cada 4 productos que llega no trae ingredientes o no trae nombre
(el detalle está en [recuperacion-y-evaluacion.md](recuperacion-y-evaluacion.md)).
Por eso todo lo que viene de Open Food Facts pasa por la limpieza y la
validación que describimos en
[extraccion-y-preparacion.md](extraccion-y-preparacion.md).

## Qué datos entrega y cuáles usamos

Open Food Facts devuelve cientos de campos por producto. Nosotros pedimos
solo los que usamos, con el parámetro `fields` de la API (la lista está en
`CAMPOS`, en
[`open_food_facts.py`](../python-service/app/clients/open_food_facts.py)):

| Campo de Open Food Facts | Para qué lo usamos |
|---|---|
| `code` | Código de barras: es la clave del producto en la caché |
| `product_name_es`, `product_name` | Nombre (preferimos el de español) |
| `brands` | Marca |
| `quantity` | Contenido neto ("1 L", "120 g") |
| `ingredients_text_es`, `ingredients_text` | Texto de ingredientes, la base de la detección de alérgenos |
| `allergens_tags`, `traces_tags` | Alérgenos y trazas que declaró Open Food Facts; los unimos con lo que detectamos en el texto |
| `labels_tags` | Etiquetas de dieta: vegano, vegetariano, sin gluten, sin lactosa |
| `categories`, `categories_tags` | Categorías; el buscador las indexa y la evaluación las usa para decidir qué es relevante |
| `nutriscore_grade` | Nutri-Score (a a e) |
| `image_front_url`, `image_url` | Solo la URL de la imagen; no descargamos imágenes |
| `last_modified_t` | Última modificación en la fuente, para la trazabilidad |
| `lang` | Se pide, pero hoy no se usa |

Todo lo demás lo dejamos fuera a propósito: la tabla nutricional completa,
los datos de quién creó o editó cada producto y las fotos. Que no pidamos
esos campos también es una decisión de privacidad, como explicamos más
abajo.

## Cómo obtenemos los datos

Usamos dos endpoints de la API, cada uno para una cosa distinta:

| Uso | Endpoint | Cuándo se llama |
|---|---|---|
| Leer un producto por código | `GET /api/v3/product/{código}?fields=...` | Cuando alguien pide `GET /products/{codigo_barras}` y el producto no está en la caché, o está vencido |
| Traer productos por país y categoría | `GET /api/v2/search?countries_tags=en:chile&categories_tags=...&fields=...&page=N&page_size=50&sort_by=last_modified_t` | Durante una ingesta, una búsqueda por categoría y página |

Elegimos la v3 para los productos porque es la versión actual de lectura y
responde con un `status` claro cuando el producto no existe. Para las
ingestas usamos `/api/v2/search` porque permite filtrar por país y por
categoría a la vez y paginar, que es lo que necesitábamos para armar un
corpus chileno parejo entre categorías.

Algo importante: la búsqueda de FoodAware (`GET /search`) nunca llama a Open
Food Facts en vivo. Busca en un índice que armamos con lo que ya está en la
caché local. Si cada búsqueda de un usuario pasara a Open Food Facts,
gastaríamos el límite de consultas en minutos y la app dependería de que la
fuente estuviera arriba en ese momento.

El recorrido completo, con los limitadores, los reintentos y la segunda
ronda por categoría, está en
[extraccion-y-preparacion.md](extraccion-y-preparacion.md). Los parámetros de
cada endpoint de FoodAware están en el [contrato](contratos/README.md).

## Estrategia y frecuencia de actualización

Los datos de Open Food Facts cambian (alguien corrige un ingrediente, aparece
un producto nuevo), así que la caché se tiene que refrescar. Lo resolvimos
en cuatro niveles:

- Al arrancar con la caché vacía se carga la semilla del corpus
  (`python-service/semilla/corpus-off.json.gz`), sin llamar a la fuente. Si
  no hay semilla, se lanza una ingesta inicial.
- Cada 24 horas corre una ingesta periódica de las 7 categorías, con un
  tope de 500 productos. La próxima se cuenta desde el inicio de la última,
  así un reinicio del servicio no la atrasa.
- Por producto: si alguien pide uno que se verificó hace más de 72 horas,
  se vuelve a leer de Open Food Facts. Si la fuente no responde, se entrega
  el de la caché.
- A mano, con `POST /ingest/runs`, que está protegido con una clave interna
  porque gasta el límite de consultas.

Los valores (24 h, 72 h, 500 productos, las categorías) son variables de
entorno; la tabla está en
[contratos/README.md](contratos/README.md#estrategia-de-actualización).

En staging esto funciona distinto: Render apaga el servicio gratuito tras
15 minutos sin tráfico y el disco se borra, así que la ingesta periódica no
alcanza a correr y los datos son los de la semilla. Lo explicamos en
[despliegue-staging.md](despliegue-staging.md#limitaciones-del-plan-gratuito).

## Revisión legal, ética y de privacidad

### Licencia y atribución

Los datos de Open Food Facts están bajo la
[Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/),
y cada dato individual bajo la
[Database Contents License (DbCL) v1.0](https://opendatacommons.org/licenses/dbcl/1-0/).
Las imágenes tienen otra licencia (CC BY-SA 3.0), y por eso no las
descargamos: solo guardamos su URL.

La ODbL permite usar, modificar y redistribuir la base si se cumplen dos
condiciones: atribuir la fuente y compartir las bases derivadas con la misma
licencia. Lo cumplimos así:

- Cada producto lleva su procedencia: `fuente: "openfoodfacts"` y
  `url_fuente`, que apunta a la página del producto en Open Food Facts.
- La semilla del corpus es una base derivada, así que va con la misma
  licencia. El aviso está en
  [`semilla/ATRIBUCION.md`](../python-service/semilla/ATRIBUCION.md) y
  también dentro del archivo, en los campos `fuente`, `licencia` y
  `contenidos`.

- El detalle de cada producto en el frontend muestra "Datos de Open Food
  Facts (openfoodfacts.org), disponibles bajo la licencia Open Database
  License (ODbL)", con la fecha de recuperación y un enlace a la ficha
  original ([frontend.md](frontend.md#atribución-y-procedencia)).

Falta una cosa: que la atribución aparezca también en la lista de resultados
de la búsqueda. Lo dejamos anotado en [limitaciones.md](limitaciones.md).

### User-Agent identificado

Open Food Facts pide que cada aplicación se identifique con un User-Agent
del tipo `AppName/Version (correo de contacto)`, para poder avisar o
bloquear a quien abuse de la API. Nuestro cliente lo exige: si
`OFF_USER_AGENT` falta o no tiene ese formato, no se crea el cliente y los
endpoints que necesitan la fuente responden 503 en vez de hacer llamadas
anónimas.

El correo del equipo no está en el repositorio. Se configura en el `.env`
local (que está en `.gitignore`) y en Render se escribe a mano al crear el
servicio (`sync: false`). Además, el formateador de logs reemplaza cualquier
correo por `[correo oculto]`, así el User-Agent no se filtra si aparece en
una traza.

### API oficial y no scraping

FoodAware no hace scraping. No descargamos páginas HTML de Open Food Facts,
no seguimos enlaces ni recorremos el sitio: solo llamamos a los dos endpoints
de la API que aparecen arriba, pidiendo productos concretos o páginas de una
búsqueda, con los campos justos. Es la forma de acceso que Open Food Facts
documenta para las aplicaciones, con las condiciones que pide: User-Agent
identificado y límites de tasa.

### robots.txt

`robots.txt` es el archivo con que un sitio les dice a los robots que lo
recorren solos (buscadores, crawlers de SEO o de IA) qué rutas no deben
visitar. Como nosotros no recorremos el sitio, no es la regla que nos aplica
de forma directa: lo que rige nuestro uso es la documentación de la API. Igual
lo revisamos, para saber qué piden y no contradecirlo.

Consultamos <https://world.openfoodfacts.org/robots.txt> el 25 de octubre de
2026 (2.126 bytes). Dice tres cosas:

- Para cualquier robot (`User-agent: *`) prohíbe `/api`, `/cgi` y `/facets`.
- A Googlebot y Bingbot les prohíbe lo mismo (a Googlebot no le cierra
  `/facets`), pero les permite `/cgi/product_image.pl` y `/cgi/opensearch.pl`.
- A 41 nombres de robots (contando variantes del mismo, como `Scrapy` y
  `Scrapy/1.5.0`) les prohíbe el sitio completo (`Disallow: /`): crawlers
  de SEO (SemrushBot, AhrefsBot, MJ12bot...), scrapers genéricos como Scrapy
  y robots de empresas de IA (GPTBot, ClaudeBot, PerplexityBot, entre otros).

Lo que sacamos de eso:

- El `Disallow: /api` es para que los robots no rastreen ni indexen las
  respuestas de la API mientras recorren el sitio, y no para las aplicaciones
  que la usan como dice su documentación. Nuestro cliente no llega a la API
  siguiendo enlaces: arma cada llamada a partir de un código de barras o de
  una categoría.
- No usamos ninguna de las otras rutas prohibidas (`/cgi`, `/facets`) ni
  páginas HTML del sitio.
- Nuestro User-Agent (`FoodAware/1.0` con el correo del equipo) no coincide
  con ninguno de los robots bloqueados.
- Que bloqueen a crawlers masivos y a robots de IA confirma que les importa
  la carga sobre sus servidores. Por eso respetamos los límites con margen y
  la búsqueda de FoodAware nunca consulta la fuente en vivo.

Si algún día necesitáramos datos que la API no entrega y hubiera que leer
páginas del sitio, ahí sí tendríamos que seguir el `robots.txt` al pie de la
letra. Hoy no es el caso.

### Límites de tasa

La documentación oficial pone como límite 15 lecturas de producto y 10
búsquedas por minuto por IP. Nos quedamos por debajo a propósito, con 12
lecturas y 8 búsquedas por minuto, para no arriesgar un bloqueo de la IP.
Además:

- Solo reintentamos ante errores que pueden ser pasajeros (red, timeout, 429
  y 5xx), con espera creciente, y si la fuente manda `Retry-After` lo
  respetamos.
- `/health` y `/search` no consultan la fuente.
- Una petición de un usuario nunca espera más de 3 segundos al limitador: si
  tendría que esperar más, responde 503 de inmediato en vez de dejar la
  conexión colgada.

### Datos personales

El python-service no guarda datos personales:

- De Open Food Facts solo pedimos campos del producto. Los datos de los
  contribuyentes (quién creó o editó cada ficha) no se descargan.
- El servicio no recibe datos de usuarios de FoodAware. Las alergias y los
  perfiles viven en PostgreSQL, del lado del backend
  ([backend.md](backend.md)).
- Los logs de acceso registran método, ruta, código de respuesta, duración y
  `request_id`, pero no la IP: desactivamos el log de acceso propio de
  uvicorn, que sí la incluye.

### Los alérgenos son orientativos

Esto es lo más delicado del proyecto. La información de alérgenos de
FoodAware es una ayuda y no reemplaza leer la etiqueta del envase, por tres
razones:

1. Open Food Facts la llenan voluntarios. Puede tener errores de
   transcripción o corresponder a una versión antigua de la receta.
2. Nuestra detección en el texto es por reglas (sinónimos, excepciones y
   negaciones). Tiene casos conocidos que falla, documentados en
   [extraccion-y-preparacion.md](extraccion-y-preparacion.md) y en
   [limitaciones.md](limitaciones.md).
3. Un producto que no trae ingredientes no se puede revisar. Por eso esos
   productos se marcan como inválidos y no aparecen en la búsqueda.

Cuando dudamos, preferimos marcar el alérgeno. Un falso positivo solo
esconde un producto que la persona sí podía comer; un falso negativo la
puede exponer a algo que le hace daño. Aun así, la app tiene que decirlo
claramente en la interfaz, y ese aviso todavía falta en el frontend (ver
[limitaciones.md](limitaciones.md)).
