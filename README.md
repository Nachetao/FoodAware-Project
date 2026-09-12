# FoodAware

## 1. Descripción y Definición del Proyecto
FoodAware es una aplicación web multiplataforma diseñada para ayudar a los usuarios a elegir alimentos compatibles con sus necesidades, clasificando productos según sus restricciones o preferencias personales mediante Inteligencia Artificial, entregando alertas tempranas sobre alérgenos y compatibilidad dietética.

**Integrantes:**
* Ignacio Reyes
* Joaquín Muñoz

### Problema Delimitado
Las personas con restricciones alimentarias (alergias,intolerancias,etc) o dietas específicas tienen problemas para poder identificar si un producto procesado es apto para su consumo o no. Las etiquetas de ingredientes suelen ser complejas, ya que usan nombres técnicos u ocultan alérgenos, lo que representa un riesgo para la salud del consumidor y genera una mala experiencia de compra.

### Usuarios Objetivo
* **Personas con alergias o intolerancias alimentarias:** Usuarios que necesitan ver los ingredientes de los productos para evitar problemas de salud.
* **Consumidores con dietas específicas:** Personas que tiene un regimen como veganos, vegetarianos o libres de gluten.
* **Usuarios enfocados en salud:** Personas interesadas en conocer el perfil nutricional real de lo que consumen.

### Objetivos y Alcance
* **Objetivo General:** Desarrollar una herramienta tecnológica que analice listas de ingredientes y determine la viabilidad de consumo basándose en el perfil de salud del usuario.
* **Alcance (EP1):** Implementación de la arquitectura base (Frontend, Backend, Servicio de IA, BD), autenticación de usuarios segura (JWT/Bcrypt) y pipeline DevSecOps estricto.

## 2. Principales Funcionalidades
* Registro y gestión de perfiles nutricionales.
* Búsqueda y clasificación de alimentos aptos.
* Escaneo/Búsqueda de productos.

## 3. Capacidad Adaptativa o Inteligente
* **Descripción:** El sistema clasificará productos en tiempo real determinando si son aptos o no, basándose en las restricciones configuradas en el perfil del usuario.
* **Mecanismo:** Procesamiento mediante reglas/clasificación implementado en un servicio especializado de Python (FastAPI).

## 4. Fuentes de Información Web
Para las siguientes etapas del proyecto (EP2), el sistema se integrará con la API de **Open Food Facts**, una base de datos abierta y colaborativa de productos alimenticios, para extraer los ingredientes reales de los productos comerciales a partir de su nombre o código.

## 5. Arquitectura General y Tecnologías
* **Frontend:** Angular + Ionic Framework + Capacitor
* **Backend Principal:** NestJS (API REST principal)
* **Servicio Especializado:** Python + FastAPI (Procesamiento inteligente)
* **Base de Datos:** PostgreSQL
* **Infraestructura y DevSecOps:** Docker, Docker Compose, Terraform, GitHub Actions.

## 6. Configuración de Entorno (Variables)
Para levantar este proyecto en local, se requiere un archivo `.env` en la raíz del proyecto. Las variables necesarias son:
* `DB_HOST`: Host de la base de datos (usualmente `db` cuando se usa Docker Compose).
* `DB_PORT`: Puerto de PostgreSQL (por defecto `5432`).
* `DB_USER`: Nombre de usuario administrador de la base de datos.
* `DB_PASSWORD`: Contraseña del usuario de la base de datos.
* `DB_NAME`: Nombre de la base de datos (ej. `foodaware_db`).
* `JWT_SECRET`: Llave secreta utilizada para firmar los tokens de autenticación de los usuarios.
* `PYTHON_API_URL`: Ruta interna donde el backend de NestJS se comunica con el servicio de IA (ej. `http://python-service:8000`).

## 7. Instrucciones de Instalación y Ejecución
Siga los pasos a continuación para configurar y ejecutar el proyecto en su entorno local:

1. **Clonar el repositorio:** 
   Descargue el código fuente a su entorno local.
2. **Crear las variables de entorno:** 
   Copie el archivo `.env.example`, renómbrelo a `.env` y configure los valores locales correspondientes.
3. **Levantar los contenedores:** 
   Utilice el comando `docker compose up --build -d` para construir y levantar la base de datos, el frontend, el backend y el servicio de Python en segundo plano.
4. **Ejecutar las migraciones (Importante):** 
   Como el proyecto utiliza un control estricto de base de datos (`synchronize: false`), debe crear las tablas ejecutando las migraciones con el siguiente comando:
   `docker compose exec backend npm run typeorm -- migration:run -d src/data-source.ts`

## 8. Pipeline DevSecOps
El proyecto utiliza GitHub Actions para establecer un flujo robusto de automatización e integración continua (CI). Este pipeline se encarga de ejecutar la instalación de dependencias, realizar revisiones de formato (Linting), ejecutar pruebas unitarias, realizar análisis de dependencias vulnerables críticas (`npm audit` y `pip-audit`), y llevar a cabo un escaneo estricto de seguridad utilizando GitLeaks para prevenir la exposición accidental de credenciales.

## 9. Entorno de Staging y Despliegue (Terraform)
El proyecto incluye configuración de infraestructura como código (IaC) en la carpeta `terraform/`. Está preparado para aprovisionar un ambiente de **Staging** en AWS, el cual constará de instancias para alojar los contenedores de Docker, garantizando un entorno idéntico al de desarrollo local para pruebas previas a producción.

## 10. Prototipo
Enlace al diseño interactivo en Figma: https://www.figma.com/design/5ckGTwcAkx4wRjsVI7VfEw/FoodAware?node-id=0-1&t=bg6G2XpqgT3mjuvQ-1