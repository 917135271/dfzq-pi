#!/usr/bin/env bash
set -euo pipefail
for name in TASK_RUNTIME_INTERNAL_TOKEN TASK_RUNTIME_AUTH_CONFIG TASK_RUNTIME_PROFILE PIPELINE_DB_DSN AUDIT_AI_TENANT_ID; do
  [ -n "${!name:-}" ] || { echo "$name is required" >&2; exit 1; }
done
test -s "$TASK_RUNTIME_AUTH_CONFIG"
test -s "$TASK_RUNTIME_PROFILE"
mkdir -p "$TASK_RUNTIME_WORK_ROOT" "$(dirname "$POLICY_MCP_AUDIT_LOG")"
# Optional settings override must include all service config files, not just TOML.
if [ -d /config/audit ]; then
  export PIPELINE_CONFIG_DIR=/config/audit QUERY_CONFIG_DIR=/config/audit
fi
exec node /app/packages/task-runtime/src/cli/main.ts serve
