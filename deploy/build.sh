#!/usr/bin/env bash
# Build from a git archive: never include local venvs, credentials or worktrees.
set -euo pipefail
cd "$(dirname "$0")/.."
mode=runtime; dry=0
for arg in "$@"; do
  case "$arg" in --test) mode="test";; --base) mode=base;; --runtime-base) mode=runtime-base;; --dry-run) dry=1;; *) echo "Unknown argument: $arg" >&2; exit 2;; esac
done
registry="${DFZQ_REGISTRY:-jfrog.orientsec.com.cn/dev7-docker-release-local}"
revision="$(git rev-parse HEAD)"
runtime_base="${DFZQ_RUNTIME_BASE:-$registry/dfzq-runtime-base:node22-r2}"
platform="${DFZQ_PLATFORM:-linux/amd64}"
image="$registry/dfzq-pi:$revision"
run() { if [ "$dry" = 1 ]; then printf '%q ' "$@"; printf '\n'; else "$@"; fi; }
if [ "$dry" = 0 ]; then
  [ -z "$(git status --porcelain --untracked-files=normal)" ] || { echo 'Commit changes before building' >&2; exit 1; }
fi
context="$(mktemp -d)"
container_id=''
cleanup() {
  if [ -n "$container_id" ]; then docker rm -f "$container_id" >/dev/null; fi
  rm -rf "$context"
}
trap cleanup EXIT
if [ "$dry" = 0 ]; then git archive HEAD | tar -x -C "$context"; fi
if [ "$mode" = runtime-base ]; then
  run docker build --platform "$platform" -f "$context/deploy/Dockerfile.runtime-base" -t "$runtime_base" "$context"
  exit 0
fi
base="$registry/dfzq-pi-base:$revision"
# Both base and application consume this checkout; no independent audit-ai clone/tag.
run docker build --platform "$platform" -f "$context/deploy/Dockerfile.base" \
  --build-arg "RUNTIME_BASE=$runtime_base" --build-arg "PIP_INDEX_URL=${PIP_INDEX_URL:-}" \
  --build-arg "PIP_TRUSTED_HOST=${PIP_TRUSTED_HOST:-}" -t "$base" "$context"
[ "$mode" != base ] || exit 0
run docker build --platform "$platform" --target "$mode" -f "$context/deploy/Dockerfile" \
  --build-arg "BASE_IMAGE=$base" --build-arg "NPM_REGISTRY=${NPM_REGISTRY:-}" \
  -t "$image-$mode" "$context"
if [ "$mode" = test ]; then
  mkdir -p ci/out
  if [ "$dry" = 0 ]; then
    container_id="$(docker create "$image-test")"
    docker cp "$container_id:/out/." ci/out/
    test -s ci/out/junit-node.xml && test -s ci/out/junit-python.xml
  fi
else
  run docker tag "$image-runtime" "$image"
fi
