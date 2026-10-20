# Verification Report: port-sister-gates

- **Stage:** port-sister-gates
- **Branch:** `fix/port-sister-gates` (worktree `/home/john/Projects/Agent-Builder/.lane/trees/port-sister-gates`, based on `origin/main` 4ab9038)
- **Date (UTC):** 2026-10-20
- **Auditor:** Drift Guard Auditor (read-only; no code changed, no commits)
- **Scope:** `git diff --` confirms exactly 4 modified files (plus untracked implementation report): `.github/workflows/issues.yml`, `.github/workflows/validate-pr.yml`, `scripts/check-pr.js`, `test/catalog.test.js`. `package.json`/`package-lock.json` untouched (no new deps).

## 1. Rule 2 — Stub / shortcut hunt (assume broken)

- `grep -E "cmd.*true|echo .pass|\|\| true|set \+e|TODO|FIXME|XXX|HACK"` over all 4 files: **no hits**.
- `catch` blocks audited individually (not vacuous):
  - `scripts/check-pr.js:115` (`catch (_e)`) falls through to a second guarded diff attempt, whose own failure exits 1 (`:134-137`) — fail-closed fallback, not a swallow.
  - `scripts/check-pr.js:185` (`catch (_e) { return false; }`) is the validator-canary negative control: any error returns `false`, and the caller (`:253`) treats `false` as `fail(...)` → exit 1. Fail-closed.
- `node --check scripts/check-pr.js`: exit 0. Both workflows parse via `js-yaml`: YAML_OK.
- No token logging: `grep GITHUB_TOKEN|github.token` in `scripts/check-pr.js` / `test/catalog.test.js` returns nothing. No `console.log` of secrets.
- Vacuous-assert check: `test/catalog.test.js` site block still asserts version, taxonomy presence, `entries >= 60`, sorted order, stats recomputed from entries, and `index.html > 1000` bytes — substantive, not `1===1`. The retry loop is bounded (15 s deadline, rethrows after expiry), so a genuinely broken site still fails.

## 2. Rule 3 — Spec & architecture audit (every programmer claim vs diff)

| Claim | Evidence | Result |
|---|---|---|
| issues.yml scout-accept: no `persist-credentials:false`, `fetch-depth:0` kept | Diff removes the key (old line `persist-credentials: false` deleted); `grep -v "^\s*#"` finds no uncommented key (only hit is comment line 66). `fetch-depth: 0` present at line 54 | CONFIRMED |
| issues.yml convert job untouched (`fetch-depth:1`) | Line 22 `fetch-depth: 1` unchanged in diff context | CONFIRMED |
| Top-level `contents: read` kept in both workflows | `grep -A3 "^permissions"`: both files `contents: read` at top level | CONFIRMED, no permission widening |
| validate-pr.yml `fetch-depth:0` + `persist:false` | Lines 21–22 present | CONFIRMED |
| validate-pr.yml order test → check-pr → generate, no site before test | Lines 31/32–48/49–52; `grep -n site` on workflow returns nothing | CONFIRMED |
| Conditional `--allow-generated` + `ALLOW_GENERATED` sister expression | Lines 42, 44–48 match sister file `/tmp/opencode/sister-validate-pr.yml:48-54` verbatim in logic | CONFIRMED |
| `BASE_REF: origin/${{ ...base.ref \|\| 'main' }}` | Line 39, matches sister `:45` | CONFIRMED |
| Generate proof to `$RUNNER_TEMP`, not committed `dist/` | Lines 51–52 `export-json.js --output "$RUNNER_TEMP/registry.json"` | CONFIRMED, matches sister `:56-58` |
| check-pr.js GENERATED guard + `--allow-generated` / `ALLOW_GENERATED` | `GENERATED_FILES = ['README.md','dist/registry.json']` at `:147`, exported at `:271`; flag parse `:45-48`; guard `:209-218`; bot-regen OK path `:220-222` | CONFIRMED |
| Hardening preserved | `GIT_REF_PATTERN` (`:61`), `SAFE_GIT_PATH` + PATH drop (`:62,:89-92`), argv-only `execFileSync('git', [...])` (`:113,:132`), inline range guards (`:99-112,:120-131`) all intact; diff shows zero changes to those regions | CONFIRMED |
| catalog.test.js site/dist coupling removed | `grep -n distRegistry` → no hits; site block now skips when `_site/` absent (`:179-180`) and validates self-consistently (`:203-228`) | CONFIRMED |
| catalog.test.js retry fail-closed | Bounded 15 s deadline (`:186`), rethrows past deadline (`:193`) | CONFIRMED |
| No new deps | `git diff -- package.json package-lock.json` empty | CONFIRMED |
| Sister fidelity | validate-pr flow, GENERATED list `['README.md','dist/registry.json']`, and guard message all mirror `/tmp/opencode/sister-validate-pr.yml` and `/tmp/opencode/sister-prchecks.js:16,40-47`. Local adaptation (keep pins `checkout@3d3c42e…`, matrix `22.23.3/24.22.0`, `origin/<base>` instead of shallow fetch) is justified and documented | CONFIRMED |

Deviations / observations (non-blocking):
- O1: The site-test `skip` means `validate-pr` never exercises `build-site.js` — explicitly acknowledged in the implementation report §Self-audit, covered by `site.yml` + `stage4.test.js`. Same tradeoff as the sister repo. Acceptable.
- O2: QA CHECK 8 (guard E2E) was in-process only because `git commit` was policy-blocked for the QA subagent; the programmer report's CLI exit-1/exit-0/exit-0 claim is corroborated by code-path inspection (`:209-218` `fail()` → `process.exit(1)`) and my independent in-process probe below. Acceptable.

## 3. Rule 4 — Independent sample verification

- `make check`: no Makefile in repo (n/a — `npm test` is the check). `npm test` run independently by auditor: **tests 131, pass 131, fail 0, skipped 0** — matches QA claim.
- `node scripts/check-pr.js --help`: exit 0, documents `--allow-generated`.
- `node scripts/check-pr.js --base origin/main` on the worktree (only the 4 intended file modifications, no data/scripts changes vs HEAD…HEAD-range diff): `CHECK_PR_OK: no data/**/*.yaml or scripts/** files changed`, exit 0. Correct — the 4 modified files are uncommitted worktree changes, invisible to the `base...HEAD` committed diff; no data-only claim is contradicted.
- Fail-closed probe A (unsafe git ref): `--base=-evil` → `ERROR: unsafe git ref "-evil" …`, exit 1. `--base='a..b'` → same rejection, exit 1. `--base "--upload-pack=…"` (space form) → `--base requires a value`, exit 1. Unknown flag `--bogus` → `ERROR: unknown argument`, exit 1. All fail-closed.
- Fail-closed probe B (GENERATED guard): in-process `classifyChangedFiles(['README.md'])` → `{yamlChanged:[], scriptsChanged:[]}`, `generatedChanged=['README.md']` non-empty → without allow the `:211` branch calls `fail()` (exit 1); with allow the `:220-222` bot-regen OK path fires. `GENERATED_FILES` export verified as `["README.md","dist/registry.json"]`. (Full CLI E2E with a scratch commit was not repeated: committing is out of scope for the auditor; the branch is verified identical to the programmer-tested logic.)
- Red-proofs reviewed (`docs/evidence/port-sister-gates/red-proofs.log`): Sabotage 1 (re-add `persist-credentials:false` → grep check fails as expected, then `diff` verifies identical restore) and Sabotage 2 (neuter GENERATED guard → `GUARD GONE` + defective exit-0 simulation, then restore verified by `diff` + `node --check`) both demonstrate non-vacuous checks with backup/restore hygiene and clean final `git status`. Both RED-PROOF PASS. QA log (`qa-run.log`) checks 1–7 fully evidenced; check 8's policy constraint is documented, not hidden.

## 4. Binding verdict

All deliverables complete, zero stubs, hardening intact, permissions least-privilege, both fail-closed probes reject as required, independent `npm test` 131/0, red-proofs valid with verified restores. Observations O1–O2 are documented tradeoffs, not defects. No findings requiring programmer rework.

**VERDICT: PASS**
