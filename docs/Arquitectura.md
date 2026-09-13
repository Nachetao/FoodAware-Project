## Diagrama de contexto

```mermaid
flowchart LR
    Usuario([Usuario]) -->|Ingresa producto| FoodAware[FoodAware]
    FoodAware -->|Resultado del análisis| Usuario
    FoodAware -.->|Consultará en EP2| FuenteWeb[(Fuente web\nplanificada)]
```

## Diagrama de contenedores

```mermaid
flowchart TB
    Frontend["Frontend\nAngular + Ionic + Capacitor"]
    Backend["Backend\nNestJS + TypeORM"]
    DB[("Base de datos\nPostgreSQL")]
    Python["Servicio de análisis\nPython + FastAPI"]

    Frontend -->|REST| Backend
    Backend -->|SQL| DB
    Backend -->|REST| Python
```

## Diagrama de despliegue preliminar

```mermaid
flowchart LR
    subgraph Host["Host de staging (Docker Compose)"]
        Frontend["frontend\npuerto 4200"]
        Backend["backend\npuerto 3000"]
        Python["python-service\npuerto 8000"]
        DB[("db\npuerto 5432")]
    end

    Usuario([Usuario]) -->|"navegador → 4200"| Frontend
```

## Modelo de base de datos

```mermaid
erDiagram
    USERS {
        uuid id PK
        text nombre
        text correo
        text password
        text alergias "lista separada por comas"
    }
    FOODS {
        uuid id PK
        text nombre
        text ingredientes "lista separada por comas"
        text alergenosPresentes "lista separada por comas"
        boolean esNutricionalmenteSaludable
    }
```
## Decisiones de arquitectura

**Servicio Python separado:** el análisis de alérgenos va en un microservicio aparte con FastAPI, pensando en que a futuro podamos usar algo más sofisticado que reglas simples. El costo es una llamada HTTP extra entre NestJS y Python.

**Reglas en vez de un modelo de IA:** la detección de alérgenos compara ingredientes contra una lista conocida, no usa un modelo entrenado. Es más simple y explicable para esta etapa; el límite es que solo detecta lo que está en la lista.

**Listas guardadas como texto separado por comas:** ingredientes y alérgenos se guardan con `simple-array` de TypeORM en vez de tablas relacionadas aparte. Es más simple de implementar, pero hace las búsquedas por ingrediente menos eficientes a futuro.

**IDs tipo UUID:** se usan en vez de números correlativos(como 1,2,3, etc) para que no se puedan adivinar ni usar para acceder a otro registro cambiando un número en la URL y asi sea mucho mas seguro.

**Comunicación entre contenedores por nombre de servicio:** NestJS habla con la base de datos y con Python usando los nombres de servicio de Docker Compose (`db`, `python-service`), no `localhost`, aprendimos esto arreglando un bug real donde `localhost` apuntaba al contenedor equivocado.

**Pipeline que bloquea errores:** el lint, los tests y la auditoría de dependencias detienen el pipeline si fallan.