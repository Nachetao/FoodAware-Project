# ADR 0001: Servicios separados por responsabilidad, no microservicios

- **Estado:** aceptada. Se tomó en la EP1, se mantuvo en la EP2 y se revisó
  para la Entrega Final (19 de noviembre de 2026).
- **Relacionadas:** [0002](0002-python-fastapi.md) (por qué Python) y
  [0003](0003-rest-entre-servicios.md) (cómo se comunican).

## Contexto

FoodAware tiene dos tipos de trabajo muy distintos:

- **La aplicación:** usuarios, autenticación, perfiles de alergias, roles y
  la API que consume el frontend. Es trabajo transaccional y de reglas de
  acceso.
- **El procesamiento de datos:** traer productos de Open Food Facts con
  límites de tasa, limpiar ingredientes, detectar alérgenos y trazas, armar
  el índice BM25, decidir el veredicto y medir la calidad. Es trabajo de
  texto y de recuperación de información, y es lo que más va a cambiar si
  algún día pasamos de reglas a un modelo entrenado.

Somos dos personas, y cada una se hizo cargo de una de las dos partes.
Staging corre en el plan gratuito de Render, donde cada servicio se duerme
sin tráfico y tarda cerca de un minuto en despertar.

En la EP1 describimos el servicio de Python como un "microservicio". La
profesora nos preguntó si la arquitectura era un monolito o microservicios, y
cómo llegamos a esa decisión. Este ADR responde esa pregunta con el nombre
correcto.

## Decisión

Usamos **servicios separados por responsabilidad**: un **backend principal**
(NestJS) y un **servicio especializado** (el python-service, con FastAPI),
detrás de un solo frontend.

- El frontend habla solo con el backend.
- El backend es dueño de PostgreSQL y es el único que llama al python-service.
- El python-service es dueño de su caché SQLite y es el único que habla con
  Open Food Facts.
- Se comunican solo por HTTP, con un contrato versionado
  ([contratos/README.md](../contratos/README.md)).

**No son microservicios completos.** Son dos servicios con dueños claros,
pero no tienen lo que define a una arquitectura de microservicios: no hay
descubrimiento de servicios, ni broker de mensajes, ni un servicio por cada
capacidad del negocio (usuarios, búsqueda, ingesta y veredicto viven juntos
en uno u otro). Tampoco se escalan por separado, y el CD los despliega juntos,
en orden. Por el tamaño, se parece más a un monolito con un servicio
especializado al lado.

## Alternativas consideradas

| Alternativa | Por qué la descartamos |
|---|---|
| **Monolito NestJS** (todo en TypeScript) | Habría que escribir el procesamiento de texto, la búsqueda y el futuro clasificador en un ecosistema más débil para eso. Además, la ingesta (lenta y limitada por la fuente) compartiría proceso con el login y los perfiles, y una ingesta pesada podría frenar la API de usuarios |
| **Monolito Python** (todo en FastAPI) | Era posible, pero el backend de la EP1 ya estaba en NestJS, con usuarios, JWT y TypeORM funcionando. Reescribirlo no aportaba nada al problema, y nos quitaba la división de trabajo por persona |
| **Microservicios completos** (usuarios, búsqueda, ingesta y veredicto por separado, con un gateway y quizás un broker) | Demasiado para dos personas y un corpus de 385 productos. Cada servicio extra sería otro pipeline, otro despliegue y, en el plan gratuito, otro servicio que se duerme y suma un minuto de espera. Los beneficios (escalar y desplegar cada parte por su cuenta, equipos independientes) no aplican a nuestro caso |

## Consecuencias

**Positivas:**

- Cada servicio es dueño de sus datos: no hay una base compartida entre
  ellos, y el contrato es la única dependencia.
- El backend sigue respondiendo si el python-service se cae: usa su respaldo
  en PostgreSQL ([backend.md](../backend.md#robustez-frente-a-fastapi)), y CI
  Integración lo prueba en cada push.
- Cada parte tiene su propio pipeline de CI, con las herramientas de su
  lenguaje.

**Negativas:**

- Una llamada HTTP extra en cada búsqueda, con timeouts, reintentos y
  respaldo que mantener.
- Dos copias parciales de los productos (la caché del python-service y la
  tabla `products` del backend), que no se sincronizan directamente.
- En el plan gratuito, el python-service necesita URL pública y una clave
  entre servicios ([modelo-amenazas.md](../modelo-amenazas.md)).
- Dos lenguajes y dos stacks que mantener al día.
