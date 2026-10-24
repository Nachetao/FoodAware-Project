# Stage 1: Build
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Production
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
# Solo dependencias de producción. Después se quitan npm y npx de la imagen:
# no se usan en ejecución y sus dependencias son las que más reporta Trivy.
RUN npm ci --omit=dev \
    && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# NestJS transpila a /dist
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main"]
