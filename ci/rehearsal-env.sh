#!/usr/bin/env bash
# Fixed dedicated rehearsal project; never accept production project/volume overrides.
COMPOSE_PROJECT_NAME="dfzq-ci-$(printf %s "$CI_ROOT" | cksum | cut -d' ' -f1)"
export COMPOSE_PROJECT_NAME
export PG_PORT=15432 MILVUS_PORT=29530 MILVUS_HEALTH_PORT=29091 TASK_RUNTIME_PORT=28080 TASK_RUNTIME_BIND=127.0.0.1
export PG_PASSWORD=rehearsal MINIO_ACCESS_KEY=rehearsal MINIO_SECRET_KEY=rehearsal-only
export PI_IMAGE="$IMAGE"
export DFZQ_CONFIG_DIR="$CI_ROOT/ci/out/rehearsal/config" DFZQ_ENV_FILE="$CI_ROOT/ci/out/rehearsal/env"
