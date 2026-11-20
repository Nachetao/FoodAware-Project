# ADR 0002: Python y FastAPI como servicio independiente

- **Estado:** aceptada. Se tomó en la EP1 y se mantuvo en la EP2, cuando el
  servicio sumó la ingesta, la preparación de datos y la búsqueda.
- **Relacionadas:** [0001](0001-estilo-servicios-separados.md) (por qué un
  servicio aparte) y [0003](0003-rest-entre-servicios.md) (cómo lo llama el
  backend).

## Contexto

El servicio especializado de [ADR 0001](0001-estilo-servicios-separados.md)
hace el trabajo de datos: ingesta desde Open Food Facts, limpieza de
ingredientes, detección de alérgenos con un diccionario de sinónimos, índice
BM25, métricas y evaluación, y el veredicto de compatibilidad. En la EP1 lo
separamos pensando en reemplazar más adelante las reglas por algo más
sofisticado, como un clasificador entrenado
([capacidad-adaptativa.md](../capacidad-adaptativa.md)).

Además necesitábamos:

- Validar estrictamente lo que entra y sale, porque los datos de Open Food
  Facts no son confiables y el backend depende del formato.
- Publicar un contrato que el backend pueda seguir y que CI pueda verificar.
- Llamar a Open Food Facts con límites de tasa, timeouts y reintentos.

## Decisión

El servicio está escrito en **Python 3.11 con FastAPI**, Pydantic para los
esquemas y httpx para las llamadas a Open Food Facts, y corre como un
servicio independiente, con su propio contenedor, su propio CI y su propio
servicio en Render.

FastAPI genera el OpenAPI a partir de los esquemas de Pydantic. Lo exportamos
a [`fastapi-openapi.json`](../contratos/fastapi-openapi.json), y CI falla si
ese archivo no coincide con el código, así que el contrato que lee el backend
no puede quedar atrasado.

## Alternativas consideradas

| Alternativa | Por qué la descartamos |
|---|---|
| **Hacerlo en NestJS**, dentro del backend | Es el monolito de [ADR 0001](0001-estilo-servicios-separados.md). TypeScript sirve para la lógica, pero el ecosistema de procesamiento de texto, recuperación de información y aprendizaje automático está en Python, y ahí iría el futuro clasificador |
| **Flask** | No valida los datos ni genera OpenAPI por sí solo: habría que agregar varias librerías para llegar a lo que FastAPI trae con Pydantic |
| **Django o Django REST Framework** | Trae ORM, panel de administración y sesiones que no necesitamos: la persistencia del servicio es una caché SQLite simple, y los usuarios viven en el backend |
| **Scripts de Python llamados desde NestJS** (procesos hijos) | Habría acoplado los dos lenguajes en un mismo contenedor, sin un contrato claro, y no permitiría mantener el índice BM25 en memoria entre peticiones |

## Consecuencias

**Positivas:**

- El contrato sale del código (Pydantic → OpenAPI) y CI lo verifica.
- Los datos inválidos de la fuente se rechazan en la frontera, con errores
  en el formato del contrato.
- Si algún día pasamos a un clasificador entrenado, se cambia dentro del
  servicio sin tocar el backend.

**Negativas:**

- Dos lenguajes, dos gestores de dependencias (`npm` y `pip`) y dos
  auditorías (`npm audit` y `pip-audit`).
- **Siendo honestos:** hoy no usamos el ecosistema de Python que justificó la
  decisión. El servicio solo depende de FastAPI, Pydantic, httpx y la
  biblioteca estándar; BM25 y la detección de alérgenos están escritos a
  mano. La ventaja sigue siendo una opción a futuro, no algo que ya
  aprovechemos.
- En el plan gratuito de Render, el servicio tiene 0,1 CPU y un disco
  efímero: arranca desde la semilla del corpus en cada reinicio.
