# ADR 0003: REST entre NestJS y FastAPI

- **Estado:** aceptada. Se tomó en la EP1, y en la EP2 se formalizó con el
  contrato OpenAPI.
- **Relacionadas:** [0001](0001-estilo-servicios-separados.md) y
  [0002](0002-python-fastapi.md).

## Contexto

El backend llama al python-service para buscar, ver el detalle de un
producto, pedir el veredicto de compatibilidad y leer las métricas. Todas son
consultas que **el usuario está esperando**: la respuesta tiene que llegar en
la misma petición.

El volumen es bajo: en staging hay decenas de búsquedas, no miles por
segundo. Los dos servicios están en lenguajes distintos, y cada integrante
mantiene uno. Necesitábamos un contrato que los dos pudieran leer y probar
por separado, y que se pudiera revisar a mano con Swagger o `curl`.

## Decisión

El backend llama al python-service con **REST sobre HTTP y JSON**, de forma
**síncrona**, con un contrato documentado en
[contratos/README.md](../contratos/README.md) y en OpenAPI:

- Errores con un formato común (`codigo`, `mensaje` y `request_id`).
- `X-Request-ID` para seguir una petición en los logs de los dos servicios.
- `X-Clave-Servicio` obligatoria en los endpoints internos.
- En el backend: timeout por intento, reintentos con espera creciente y
  respaldo desde PostgreSQL si FastAPI no responde.

## Alternativas consideradas

| Alternativa | Por qué la descartamos |
|---|---|
| **gRPC** | Da mejor rendimiento y tipos generados desde un `.proto`, pero con nuestro volumen la diferencia de rendimiento no se notaría. A cambio habría que generar código para TypeScript y para Python, y perderíamos Swagger y `curl` para probar y depurar. FastAPI ya nos da tipos y el contrato desde Pydantic |
| **Colas de mensajes** (RabbitMQ, Redis u otro broker) | Sirven para trabajo asíncrono, pero nuestras consultas necesitan respuesta inmediata: con una cola habría que esperar la respuesta por otro canal. Sería un servicio más que levantar y vigilar. El único trabajo en segundo plano, la ingesta, ya corre dentro del python-service |
| **GraphQL** | Sirve cuando muchos clientes piden formas distintas de los datos. Aquí hay un solo cliente (el backend) con consultas fijas |

## Consecuencias

**Positivas:**

- Cualquiera puede probar el contrato con Swagger (`/docs`) o con `curl`, en
  local y en staging.
- El backend se prueba contra un FastAPI simulado
  ([`fastapi-falso.ts`](../../backend/test/integracion/fastapi-falso.ts)), y
  CI Integración prueba los dos servicios reales juntos.
- Los fallos de red tienen respuestas conocidas: timeout, reintento y
  respaldo, con `X-Fuente-Datos: respaldo`.

**Negativas:**

- Si FastAPI está lento, el usuario espera: el peor caso es de unos 7
  segundos antes de responder desde el respaldo.
- JSON es más pesado que un formato binario (no importa con nuestro volumen).
- Si mañana hubiera procesos largos que el usuario no necesita esperar (por
  ejemplo, reprocesar todo el corpus con un modelo), habría que sumar una
  cola para ese caso, sin cambiar las consultas síncronas.
