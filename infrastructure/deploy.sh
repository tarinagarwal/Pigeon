#!/usr/bin/env bash
#
# Production deploy, run on the VM by .github/workflows/deploy.yml.
#
#   deploy.sh <previous-git-sha> [services]
#
# Rebuilds only the services whose source changed between <previous-git-sha>
# and the current HEAD. Pass "all" as the second argument to force everything.
# Must run as root (docker and /opt/pigeon are root-owned).
set -euo pipefail

PREV_SHA="${1:-}"
FORCED="${2:-auto}"
cd /opt/pigeon

HEAD_SHA="$(git rev-parse HEAD)"
echo "==> deploying ${HEAD_SHA:0:7} (was ${PREV_SHA:0:7})"

# Work out which compose services need rebuilding.
declare -a SERVICES=()
if [ "$FORCED" != "auto" ] && [ -n "$FORCED" ]; then
  if [ "$FORCED" = "all" ]; then
    SERVICES=(backend frontend admin)
  else
    read -r -a SERVICES <<< "$FORCED"
  fi
else
  CHANGED="$(git diff --name-only "$PREV_SHA" "$HEAD_SHA" 2>/dev/null || echo "ALL")"
  if [ "$CHANGED" = "ALL" ]; then
    SERVICES=(backend frontend admin)
  else
    grep -q '^pigeon-backend/'      <<< "$CHANGED" && SERVICES+=(backend)  || true
    grep -q '^pigeon-frontend-next/' <<< "$CHANGED" && SERVICES+=(frontend) || true
    grep -q '^pigeon-admin-panel/'   <<< "$CHANGED" && SERVICES+=(admin)    || true
    # A compose change can affect any service.
    if grep -q '^docker-compose\.yml$' <<< "$CHANGED"; then
      SERVICES=(backend frontend admin)
    fi
  fi
fi

if [ ${#SERVICES[@]} -eq 0 ]; then
  echo "==> no application source changed; nothing to rebuild"
  exit 0
fi

echo "==> rebuilding: ${SERVICES[*]}"
docker compose build "${SERVICES[@]}"
docker compose up -d "${SERVICES[@]}"

# Give containers a moment before checking health.
sleep 10
echo "==> container status"
docker compose ps --format '  {{.Service}}\t{{.Status}}'

echo "==> health checks"
FAILED=0
for i in $(seq 1 12); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:8001/api/health || echo 000)"
  [ "$CODE" = "200" ] && { echo "  backend: OK"; break; }
  [ "$i" = "12" ] && { echo "  backend: FAILED (last HTTP $CODE)"; FAILED=1; }
  sleep 5
done
for pair in "frontend:8080" "admin:8082"; do
  name="${pair%%:*}"; port="${pair##*:}"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:${port}/" || echo 000)"
  case "$CODE" in
    200|301|302|307|308) echo "  ${name}: OK (HTTP $CODE)" ;;
    *) echo "  ${name}: FAILED (HTTP $CODE)"; FAILED=1 ;;
  esac
done

# Verify the public edge (Caddy + TLS), not just the container ports.
for i in $(seq 1 10); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 https://pigeon.tarinagarwal.in/ || echo 000)"
  [ "$CODE" = "200" ] && { echo "  public edge: OK"; break; }
  [ "$i" = "10" ] && { echo "  public edge: FAILED (last HTTP $CODE)"; FAILED=1; }
  sleep 6
done

# Reclaim space so the 49 GB disk does not fill with old layers.
docker image prune -f >/dev/null 2>&1 || true

[ "$FAILED" -eq 0 ] && echo "==> deploy OK" || { echo "==> deploy FAILED"; exit 1; }
