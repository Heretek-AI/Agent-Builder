# Stage Report: scout-auth-fix

- **Stage ID:** scout-auth-fix
- **Branch:** `fix/scout-auth` (worktree `/home/john/Projects/Agent-Builder/.lane/trees/scout-auth-fix`, based on `origin/main` 29897bb)
- **Date:** 2026-10-20
- **Production failure:** [Issue #6](https://github.com/Heretek-AI/Agent-Builder/issues/6) ("Scout: multi-harness candidates (2026-10-19)") — ticked `pi-weave` candidate recorded `→ not added: Command failed: git push ... fatal: could not read Username`, and the [scout-accept run](https://github.com/Heretek-AI/Agent-Builder/actions/runs/39429317995) (`ACCEPT_OK: processed 0 accepted candidate(s)`) then permanently skipped the failed line.

## Summary of Deliverables

1. **Push auth fixed to `x-access-token` basic auth** (`scripts/scout.js`): new `gitAuthEnv(token)` helper computes `Buffer.from('x-access-token:' + token, 'utf8').toString('base64')` and sets `GIT_CONFIG_VALUE_0` to `AUTHORIZATION: basic <base64>` — the same scheme `actions/checkout` itself uses (`AUTHORIZATION: basic ***`). The previous `AUTHORIZATION: bearer <token>` is not valid for git smart-HTTP push and produced `fatal: could not read Username` on the credential-less (`persist-credentials: false`) checkout. The same auth env is now also passed to `git fetch origin <base>` for consistency (public fetch worked unauthenticated, but now matches push behavior).
2. **Failed candidates retry cleanly** (`scripts/scout.js`, `cmdAccept` loop):
   - Skip guard narrowed from `/ → /` to `/ → #\d+/`: only a recorded success (`→ #123`) skips; `→ not added: ...` and `→ (...)` no longer permanently block a re-ticked box.
   - Prior failure suffix stripped before processing (`line.replace(/ → .*?(?= <!-- scout:)/, '')`), and the final body rewrite appends the new note to the stripped line, so arrows can never duplicate (`... → not added: old → not added: new ...` is impossible).
3. **Token redaction extended**: new `redactSecrets(text, token)` redacts both the raw token and its base64 form in push-failure notes written back to the issue body (the base64 blob would otherwise leak the token). Error paths still never log the token.
4. **No workflow changes** (no permission widening): `.github/workflows/issues.yml` and `scout.yml` untouched; fix is confined to `scripts/scout.js`.

## Files Created / Modified

- **Modified:** `scripts/scout.js` (+34/−11)
  - Added `gitAuthEnv(token)` and `redactSecrets(text, token)` helpers; both exported (additive: `gitAuthEnv`, `redactSecrets` appended to `module.exports`).
  - `cmdAccept`: narrowed skip regex, `cleanLine` stripping, auth env on `fetch` + `push`, redaction via `redactSecrets`, dedup-safe body replacement.
- **Created:** `docs/reports/scout-auth-fix-implementation.md` (this report).
- No new dependencies (`js-yaml` + catalog util only, unchanged). No workflow/permission changes.

## Test Results

- `node scripts/scout.js accept --issue 6 --dry-run` → `ACCEPT_OK (dry-run): would accept scout issue #6 — plan: fetch issue, parse scout-data, open up to 10 PR(s) on scout/<slug> branches`, exit 0.
- `node scripts/scout.js run --dry-run` → `SCOUT_DRY_RUN_OK candidates=11 declined=1`, exit 0.
- `node --check scripts/scout.js` → `SYNTAX_OK`.
- Targeted behavior probe (`node -e` against the module exports):
  - `gitAuthEnv('tok123').GIT_CONFIG_VALUE_0 === 'AUTHORIZATION: basic ' + base64('x-access-token:tok123')` → true; no `bearer` present → true.
  - `redactSecrets` removes both raw token and base64 blob → true.
  - Success line (`→ #12`) matches skip regex → true; failure line (`→ not added: ...`) and parenthesized line (`→ (PR creation failed; branch pushed)`) do not → retry allowed.
  - Strip + re-append yields exactly one `→` before `<!-- scout:c30 -->` → true (no arrow duplication).
- `npm test` → **131 pass / 0 fail, exit 0** (two consecutive green runs). Note: one earlier full-suite run showed a single flaky failure in `scripts/build-site.js (_site/) → produces index.html...` (a timing/state-sensitive site test with no dependency on `scout.js`); it passed on immediate re-run with no code change, and each test file passes in isolation (all 6 files green individually). No scout-related test exists in the suite; invariants verified via the probe above.

## Self-Audit Notes

- **Fail-closed invariants preserved:** `GITHUB_TOKEN` / `GITHUB_REPOSITORY` still required (fail-closed `fail()` when missing); sender permission check (`admin`/`maintain`/`write`, fail-closed ignore on lookup error) unchanged; `wx` exclusive file creation + `EEXIST` refusal unchanged; rollback (`git checkout -- <file>` + `unlinkSync`, `ENOENT`-tolerant) unchanged; all `gitExec` calls remain argv-array only (issue text never interpolated into shell); commit identity flags unchanged.
- **Secret hygiene:** token never appears in logs; `AUTHORIZATION` header is passed via `GIT_CONFIG_*` env only. Base64 form is itself a credential and is now redacted alongside the raw token in the issue-body note.
- **Scope discipline:** single-file change; workflows, permissions, taxonomy, and catalog data untouched. Left uncommitted in the worktree per instructions (no `git push` performed); `git status` shows only `M scripts/scout.js` (+ this new report file, untracked at write time).
- **Residual risk / follow-up (not in scope):** live end-to-end verification (ticking a box on issue #6 and observing a pushed `scout/*` branch + PR) can only happen in CI after merge; the dry-run + unit-level probes above are the strongest offline evidence available. The flaky `build-site` test in the full suite is pre-existing and unrelated — worth a separate stability pass.
