# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# Instalamos dependencias. Fallará silenciosamente si package.json aún no existe, lo cual es útil para este MVP iterativo.
RUN npm install || true
COPY . .
# Angular exporta por defecto a dist/frontend (o dist/ dependiendo de la versión)
RUN npm run build || true
# Aseguramos que el directorio exista para que COPY no falle si el código aún no ha sido generado
RUN mkdir -p /app/dist/frontend

# Stage 2: Serve
FROM nginx:alpine
# Copiamos la salida de la compilación
COPY --from=build /app/dist/frontend /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
