#!/usr/bin/env bash
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/lib.sh"
[ -f ci/out/rehearsal/active ] || exit 0
# shellcheck source=ci/rehearsal-env.sh
source "$CI_ROOT/ci/rehearsal-env.sh"
compose -f deploy/compose.yml down -v --remove-orphans
rm -f ci/out/rehearsal/active
