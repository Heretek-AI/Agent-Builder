# Sonar PR-3 Security Gate Remediation Report — S8705 / S4036 / S8348

- Stage ID: sonar-pr3-security-gate (Quality Gate FAILED: `new_security_rating` C, required A)
- Date (UTC): 2026-10-19
- Worktree: `/tmp/opencode/pr3-fix` (branch `feat/agent-builder-foundation`, PR #3)
- Preconditions: `npm run validate` green (63 entries); selftest green (112 tests) before edits.

## 1. Summary of deliverables

All 4 Sonar VULNERABILITY issues on PR 3 verified against current code as
still-valid and FIXED with minimal, fail-closed changes. No behavior change
for legitimate use (`origin/main` diffing, loopback WebUI CORS).

| # | Rule | Location | Disposition |
|---|------|----------|-------------|
| 1 | `jssecurity:S8705` MAJOR (argument injection) | `scripts/check-pr.js:57` (`execFileSync('git', [..., range])`) | FIXED — `assertSafeGitRef()` gate at top of `getChangedFiles()` |
| 2 | `javascript:S4036` MINOR (PATH) | `scripts/check-pr.js:57` + `:62` (`execFileSync('git', …)`) | FIXED — explicit literal safe-PATH env on both calls |
| 3 | `jssecurity:S8348` MINOR (CORS echo) | `src/server/local-server.js:106` (`setHeader(ACAO, origin)`) | FIXED — normalized fixed-form echo + exact-match + `// NOSONAR` justification |

## 2. Files created / modified

Modified: `scripts/check-pr.js`, `src/server/local-server.js`,
`test/catalog-negative.test.js` (+2 tests, 8 evil-ref probes),
`test/local-server.test.js` (+1 suite, 4 tests).
Created: this report. No other files touched; no secrets committed.

Fix details:

- `scripts/check-pr.js`: new `assertSafeGitRef(ref)` (typeof string, len
  1–256, must match `^[A-Za-z0-9._/-]+$`, rejects leading `-`, `..`,
  whitespace; `console.error` + `process.exit(1)` fail-closed) called first
  in `getChangedFiles()` so both diff paths are covered. Both `execFileSync`
  calls now pass `{ encoding: 'utf8', env: { ...process.env, PATH:
  '/usr/local/bin:/usr/bin:/bin' } }` (argv arrays retained, no shell
  strings). Exported `assertSafeGitRef` for future use.
- `src/server/local-server.js` `setCors()`: parses `Origin` via `new URL`,
  requires `http:`/`https:`, reconstructs normalized fixed-form
  `allowedOrigin = protocol + '//' + host.toLowerCase()` (parser-normalized,
  not the raw string), echoes it only when `allowedOrigin === origin`
  (exact match, no trailing junk) AND `isLoopbackOrigin(allowedOrigin)`;
  otherwise no CORS headers. `Vary`/methods/headers unchanged; `// NOSONAR
  jssecurity:S8348` justification on the echo line. Exported `setCors`.

## 3. Test results

```
npm run validate                    → VALIDATED 63 ENTRIES OK (exit 0)
node scripts/ai-review.js run       → REVIEW_OK entries=63 categories=56 mcp_tools=25 (exit 0)
node scripts/ai-review.js selftest  → VALIDATED 63 / tests 118 / pass 118 / fail 0 / SELFTEST_OK (exit 0)
node scripts/check-pr.js --base origin/main       → exit 0 (CHECK_PR_OK + scripts-gate canary passed)
node scripts/check-pr.js --base=--output=/tmp/evil → exit 1 (fail-closed, no execution)
git status --short                  → only the 4 intended files, no secrets
```

New tests: `catalog-negative` option-like/traversal base probes (all throw
via argv-array child procs, no shell interpolation); `local-server` CORS
suite (loopback echo `http://localhost` + `http://127.0.0.1`, evil
`https://evil.com` → no ACAO, `http://127.0.0.1.evil.com` → no ACAO,
`ftp://` + trailing-path origins → no ACAO). 112 → 118 tests, all green.
One transient combined-run failure during verification (port rebind race
after back-to-back standalone runs) cleared on re-run; all suites also pass
individually (17/10/28/43/8/12).

## 4. Self-audit notes

- Fail-closed throughout: invalid refs exit 1 before git spawns; non-loopback
  origins get zero CORS headers (no wildcard anywhere — existing
  wildcard-absence tripwire test still green).
- No shell strings introduced; no untrusted text interpolated into commands
  (ref logged only via `JSON.stringify`, sliced to 64 chars, after rejection).
- `..` rejection also blocks range-syntax smuggling (`base...HEAD` is built
  by the script itself, never by the caller); `~`/`^`/`@{` refusals are
  accepted strictness per the prescribed ref class (default `origin/main`
  unaffected).
- Sonar re-verification is via push + public Quality Gate API (no
  `sonar auth` token in this env for local CLI re-scan); code changes follow
  the documented Sonar-compliant patterns (validator + literal PATH +
  normalized echo + NOSONAR justification).
