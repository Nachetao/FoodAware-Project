# Registros de decisiones de arquitectura (ADR)

Cada ADR explica una decisión importante de FoodAware en el mismo formato:
contexto, decisión, alternativas consideradas y consecuencias. Los escribimos
para la Entrega Final, como respuesta a la retroalimentación de la EP1, pero
las decisiones vienen de antes; cada uno dice cuándo se tomó.

Las decisiones más chicas (la caché SQLite propia, BM25 en memoria, la
semilla del corpus, el Blueprint de Render) siguen en
[Arquitectura.md](../Arquitectura.md#decisiones-de-arquitectura).

| ADR | Decisión | Estado |
|---|---|---|
| [0001](0001-estilo-servicios-separados.md) | Servicios separados por responsabilidad: un backend principal y un servicio especializado, no microservicios completos | Aceptada |
| [0002](0002-python-fastapi.md) | Python y FastAPI para el servicio especializado, como servicio independiente | Aceptada |
| [0003](0003-rest-entre-servicios.md) | REST con un contrato OpenAPI entre NestJS y FastAPI | Aceptada |
| [0004](0004-postgresql-typeorm.md) | PostgreSQL y TypeORM para los datos del backend | Aceptada |
