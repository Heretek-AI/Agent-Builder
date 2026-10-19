# PR3 merge-gate fixes (CodeQL file-system-race + Sonar S8705/S4036) — Implementation Report

- **Stage ID:** pr3-merge-gates (follow-up to `sonar-pr3-security-gate`, PR #3 HEAD `943ed06`)
- **Scope:** 2 failing analyses blocking merge of `feat/agent-builder-foundation`
- **Worktree:** `/tmp/opencode/pr3-fix` (branch `feat/agent-builder-foundation`, HEAD `943ed06` + working-tree edits below)

## Summary of deliverables

1. **CodeQL `js/file-system-race` (1 annotation, `src/server/local-server.js:786`) — FIXED.**
   Eliminated the `fs.stat(dest, cb)` gate followed by `fs.readFileSync(dest)` /
   `fs.createReadStream(dest).pipe(res)` check-then-use sequence in `serveStatic`.
   Both branches now perform a single-syscall read of `dest` directly:
   - `/index.html` bootToken branch: async `fs.readFile(dest, 'utf8', …)` inside the
     callback; `ENOENT`/`ENOTDIR`/`EISDIR` map to the same 404 (`'not found: ' + pathname`)
     the stat-failure path returned, all other read errors keep the 500
     (`'unable to read index.html'`). `injectAbToken` behavior identical.
   - Generic static branch: `fs.readFile(dest, (err, data) => …)`; any read error →
     same 404, success → same Content-Type + `res.end(data)`. HEAD handling preserved
     (headers-only, no body).
   - Traversal guards (`..`, absolute, resolve-containment) untouched. The
     `dist/registry.json` fallback (`existsSync` + stream on a fixed constructed path,
     not request-tainted) intentionally untouched — not the flagged taint sink.
2. **SonarQube `new_security_rating` (`jssecurity:S8705` MAJOR + `javascript:S4036` MINOR ×2) — FIXED (code side; re-verification happens on push).**
   - (a) S8705: kept `assertSafeGitRef(base)` and added intra-procedural inline guards
     immediately before EACH `execFileSync` sink in `getChangedFiles`, on the exact operand
     passed. Sink 1 (`range`) pins structure (`range === base + '...HEAD'`, since the `...`
     separator is structural and would trip a naive `..` check) plus the full ref predicate
     on `base` (regex + no-leading-`-` + no-`..` + no-whitespace + length). Sink 2 (`base`)
     carries the same predicate directly. Both fail closed (`console.error` + `process.exit(1)`).
     Argv arrays kept. Each sink line carries a `// NOSONAR jssecurity:S8705 javascript:S4036`
     justification (analyzer backstop — the engine demonstrably cannot see the custom
     validator: old lines CLOSED, shifted identical lines OPEN).
   - (b) S4036: inherited PATH is now dropped first
     (`const { PATH: _inheritedPath, ...cleanEnv } = process.env;`) and the shared `gitOpts`
     is `env: { ...cleanEnv, PATH: SAFE_GIT_PATH }`, so the only PATH reaching git is the
     literal `/usr/local/bin:/usr/bin:/bin`.
3. **Tests extended (argv arrays / fixed literals only, no shell interpolation).**
   - `test/local-server.test.js`: missing file → 404, encoded traversal → 403, HEAD `/` →
     200 headers-only empty body, HEAD missing → 404. (Index.html token-injection coverage
     pre-existed and still passes.)
   - `test/catalog-negative.test.js`: source-text assertions pinning the inline guards,
     dropped-PATH env, and NOSONAR justifications (fail RED if removed), plus a functional
     `git --version`-under-restricted-PATH test. Evil-base matrix pre-existed and still passes.

## Files created/modified

- Modified: `src/server/local-server.js` (`serveStatic` single-syscall reads)
- Modified: `scripts/check-pr.js` (inline ref guards, dropped-PATH env, NOSONAR backstops)
- Modified: `test/local-server.test.js` (+4 static-serving tests, traversal test hardened)
- Modified: `test/catalog-negative.test.js` (+2 guard/PATH tests)
- No other files touched. No secrets committed.

## Test results

- `npm run validate` → `VALIDATED 63 ENTRIES OK`, exit 0.
- `node scripts/ai-review.js run` → `REVIEW_OK entries=63 categories=56 mcp_tools=25`, exit 0.
- `node scripts/ai-review.js collect` → `COLLECT_OK files=23`, exit 0.
- `node scripts/ai-review.js selftest` → `SELFTEST_OK`, 124 pass / 0 fail, exit 0.
- `npm test` → 124 pass / 0 fail, exit 0.
- `node scripts/check-pr.js --base origin/main` → exit 0 (`23 changed entries valid` + full-catalog + canary OK).
- Evil bases (`--output=/tmp/evil`, `--upload-pack=id`, `-evilref`, `..`, `a..b`, `a b`,
  `--base=--output=/tmp/evil`) → all exit 1; no `/tmp/evil` file created.
- `git status --short` shows only the 4 intended files.

## Self-audit notes

- Verified each finding against current code before fixing; CodeQL alerts #4–#7 on
  `refs/heads/main` confirmed pre-existing/out of scope — not touched.
- Finding 1 (CodeQL): fixed by removing the check-then-use sequence, not by suppression.
  Behavior preserved: identical status codes/messages for 404/500/HEAD/injection paths
  (verified by new + pre-existing tests, including the `GET /` ab-token meta test).
- Finding 2 (Sonar): real guard (inline intra-procedural checks) + suppression (NOSONAR
  backstop) both applied, as required — neither alone clears the gate per prior evidence.
  No untrusted text reaches any shell: argv arrays everywhere, in code and tests.
- Test-authoring catch: first traversal-403 draft used `/%2e%2e/…`, which WHATWG URL
  dot-segment normalization collapses to `/package.json` (404) before the guard runs.
  Switched to `/..%2f…` (verified to survive parsing and reach the `..` guard → 403).
- Selftest flake (pre-existing, out of scope, NOT fixed per minimal-change rule): one run
  failed `catalog.test.js` `_site/registry.json` existence because `stage4.test.js` rebuilds
  `_site/` via `build-site.js` (`rmSync` + rewrite) in a parallel test file — a race window
  unrelated to this diff. Immediate rerun → `SELFTEST_OK` 124/124. Recommend a follow-up
  (serialize the rebuild or point it at a temp dir), but deliberately left untouched here.
- Sonar/CodeQL re-verify on push — no local tokens for either CLI in this environment;
  server-side confirmation pending CI.
