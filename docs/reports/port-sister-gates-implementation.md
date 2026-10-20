# Stage Report: port-sister-gates

- **Stage ID:** port-sister-gates
- **Branch:** `fix/port-sister-gates` (worktree `/home/john/Projects/Agent-Builder/.lane/trees/port-sister-gates`, based on `origin/main` 4ab9038)
- **Date (UTC):** 2026-10-20
- **Goal:** Port the awesome-opencode sister gates so scout (data-only) PRs no longer fail validate: remove the stale `dist/registry.json == _site/registry.json` coupling, add a GENERATED-files guard, and fix scout-accept push auth.

## Background

PR #7 (scout/pi-weave, 1 yaml) failed validate because the old `validate-pr.yml` ran `npm run site` (rebuilding `_site/` with 64 entries) **before** `npm test`, whose `test/catalog.test.js:177` asserted rebuilt-site length equals committed `dist/registry.json` (63 entries — regenerated only after merge by the bot). Scout PRs add only `data/*.yaml` by design, so any data-only PR tripped `64 !== 63`. Sister repo avoids this: validate runs `npm test` with no prior site build, `check-pr.js` blocks GENERATED edits (bot-only allow), and a final step only proves generate/export still work.

## Deliverables

1. **`issues.yml` — scout-accept push auth (acceptance §1).** Removed `persist-credentials: false` from the scout-accept checkout so the default persisted `GITHUB_TOKEN` credential helper is used for `git push` (aligns with sister; the fragile custom `GIT_CONFIG` basic extraheader is no longer needed). Kept `fetch-depth: 0`, concurrency `group: issue-N`, job permissions `contents:write/pull-requests:write/issues:write/actions:write`, env `GITHUB_TOKEN/ISSUE_NUMBER/SENDER`, and the untrusted-issue comment. Top-level permissions untouched (`contents: read`).
2. **`validate-pr.yml` — sister model with pin SHAs (acceptance §2).** Checkout now `fetch-depth: 0` + `persist-credentials: false`; steps are Install → Unit tests (`npm test`) → Check catalog changes (`check-pr --base $BASE_REF`, conditional `--allow-generated`) → README and registry still generate (`generate-readme.js` + `export-json.js --output "$RUNNER_TEMP/registry.json"`). No `npm run site` before `npm test`. Matrix `22.23.3/24.22.0` kept; action pins unchanged (`checkout@3d3c42e…`, `setup-node@949feb2…`). `BASE_REF=origin/${{ github.event.pull_request.base.ref || 'main' }}` replaces the shallow `git fetch origin ${{ github.base_ref }} --depth=1` step (full history is already present, so the base ref always resolves). `ALLOW_GENERATED` uses the sister expression (bot actor + same-repo + `bot/readme-*` head).
3. **`scripts/check-pr.js` — GENERATED guard (acceptance §3).** Added `GENERATED_FILES=['README.md','dist/registry.json']` (exported), `--allow-generated` flag, and `ALLOW_GENERATED=true` env support. PRs touching generated files without allow fail closed; bot regeneration PRs (only generated files + allow) report `CHECK_PR_OK … bot regeneration PR`. All existing hardening untouched: argv-only git, `GIT_REF_PATTERN`, `SAFE_GIT_PATH` + PATH drop, CodeQL/Sonar NOSONAR guards, data-yaml validation, full-catalog validation + validator canary on `scripts/**` changes.
4. **`test/catalog.test.js` — decouple site from committed dist (acceptance §4).** Removed the `siteRegistry.entries.length == distRegistry.entries.length` assertion. The site block now (a) skips when gitignored `_site/` is absent (validate-pr runs `npm test` with no prior site build; `site.yml` + `stage4.test.js` still cover the build), and (b) when present validates the site registry self-consistently — version `1.0.0`, `entries.length >= 60`, sorted by category/id, stats match entries (sister behavior). Duplicate-id / taxonomy-count fail-closed checks untouched. Also added a bounded (15 s) retry around the site assertions: `stage4.test.js` rebuilds `_site/` in-process while `node --test` runs files in parallel, and a mid-rebuild read flaked 1/131 once during verification; a genuinely broken site still fails after the deadline.

## Files modified

- `.github/workflows/issues.yml` — removed `persist-credentials: false` (scout-accept), documented persisted-credential auth.
- `.github/workflows/validate-pr.yml` — rewritten to sister flow (unit tests → check-pr with allow-generated → generate proof), pins/matrix preserved.
- `scripts/check-pr.js` — GENERATED guard + `--allow-generated` / `ALLOW_GENERATED` support, `GENERATED_FILES` export.
- `test/catalog.test.js` — site/dist decoupling, skip-when-absent, self-consistent site-registry checks, rebuild-race retry.

No new dependencies. No top-level permission widening (both workflows keep least privilege; `persist-credentials: false` added only to the read-only validate checkout, matching sister).

## Test results

- `npm test` (full suite): **131 pass / 0 fail**, verified across 4 consecutive runs (3 post-fix stability runs + final), plus baseline 131/0 before edits.
- Fresh-checkout simulation (`_site/` moved away, `test/catalog.test.js` alone): **9 pass / 1 skipped / 0 fail** — unit tests pass with no prior `npm run site`, as the new validate-pr requires.
- Scout-PR simulation (acceptance §5): copied a data yaml to `scout-sim-canary.yaml` (new id/repo), `npm run site` → 65 entries, `npm test` → **131/0** (no 64-vs-63-style coupling); temp file removed, site rebuilt → 64 entries, suite re-verified 131/0.
- `check-pr.js` guard (throwaway branch, deleted afterwards): README-only scratch commit → exit 1 `CHECK_PR FAILED: generated file(s) changed without --allow-generated`; with `--allow-generated` and with `ALLOW_GENERATED=true` → exit 0 bot-regeneration OK. `--help` documents the flag; unknown flags still exit 1. Branch deleted; worktree left with only the 4 intended uncommitted modifications.
- YAML validity: both edited workflows parse via `js-yaml`; `node --check` clean on edited JS.

## Self-audit

- Fail-closed: unknown `check-pr` args exit 1; unsafe git refs rejected as before; generated edits rejected by default; site test still fails (after retry deadline) when `_site/` exists but is broken; skip happens only when the gitignored build output is absent.
- Injection: no new shell interpolation — `BASE_REF` passes as `"$BASE_REF"` argv; issue body still only flows through `scout.js` argv/env.
- Permissions: no workflow gains top-level writes; validate checkout explicitly disables credential persistence.
- Minimal scope: only the 4 listed files changed; `scout.yml`/`site.yml`/`generate-readme.yml` untouched; changes left uncommitted in the worktree (no `git push` performed).
- Residual risk: the site-test skip means validate-pr never exercises `build-site.js` — same as sister; covered by `site.yml` (Pages build) and `stage4.test.js` (byte-identical rebuild + `SOURCE_DATE_EPOCH` tests).
