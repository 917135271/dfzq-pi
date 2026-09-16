#!/usr/bin/env bash
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/lib.sh"
require_receipt tested
# shellcheck source=ci/rehearsal-env.sh
source "$CI_ROOT/ci/rehearsal-env.sh"
mkdir -p "$DFZQ_CONFIG_DIR"
umask 077
cat > "$DFZQ_ENV_FILE" <<'ENV'
TASK_RUNTIME_INTERNAL_TOKEN=rehearsal-only
PIPELINE_DB_DSN=postgresql+psycopg://pipeline:rehearsal@pg:5432/audit_pipeline
AUDIT_AI_TENANT_ID=rehearsal
LLM_API_KEY=rehearsal-not-called
PIPELINE_EMBEDDING_MODE=endpoint
PIPELINE_SPARSE_BACKEND=bm25
ENV
docker run --rm --entrypoint node "$IMAGE" -e 'const {publicKey}=require("node:crypto").generateKeyPairSync("rsa",{modulusLength:2048}); console.log(JSON.stringify({issuer:"rehearsal",audience:"pi",keys:{test:publicKey.export({type:"spki",format:"pem"})}}))' > "$DFZQ_CONFIG_DIR/auth.json"
cat > "$DFZQ_CONFIG_DIR/gateway.json" <<'JSON'
{"id":"rehearsal","baseUrl":"http://model.invalid/v1","api":"openai-completions","apiKeyEnv":"LLM_API_KEY","roles":{"main":{"provider":"local","modelId":"unused","contextWindow":8192,"maxTokens":1024,"reasoning":false,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}}}
JSON
cleanup() { bash ci/rehearsal-down.sh; }
trap cleanup EXIT
printf active > ci/out/rehearsal/active
compose -f deploy/compose.yml up -d pg etcd minio milvus
wait_service() {
  local service="$1" id status
  for ((i=0; i<60; i++)); do
    id="$(compose -f deploy/compose.yml ps -q "$service")"
    status="$(docker inspect --format '{{.State.Health.Status}}' "$id")"
    [ "$status" != healthy ] || return 0
    sleep 5
  done
  compose -f deploy/compose.yml logs --tail 80 "$service"
  die "$service did not become healthy"
}
wait_service pg
wait_service milvus
compose -f deploy/compose.yml run --rm --entrypoint /app/deploy/init.sh pi
compose -f deploy/compose.yml up -d pi
wait_service pi
# Check the published port, not only container-local health. The node-side curl
# catches accidental loopback-only binding inside the container.
curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:${TASK_RUNTIME_PORT}/healthz" >/dev/null
# No run/model request is made by this infrastructure rehearsal.
printf '%s\n' "$REVISION" > ci/out/rehearsed
