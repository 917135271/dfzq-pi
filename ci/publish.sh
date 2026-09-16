#!/usr/bin/env bash
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/lib.sh"
require_intranet
require_receipt tested
require_receipt rehearsed
docker push "$IMAGE"
printf '%s\n' "$REVISION" > ci/out/published
