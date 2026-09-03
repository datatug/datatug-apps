#!/bin/sh

set -eu

compose_file=apps/datatug-app/e2e/keycloak/docker-compose.yml

if docker compose version >/dev/null 2>&1; then
  set -- docker compose
elif command -v docker-compose >/dev/null 2>&1; then
  set -- docker-compose
else
  echo "Docker Compose is required for the Keycloak SSO E2E profile." >&2
  exit 1
fi

cleanup() {
  "$@" -f "$compose_file" down --remove-orphans >/dev/null 2>&1 || true
}

trap 'cleanup "$@"' EXIT INT TERM
"$@" -f "$compose_file" down --remove-orphans
"$@" -f "$compose_file" up
