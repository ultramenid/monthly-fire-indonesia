# Build the static site, then serve it with an unprivileged nginx (listens on 8080, runs as non-root)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Config-free build: .env is not copied (see .dockerignore); VITE_* come in at runtime via /config.js
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.29-alpine
# Rendered to conf.d at start by the image's envsubst step; only VITE_* are substituted, nginx's own $vars stay
ENV NGINX_ENVSUBST_FILTER=^VITE_
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
