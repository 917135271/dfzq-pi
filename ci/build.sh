#!/usr/bin/env bash
# shellcheck source=ci/lib.sh
source "$(dirname "$0")/lib.sh"
[ -z "$(git status --porcelain --untracked-files=normal)" ] || die 'Build only a clean committed worktree'
bash ci/check-main.sh
mkdir -p ci/out
rm -f ci/out/tested ci/out/rehearsed ci/out/published
bash deploy/build.sh --test
printf '%s\n' "$REVISION" > ci/out/tested
bash deploy/build.sh
