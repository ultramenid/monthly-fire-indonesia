# Build the static site, then serve it with an unprivileged nginx (listens on 8080, runs as non-root)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# .env is not copied (see .dockerignore); config comes in as build args, see .env.example
ARG VITE_API_URL VITE_MAPBIOMAS_URL VITE_BASEMAP_DARK VITE_BASEMAP_LIGHT VITE_BASEMAP_SATELLITE
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
