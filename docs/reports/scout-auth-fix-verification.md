# Verification Report: scout-auth-fix

- **Stage:** scout-auth-fix
- **Worktree:** `/home/john/Projects/Agent-Builder/.lane/trees/scout-auth-fix` (branch `fix/scout-auth`, base `origin/main` 29897bb)
- **Auditor:** Drift Guard (read-only; no code changed)
- **Date:** 2026-10-20

## 1. Production failure mapping (verified against diff)

- Issue #6 pi-weave tick failed with `git push --set-upstream origin scout/pi-weave → fatal: could not read Username for 'https://github.com'` because push used `AUTHORIZATION: bearer <token>` with `persist-credentials:false` checkout. Run then reported `ACCEPT_OK: processed 0` and the old `/ → /` guard permanently skipped the failed line on retry.
- Diff (`git diff -- scripts/scout.js`) confirms both root causes are addressed in the single modified file:
  - Old inline push env `GIT_CONFIG_VALUE_0: AUTHORIZATION: bearer ${token}` removed; replaced by `gitAuthEnv(token)` (lines 807–815) computing `Buffer.from('x-access-token:'+token).toString('base64')` → `AUTHORIZATION: basic <base64>`, applied to both `fetch` (line 951) and `push` (lines 964–966).
  - Old skip guard `if (!selected || / → /.test(line) ...)` replaced by `/ → #\d+/` (line 936); `cleanLine` stripping added (line 942); body rewrite uses `cleanLine` (line 998) so arrows cannot duplicate.
  - Push-failure note now uses `redactSecrets(err.message, token)` (line 995) instead of raw-token-only split.

## 2. Spec / implementation-report cross-check

Every claim in `docs/reports/scout-auth-fix-implementation.md` verified against the diff:

| # | Claim | Evidence | Status |
|---|-------|----------|--------|
| 1 | `gitAuthEnv` basic auth, same scheme as actions/checkout; applied to fetch+push | `scripts/scout.js:807-815`, `:951`, `:964-966`; `git diff` shows old `bearer` hunk removed | CONFIRMED |
| 2 | Skip guard narrowed `/ → /` → `/ → #\d+/`; failure lines retry | `scripts/scout.js:936`; probe below | CONFIRMED |
| 3 | `cleanLine` strip + dedup-safe rewrite, no arrow duplication | `scripts/scout.js:942,998`; probe: single-`→` output, multi-arrow strip | CONFIRMED |
| 4 | `redactSecrets` redacts raw token + base64 blob | `scripts/scout.js:819-827`; probe true | CONFIRMED |
| 5 | No workflow changes, no permission widening | `git diff --stat` = only `scripts/scout.js`; `git diff -- .github/workflows/` empty; `issues.yml:11-12` top-level `contents: read`, scout-accept job perms unchanged; `scout.yml` untouched | CONFIRMED |
| 6 | No new dependencies | `package.json` untouched; only `fs/path/child_process/js-yaml/catalog` imports | CONFIRMED |
| 7 | `wx` guard, EEXIST refusal, rollback, sender check unchanged | `scripts/scout.js:900-911,952-960,992-994` intact | CONFIRMED |
| 8 | Test results quoted (dry-runs, syntax, probes, npm test + flaky build-site note) | Re-verified below; flakiness reproduced once (130/1) then 3× consecutive 131/0 — consistent with report's disclosure | CONFIRMED |

## 3. Stub / shortcut hunt (Rule 2)

- `node --check scripts/scout.js` → `SYNTAX_OK`.
- `grep -n "bearer\|TODO\|FIXME\||| true\|set +e"` → only hit is the comment on line 805 explaining why `bearer` is invalid. No `TODO/FIXME/|| true/cmd:true/echo pass` shortcuts.
- `grep -n "catch"` → 15 sites; all pre-existing fail-open network/rollback handlers with comments, plus the fail-closed `fail()` paths — no empty swallowing of the fixed logic. The `fetch` catch (line 951) is explicitly offline-safe fallback, documented.
- `grep -n "execSync|execFileSync|spawn"` → single `execFileSync('git', args, ...)` at line 801, argv-array only. No shell interpolation of issue text anywhere: `issue.body` flows only through `DATA_RE.exec` (line 914), `JSON.parse`, `buildEntryYaml`, and `body.replace` — never into `gitExec`.
- `grep -n "console.log.*token|console.error.*token"` → no hits. Token reaches logs only via `redactSecrets`-wrapped note.
- Workflows: `issues.yml:63-71` passes issue number/sender as env→argv (`"$ISSUE_NUMBER" "$SENDER"`), never interpolates body into shell. Comment at lines 63–65 documents this.

## 4. Independent sample verification (Rule 4, fail-closed)

Probes run read-only in the worktree (no push, no network writes):

1. **Missing GITHUB_TOKEN fails closed:** `env -u GITHUB_TOKEN GITHUB_REPOSITORY=owner/repo node scripts/scout.js accept --issue 6` → `ERROR: live accept requires GITHUB_TOKEN in the environment.`, exit 1. ✅
2. **Invalid issue fails closed:** `node scripts/scout.js accept --issue bad --dry-run` → `ERROR: invalid --issue 'bad': must be a positive integer`, exit 1. ✅ (also without `--dry-run` path; missing `--issue` → `ERROR: accept requires --issue <n>`, exit 1.)
3. **Auth helper correctness:** `gitAuthEnv('tok123').GIT_CONFIG_VALUE_0 === 'AUTHORIZATION: basic ' + base64('x-access-token:tok123')` → true; no `/bearer/i` → true; key/count correct → true. ✅
4. **Redaction:** `redactSecrets` removes both raw token and base64 blob → true. ✅
5. **Retry semantics:** success line (`→ #12`) matches skip regex → true; failure line (`→ not added: ...`) and paren line (`→ (PR creation failed...)`) do not → retry allowed. ✅
6. **No-duplication:** strip + re-append yields exactly one `→` before `<!-- scout:c30 -->` → true; double-failure line strips to zero arrows → true. ✅
7. **`make check` equivalent / suite:** `node --check` SYNTAX_OK; `node scripts/scout.js run --dry-run` and `accept --issue 6 --dry-run` exit 0 (matches qa-run.log). `npm test`: full suite observed 131/0 on three consecutive runs at audit time; one earlier 130/1 flake in `scripts/build-site.js (_site/) → produces index.html` (timing/state-sensitive, no scout.js dependency) matches the report's disclosed flake. All 6 test files green in isolation (catalog-negative 19/0, catalog 10/0, compiler 28/0, local-server 47/0, mcp 8/0, stage4 19/0). No scout-specific test exists; invariants covered by probes above. ✅

## 5. Red-proof log review

`docs/evidence/scout-auth-fix/red-proofs.log` describes 2 sabotages (bearer revert; broad-guard revert) with detection via grep + node probe exiting 1 when sabotaged, and byte-identical restore via `diff`. Method is sound and fail-closed (semantic sabotage, `node --check` still passes — correctly noted as expected). Post-restore state (basic auth + narrowed guard + dry-runs green) matches the current worktree, independently re-verified in §4. QA log (`qa-run.log`) commands reproduce: dry-run outputs and `SYNTAX_OK` confirmed. (Note: `qa-run.log` line 2 shows an unexpanded `$(date -u ...)` in the red-proofs header and a `/tmp/collect_qa.sh` syntax error in section 8 — cosmetic log-harness issues only; the underlying per-file isolation results are all green and were re-verified.)

## 6. Security / scope

- No shell interpolation of untrusted issue text. No token or base64 blob in logs or issue notes (redacted). No permission widening (workflows untouched). Change confined to `scripts/scout.js` (+ `gitAuthEnv`/`redactSecrets` exports, additive). Residual risk correctly disclosed in the implementation report: live end-to-end (ticked box → pushed `scout/*` branch + PR) can only be observed in CI after merge.

## 7. Findings

None. Zero numbered defects — all programmer claims verified against the diff, no stubs, no vacuous passes, fail-closed invariants hold, red-proofs are valid.

---

**VERDICT: PASS**
