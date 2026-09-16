#!/usr/bin/env bash
set -euo pipefail
CI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CI_ROOT"
REGISTRY="${DFZQ_REGISTRY:-jfrog.orientsec.com.cn/dev7-docker-release-local}"
REVISION="$(git rev-parse HEAD)"
export IMAGE="$REGISTRY/dfzq-pi:$REVISION"
die() { echo "$*" >&2; exit 1; }
require_intranet() {
  local branch="${BRANCH_NAME:-${GIT_BRANCH:-$(git symbolic-ref --short -q HEAD || true)}}"
  [ -z "${CHANGE_ID:-}" ] || die 'PR builds cannot publish or deploy'
  case "$branch" in
    dfzq/intranet|origin/dfzq/intranet|refs/heads/dfzq/intranet|refs/remotes/origin/dfzq/intranet) ;;
    *) die "Publish/deploy requires dfzq/intranet; got $branch" ;;
  esac
  bash ci/check-main.sh
}
compose() {
  if command -v docker-compose >/dev/null 2>&1; then docker-compose "$@"
  else docker compose "$@"; fi
}
require_receipt() {
  [ -f "ci/out/$1" ] && [ "$(cat "ci/out/$1")" = "$REVISION" ] || die "Missing current-revision receipt: $1"
}
