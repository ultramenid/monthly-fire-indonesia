#!/usr/bin/env bash
# Runs ON THE SERVER, called by .github/workflows/deploy.yml: remote-deploy.sh <image tag>
# It comes from the checkout that was just reset to origin/main, so deploy logic is versioned with the code.
# Pulls the image, waits until it is healthy and serves the page, otherwise rolls back to the previous tag.
set -euo pipefail

TAG="${1:?usage: remote-deploy.sh <image tag>}"
[[ "$TAG" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "bad tag: $TAG" >&2; exit 1; }

STACK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$STACK_DIR/.env"
ENV_ROLLBACK="$STACK_DIR/.env.rollback"
IMAGE_KEEP_HOURS=24  # keep the last day of images for a quick rollback
HEALTH_TIMEOUT=180

log() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }
compose() { docker compose --project-directory "$STACK_DIR" "$@"; }

[ -f "$ENV_FILE" ] || die "no $ENV_FILE yet: cp .env.example .env, set DOMAIN, then re-run the deploy"
[ -w "$ENV_FILE" ] || die "$ENV_FILE is not writable by $(id -un) (the deploy writes WEB_TAG there): sudo chown $(id -un): $ENV_FILE"
for key in DOMAIN VITE_API_URL VITE_MAPBIOMAS_URL VITE_BASEMAP_DARK VITE_BASEMAP_LIGHT VITE_BASEMAP_SATELLITE; do
  grep -Eq "^$key=.+" "$ENV_FILE" || die "$key is missing or empty in $ENV_FILE (see .env.example)"
done

set_tag() {
  if grep -q '^WEB_TAG=' "$ENV_FILE"; then
    sed -i.bak "s|^WEB_TAG=.*|WEB_TAG=$1|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"  # -i.bak: works with GNU and BSD sed
  else
    printf 'WEB_TAG=%s\n' "$1" >>"$ENV_FILE"
  fi
}

# Healthy (Dockerfile HEALTHCHECK on /healthz) AND index.html actually has the app root.
wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) id
  id="$(compose ps -q web)"
  [ -n "$id" ] || return 1
  until [ "$(docker inspect -f '{{.State.Health.Status}}' "$id" 2>/dev/null)" = healthy ]; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 3
  done
  compose exec -T web wget -qO- http://127.0.0.1:8080/ | grep -q 'id="root"'
}

diagnostics() {
  compose ps || true
  compose logs --tail 40 web caddy || true
}

cp "$ENV_FILE" "$ENV_ROLLBACK"
set_tag "$TAG"

log "pull + up (WEB_TAG=$TAG)"
compose pull web
compose up -d --no-build --remove-orphans

if wait_healthy; then
  rm -f "$ENV_ROLLBACK"
  log "deploy OK: healthy and serving the app"
  log "removing unused images older than ${IMAGE_KEEP_HOURS}h"
  docker image prune -af --filter "until=${IMAGE_KEEP_HOURS}h" || true
  docker builder prune -f --filter "until=${IMAGE_KEEP_HOURS}h" || true
  exit 0
fi

log "health check failed, rolling back"
diagnostics
mv "$ENV_ROLLBACK" "$ENV_FILE"
if grep -q '^WEB_TAG=' "$ENV_FILE"; then
  compose pull web
  compose up -d --no-build --remove-orphans
  if wait_healthy; then log "rollback healthy: back on the previous version"; else log "ROLLBACK ALSO UNHEALTHY: check the server"; diagnostics; fi
else
  log "first deploy, nothing to roll back to"
fi
die "deploy $TAG failed"
