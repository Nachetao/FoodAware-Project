## Diagrama de contexto

```mermaid
flowchart LR
    Usuario([Usuario]) -->|Ingresa producto| FoodAware[FoodAware]
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
        text_array alergias
    }
    FOODS {
        uuid id PK
        text nombre
        text_array ingredientes
        text_array alergenosPresentes
        boolean esNutricionalmenteSaludable
    }
```

> **Nota:** actualmente no tenemos una relación formal entre `users` y `foods` en el esquema ya que no hay columna `userId` en `foods`. La comparación de alergias se hace en tiempo de ejecución pero no queda registrado de qué usuario analizó el producto. Planeamos agregar esta relación en una de las siguientes entregas parciales.