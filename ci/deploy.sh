#!/usr/bin/env bash
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/lib.sh"
require_intranet
require_receipt tested
require_receipt rehearsed
require_receipt published
[ "${DFZQ_NO_PROD_DEPLOY:-0}" != 1 ] || { echo 'Production deployment paused'; exit 0; }
: "${DFZQ_DEPLOY_HOST:?Set the production SSH host}"
: "${DFZQ_DEPLOY_DIR:?Set the absolute deployment directory}"
: "${SSH_KEY:?Jenkins SSH credential file required}"
[[ "$DFZQ_DEPLOY_DIR" =~ ^/[a-zA-Z0-9_/-]+$ ]] || die 'Invalid deployment directory'
[[ "$DFZQ_DEPLOY_HOST" =~ ^[a-zA-Z0-9_.@-]+$ ]] && [[ "$DFZQ_DEPLOY_HOST" != -* ]] || die 'Invalid deployment host'
[[ "$IMAGE" =~ ^[a-zA-Z0-9./:_-]+$ ]] || die 'Invalid image reference'
ssh_args=(-i "$SSH_KEY" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10)
# Install keys/known_hosts and the production .env/config separately before enabling CD.
# All interpolated remote arguments are validated above.
# shellcheck disable=SC2029
ssh "${ssh_args[@]}" "$DFZQ_DEPLOY_HOST" "test -s '$DFZQ_DEPLOY_DIR/.env' && test -s '$DFZQ_DEPLOY_DIR/config/auth.json'"
# Validated deployment path, no secret values.
# shellcheck disable=SC2029
tar -cf - -C deploy compose.yml ops.sh | ssh "${ssh_args[@]}" "$DFZQ_DEPLOY_HOST" "tar -xf - -C '$DFZQ_DEPLOY_DIR'"
# Validated deployment path and image reference.
# shellcheck disable=SC2029
ssh "${ssh_args[@]}" "$DFZQ_DEPLOY_HOST" "bash '$DFZQ_DEPLOY_DIR/ops.sh' deploy '$IMAGE'"
