# Stage 1: Build
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# Sin atajos. Si falla, queremos que nos avise.
RUN npm run build 

# Stage 2: Serve
FROM nginx:alpine
# Copiamos la salida (Ionic usa www por defecto, si usas Angular puro a veces es dist/nombre-proyecto/browser)
COPY --from=build /app/www /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]