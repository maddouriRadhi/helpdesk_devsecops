# ---- Étape 1 : build du frontend React/Vite ----
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
# L'API est appelée en chemin relatif : Nginx la redirige vers le backend
ARG VITE_API_URL=/api/tickets
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# ---- Étape 2 : Nginx (non-root, port 8080) ----
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080
