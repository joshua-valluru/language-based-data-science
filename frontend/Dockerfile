# ---- build the Vite app ----
FROM node:20-alpine AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY frontend/ ./
RUN npm run build

# ---- serve with nginx ----
FROM nginx:alpine
# Copy built app
COPY --from=build /app/dist /usr/share/nginx/html
# Default.conf is mounted by docker-compose; no need to COPY it here.
# Keep the stock nginx.conf.
    