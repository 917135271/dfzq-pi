# Main-aligned intranet operations

`main` owns all product code, including `services/audit-ai`. `dfzq/intranet` must contain main as an ancestor and may only add `Jenkinsfile`, `ci/`, and `deploy/`. `ci/check-main.sh` rejects product changes and stale ancestry. Merge main into this branch before each release; never cherry-pick self-optimization history. The old pipeline, canary replay and nightly optimization remain on the archived intranet branch and are not part of this release.

## Jenkins setup

Fetch full history and `refs/heads/main:refs/remotes/origin/main` during SCM checkout. The job's branch is `dfzq/intranet`; script path is `Jenkinsfile`. Detached Jenkins checkouts use BRANCH_NAME/GIT_BRANCH; PRs cannot publish or deploy. Local validation can use `MAIN_REF=main`. Main itself has no Jenkins deployment pipeline. `feature/runtime-selfopt` is a separate local development line.

Agents need Git, Bash, curl, Docker and Compose (v1.29.2 or v2). Production deployment additionally requires tar, SSH, trusted known_hosts and Jenkins credential `dfzq-build-ssh`. Set DFZQ_REGISTRY, DFZQ_RUNTIME_BASE (node22-r2: Node >=22.19, Python3.11+ and Git; rebuild L0 if the old node22-r1 lacks Git), DFZQ_PLATFORM (default linux/amd64), NPM_REGISTRY and PIP_INDEX_URL for internal package sources. Registry login is administered outside the repo. Do not put package-source credentials in build arguments; use an internal authenticated network proxy/mirror.

Set DFZQ_DEPLOY_HOST and DFZQ_DEPLOY_DIR before enabling CD. DFZQ_NO_PROD_DEPLOY=1 pauses production. Production is reachable only from the exact intranet branch after current-commit test/rehearsal/publication receipts. No force-publish flag exists.

## Same-repository images

`bash deploy/build.sh --runtime-base` builds the external-only OS layer. `--base` installs Python from this checkout with pinned constraints, without OCR/local embedding extras. `--test` validates native runtime types and the explicit production test allowlist plus Python offline tests; default mode builds the application. `--dry-run` prints commands without Docker effects. Contexts use git archive, so commit changes first; neither a sibling checkout nor DFZQ_AUDIT_AI_GIT is used. Full commit IDs tag both Python base and application. Node runs TypeScript through native stripping; there is no upstream build step.

CI intentionally checks installed production packages, not Pi upstream source aliases. Full root checks remain the main development gate and need a matching hydrated upstream model catalog; do not replace it with empty JSON. The Python offline test command never contacts real models or databases. Infrastructure rehearsal starts disposable local databases and calls health only; it does not submit business runs. Do not execute rehearsal on production hosts.

## First deployment and configuration

Copy compose.yml and ops.sh to the deployment directory, create `.env` from `.env.example`, and place `config/gateway.json` (ProviderProfile) and `config/auth.json` (GrantConfig with issuer, audience, keys mapping key IDs to Java RSA public PEMs). Keep Java private keys outside Pi. See packages/task-runtime/docs/repair-project/contracts/authorization.md for claims and actions. Profile apiKeyEnv must name an environment variable supplied by .env. Optional `config/audit/` must contain the full service config set. It is mounted read-only and forwarded to both pipeline/query. Backend port is19530 in the container network.

Audit AI is one tenant per database/index deployment. Set AUDIT_AI_TENANT_ID and use matching grants; unsupported project/owner scopes fail closed. Backend secrets and optional report-source/memory endpoint settings belong in .env, not this repository. Persisted runtime data lives in runtime_data; config is a separate read-only bind mount.

Before first rollout, start data services and run `bash ops.sh init IMAGE` after inspecting the offline migration SQL and backing up existing data. This command migrates, seeds dictionaries and validates the vector schema. Existing databases stamped with the removed feedback0018 need a separate migration plan. CD does not automatically migrate production databases. Each future schema change needs an explicit compatible migration before application rollout.

`bash ops.sh deploy IMAGE` waits for health. `status`, `stop`, `restart` manage the application. Roll back by deploying a prior schema-compatible image; never downgrade/delete database volumes. Existing deployments need the new mounted public-key config and embedded source layout before rollout. The previous operational directory/env cannot be assumed compatible unchanged.
