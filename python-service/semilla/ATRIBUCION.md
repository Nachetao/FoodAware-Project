# Atribución de la semilla del corpus

`corpus-off.json.gz` contiene información de **Open Food Facts**
(<https://world.openfoodfacts.org>), disponible bajo la
[Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Los contenidos individuales de la base están bajo la
[Database Contents License (DbCL) v1.0](https://opendatacommons.org/licenses/dbcl/1-0/).

La semilla es un extracto de la caché de FoodAware: los productos válidos con
el payload original de la API de Open Food Facts, la fecha en que se
descargaron (`procedencia.recuperado_en`) y la URL de cada producto
(`procedencia.url_fuente`). Como base de datos derivada, se comparte bajo la
misma licencia ODbL v1.0. No incluye imágenes: solo las URL que entrega la
API, y las imágenes de Open Food Facts tienen su propia licencia
(CC BY-SA 3.0).

El mismo aviso va dentro del archivo, en los campos `fuente`, `licencia` y
`contenidos`.

Para regenerarla con la caché actual, ver `scripts/exportar_semilla.py`.
