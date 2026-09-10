# FoodAware

## Descripción Breve
FoodAware es una aplicación web multiplataforma diseñada para ayudar a los usuarios a elegir alimentos compatibles con sus necesidades, clasificando productos según sus restricciones o preferencias personales.

## Integrantes:
**Ignacio Reyes**
**Joaquín Muñoz**

## Principales Funcionalidades
*   Registro y gestión de perfiles nutricionales
*   Búsqueda y clasificación de alimentos aptos
*   Escaneo/Búsqueda de productos

## Capacidad Adaptativa o Inteligente
*   **Descripción:** El sistema clasificará productos en tiempo real determinando si son aptos o no, basándose en las restricciones configuradas en el perfil del usuario.
*   **Mecanismo:** Procesamiento mediante reglas/clasificación implementado en un servicio especializado de Python (FastAPI).

## Fuentes de Información Web

## Arquitectura General y Tecnologías
*   **Frontend:** Angular + Ionic Framework + Capacitor
*   **Backend Principal:** NestJS (API REST principal)
*   **Servicio Especializado:** Python + FastAPI (Procesamiento inteligente)
*   **Base de Datos:** PostgreSQL
*   **Infraestructura y DevSecOps:** Docker, Docker Compose, Terraform, GitHub Actions.

## Instrucciones de Instalación y Ejecución

Siga los pasos a continuación para configurar y ejecutar el proyecto en su entorno local:

1. **Clonar el repositorio:**
   Descargue el código fuente a su entorno local.

2. **Crear las variables de entorno:**
   Copie el archivo `.env.example`, renómbrelo a `.env` y configure los valores locales correspondientes.

3. **Ejecutar el proyecto:**
   Utilice el comando `docker-compose up --build` para construir y levantar los contenedores de la base de datos, el frontend, el backend y el servicio de Python(FastAPI).

## Pipeline DevSecOps
El proyecto utiliza GitHub Actions para establecer un flujo robusto de automatización e integración continua (CI). Este pipeline se encarga de ejecutar la instalación de dependencias, realizar revisiones de código, construir las imágenes de Docker correspondientes y llevar a cabo un escaneo estricto de seguridad utilizando GitLeaks para prevenir la exposición accidental de credenciales o información sensible.

## Prototipo
Enlace al diseño interactivo en Figma: https://www.figma.com/design/5ckGTwcAkx4wRjsVI7VfEw/FoodAware?node-id=0-1&t=bg6G2XpqgT3mjuvQ-1
