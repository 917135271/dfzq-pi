#!/usr/bin/env bash
# Product files must be byte-for-byte identical to the current main ref.
set -euo pipefail
cd "$(dirname "$0")/.."
ref="${MAIN_REF:-refs/remotes/origin/main}"
git rev-parse --verify "$ref^{commit}" >/dev/null 2>&1 || {
  echo "Missing $ref; fetch main (including history) before running CI" >&2; exit 1;
}
git merge-base --is-ancestor "$ref" HEAD || {
  echo "main is not an ancestor; merge main before deploying" >&2; exit 1;
}
while IFS=$'\t' read -r status path; do
  [ -n "$path" ] || continue
  case "$status:$path" in
    A:Jenkinsfile|A:ci/*|A:deploy/*) ;;
    *) echo "Non-operational difference from main: $status $path" >&2; exit 1 ;;
  esac
done < <(git diff --no-renames --name-status "$ref" HEAD)
echo "Product tree matches $ref; only operational additions are present"
