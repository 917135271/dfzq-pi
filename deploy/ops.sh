#!/usr/bin/env bash
# A rollback deploys a previously validated image; never downgrade/delete data.
set -euo pipefail
cd "$(dirname "$0")"
compose() {
  if command -v docker-compose >/dev/null 2>&1; then docker-compose --project-directory "$PWD" -f compose.yml "$@"
  else docker compose --project-directory "$PWD" -f compose.yml "$@"; fi
}
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-dfzq-policy}"
case "${1:-}" in
  deploy)
    export PI_IMAGE="${2:?Pass an immutable image reference}"
    compose pull pi
    compose up -d pg etcd minio milvus
    # Migration is a separate explicit command; application rollout must not mutate schema.
    compose up -d pi
    for ((i=0; i<60; i++)); do
      cid="$(compose ps -q pi)"
      if [ "$(docker inspect --format '{{.State.Health.Status}}' "$cid")" = healthy ]; then
        printf '%s\n' "$PI_IMAGE" > .deployed-image
        exit 0
      fi
      sleep 5
    done
    compose logs --tail 80 pi
    echo 'Deployment unhealthy; redeploy the previous compatible image to roll back' >&2
    exit 1
    ;;
  init)
    export PI_IMAGE="${2:?Pass an immutable image reference}"
    compose run --rm --entrypoint /app/deploy/init.sh pi
    ;;
  status|stop|restart)
    PI_IMAGE="$(cat .deployed-image)"
    export PI_IMAGE
    case "$1" in status) compose ps;; stop) compose stop pi;; restart) compose restart pi;; esac
    ;;
  *) echo 'Usage: ops.sh deploy|init IMAGE, or status|stop|restart' >&2; exit 2;;
esac
