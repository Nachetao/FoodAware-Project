# ADR 0004: PostgreSQL y TypeORM para los datos del backend

- **Estado:** aceptada. Se tomó en la EP1 (la migración inicial es del 11 de
  septiembre de 2026), se amplió en la EP2 con la tabla `products` y sus
  índices, y en la Entrega Final con los roles, las dietas y el modo estricto.
  Este registro se escribió el 20 de noviembre de 2026.
- **Relacionadas:** [0001](0001-estilo-servicios-separados.md) (el backend es
  dueño de PostgreSQL; el python-service, de su caché SQLite).

## Contexto

El backend guarda tres tipos de datos
([modelo de base de datos](../Arquitectura.md#modelo-de-base-de-datos)):

- **Usuarios:** correo único, contraseña con bcrypt, rol (`usuario` o
  `administrador`), alergias y dietas como códigos del contrato
  (`AllergenCode` y `DietLabel`) y modo estricto. Son datos de salud: tienen
  que quedar bien formados en la propia base, no solo en el código.
- **Respaldo de productos:** cada producto que llega de FastAPI se guarda con
  su procedencia y su calidad, para responder si FastAPI se cae. Se guarda en
  lote con un `INSERT … ON CONFLICT (codigo_barras) DO UPDATE` que solo
  actualiza si el dato que llega no es más antiguo (`recuperado_en`), y la
  búsqueda de respaldo se puntúa en SQL, con expresiones regulares por inicio
  de palabra (`\m`), `translate` y `unnest`
  ([`products.repository.ts`](../../backend/src/products/products.repository.ts)).
- **Alimentos analizados en la EP1** (`foods`).

En la EP2, `/compatibles` filtraba en SQL los productos sin las alergias del
usuario (`NOT (p.alergenos && $2::text[])`), y para eso creamos índices GIN
sobre `alergenos`, `trazas` y `etiquetas_dieta`
([`IndicesProductos`](../../backend/src/migrations/1792811384613-IndicesProductos.ts)).
Desde el 19 de noviembre de 2026 la compatibilidad también considera trazas,
dietas y modo estricto: `/compatibles` y la búsqueda personalizada usan el
motor de FastAPI, y si no responde, el backend trae de la base las
coincidencias por texto y aplica la regla local en TypeScript
([`respaldo-local.ts`](../../backend/src/products/respaldo-local.ts)). Esas
consultas con `&&` ya no existen.

El esquema cambió en cada entrega, así que necesitábamos migraciones
versionadas que se apliquen solas en local (Docker Compose, `postgres:15`) y
en staging (Render, PostgreSQL 15).

## Decisión

Usamos **PostgreSQL 15** con **TypeORM 0.3** (`@nestjs/typeorm`):

- Entidades con decoradores ([`user.entity.ts`](../../backend/src/users/user.entity.ts),
  [`product.entity.ts`](../../backend/src/products/entities/product.entity.ts),
  [`food.entity.ts`](../../backend/src/foods/entities/food.entity.ts)) y
  restricciones en la base: `UNIQUE` en el correo, `CHECK` en el código de
  barras y el Nutri-Score, y el tipo enum `rol_usuario`.
- **Migraciones versionadas**, con `synchronize: false` y `migrationsRun: true`:
  se aplican al arrancar el backend. La CLI y el script `admin:asignar` usan
  el mismo esquema desde [`data-source.ts`](../../backend/src/data-source.ts).
- Listas como `text[]` nativo de PostgreSQL.
- SQL escrito a mano solo donde TypeORM no alcanza: los índices GIN y
  parciales, y la búsqueda de respaldo puntuada.

## Alternativas consideradas

| Alternativa | Por qué la descartamos |
|---|---|
| **MongoDB** | Los datos son estructurados y con reglas (correo único, rol cerrado, código de barras de 8 a 14 dígitos), que en PostgreSQL quedan en la propia base. Render no ofrece MongoDB gestionado, así que staging dependería de otro proveedor |
| **MySQL** | No tiene arreglos nativos ni índices GIN: las alergias, las dietas y las listas del producto irían en tablas intermedias o en JSON. Render solo ofrece PostgreSQL gestionado |
| **SQLite** | En Render el disco es efímero: los usuarios se perderían en cada despliegue. El python-service sí lo usa, pero para una caché que se reconstruye desde la semilla ([ADR 0001](0001-estilo-servicios-separados.md)) |
| **Prisma** | Exige mantener un esquema aparte y un paso de generación de código. El backend ya funcionaba con TypeORM desde la EP1, y la búsqueda puntuada igual iría en SQL |
| **Sequelize** | Tiene módulo para NestJS, pero sus tipos en TypeScript son menos directos (los modelos se tipan aparte o con `sequelize-typescript`). No aportaba nada frente a TypeORM |
| **SQL directo** (`pg`) | Habría que escribir a mano el mapeo, los repositorios y el control de migraciones. Lo usamos solo donde hace falta, con `repository.query` |

## Consecuencias

**Positivas:**

- Las reglas de los datos quedan en la base, y no dependen solo de que el
  código valide bien.
- Cada cambio de esquema es una migración con `up` y `down`, que corre sola
  también en Render.
- `text[]` guarda las listas de códigos sin separar texto, y el upsert con
  condición evita que un dato viejo pise uno más nuevo.

**Negativas:**

- **`simple-array` frente a `text[]`:** en la EP1 las listas se guardaron con
  `simple-array` de TypeORM, que es texto separado por comas: no admite una
  coma dentro de un valor ni se puede consultar como lista. `products` nació
  con `text[]`, y `users.alergias` pasó a `text[]` con la migración
  [`AlergiasUsuarioConCodigos`](../../backend/src/migrations/1792810920922-AlergiasUsuarioConCodigos.ts),
  que convirtió los valores libres a códigos con un diccionario de sinónimos y
  descartó los que no reconoció. Su `down` no recupera los valores originales.
  `foods` (de la EP1) sigue con `simple-array`.
- TypeORM no genera índices GIN ni parciales: se crean a mano en la migración
  y se marcan con `synchronize: false` en la entidad.
- **Los índices GIN hoy no se usan.** Se decidieron en la EP2 para el filtro
  con `&&`, que desapareció con el cambio a la regla local. Siguen en la base
  y cuestan algo en cada escritura; si ninguna consulta vuelve a filtrar por
  lista, habría que quitarlos con una migración. El índice parcial
  (`WHERE es_valido`) coincide con el filtro de la búsqueda de respaldo, pero
  no lo volvimos a comprobar con `EXPLAIN` después del cambio.
- **La base gratuita de Render vence cada 30 días.** Hay que recrearla, y se
  pierden los usuarios y el respaldo de productos; las migraciones vuelven a
  crear las tablas al arrancar
  ([despliegue-staging.md](../despliegue-staging.md#recrear-la-base-cada-30-días)).
  Además, el plan gratuito no tiene respaldos ([modelo-amenazas.md](../modelo-amenazas.md),
  P11).
