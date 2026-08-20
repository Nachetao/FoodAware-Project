# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install || true
COPY . .
RUN npm run build || true

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production || true
# NestJS transpila a /dist
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
