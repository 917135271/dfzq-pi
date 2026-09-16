ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS deps
WORKDIR /app
COPY . /app/
ARG NPM_REGISTRY
RUN if [ -n "$NPM_REGISTRY" ]; then npm ci --ignore-scripts --registry "$NPM_REGISTRY"; else npm ci --ignore-scripts; fi

FROM deps AS test
# Native deployed packages are the CI type/test boundary, not upstream source aliases.
RUN npx biome check --error-on-warnings . \
 && npm run check:pinned-deps && npm run check:ts-imports \
 && npm run check:shrinkwrap && npm run check:install-lock:coding-agent \
 && npm run check:production --workspace=@dfzq/task-runtime \
 && npm run audit-ai:check
RUN mkdir -p /out \
 && python ci/test_operations.py \
 && npm run test:production --workspace=@dfzq/task-runtime -- --reporter=default --reporter=junit --outputFile=/out/junit-node.xml \
 && python ci/python-tests.py /out/junit-python.xml

FROM ${BASE_IMAGE} AS runtime
WORKDIR /app
COPY . /app/
ARG NPM_REGISTRY
RUN if [ -n "$NPM_REGISTRY" ]; then npm ci --omit=dev --ignore-scripts --registry "$NPM_REGISTRY"; else npm ci --omit=dev --ignore-scripts; fi
ENV TASK_RUNTIME_SPECS_DIR=/app/packages/task-runtime/specs \
    TASK_RUNTIME_PROFILE=/config/gateway.json \
    TASK_RUNTIME_AUTH_CONFIG=/config/auth.json \
    TASK_RUNTIME_WORK_ROOT=/data/work \
    TASK_RUNTIME_PORT=18080 TASK_RUNTIME_BIND_HOST=0.0.0.0 \
    POLICY_MCP_AUDIT_LOG=/data/logs/policy-mcp.jsonl
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 \
 CMD curl -fsS http://127.0.0.1:18080/healthz || exit 1
ENTRYPOINT ["/app/deploy/entrypoint.sh"]
