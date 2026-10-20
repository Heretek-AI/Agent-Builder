# PR #8 — Copilot Tools Content Regression Tests

- **Date (UTC):** 2026-10-20
- **Worktree:** `/tmp/opencode/agent-builder-v2` (branch `feat/agent-builder-v2`, PR #8)
- **Gap:** No unit test asserted Copilot `tools` content in `test/stage4.test.js` — the existing Copilot presence test (~L347-355) only checked `vscodeMcpJson.servers['postgres-prod']` exists and slug strings appear. A sabotage that broke `copilotToolsFor` deny handling still passed 159/159.
- **Scope:** Test-only, minimal, fail-closed. No `src/` changes.

## Change

- **File modified:** `test/stage4.test.js` — appended describe block `copilot tools allowlist content (fail-closed copilotToolsFor)` (7 tests) after the v2-overhaul export suite.
- **Helper:** `toolsFor(server, selections, registry)` compiles via `compileAgentRecipe` and asserts `vscodeMcpJson.servers[server].tools` is an array (fail-closed shape check) before returning it.
- **Registry fixture:** `known-srv` with `mcp.tools: ['read','write','admin']`; unknown-universe case uses `[]` registry with `ghost-srv`.

### Cases (exact `assert.deepEqual`, not presence checks)

| # | Selection | Registry | Expected `tools` | Covers |
|---|-----------|----------|------------------|--------|
| 1 | `tools: ['read','write']` | known | `['read','write']` | explicit preserved |
| 2 | `tools: ['read','write'], deniedTools: ['write']` | known | `['read']` | deny wins |
| 3 | `tools: ['*']` | known | `['*']` | wildcard passthrough |
| 4 | `tools: ['*'], deniedTools: ['write']` | known | `['read','admin']` | wildcard minus known universe |
| 5 | `tools: ['*'], deniedTools: ['write']` | `[]` (ghost-srv) | `[]` | wildcard+deny unknown → never `['*']` |
| 6 | `tools: []` | known | `[]` | deny-only |
| 7 | `tools: ['*'], deniedTools: ['*']` | known | `[]` | deny-all wins |

This mirrors `copilotToolsFor` branches in `src/core/compiler.js` (L538-571): `hasDenyAll → []`, wildcard+no-deny → `['*']`, wildcard+deny → registry-universe-minus-denies else `[]`, explicit-minus-denies.

## Verification

- `node scripts/run-tests.js`:
  - `tests 166, suites 50, pass 166, fail 0` (was 159/159; +7 new tests).
  - New suite output: `copilot tools allowlist content (fail-closed copilotToolsFor)` — 7/7 ✔.
- `npm run validate`: `VALIDATED 66 ENTRIES OK`.
- No commit/push performed (per instructions); `git status` shows only `test/stage4.test.js` modified.

## Self-audit

- Fail-closed: every test asserts exact array content via `deepEqual` and asserts `tools` is an array; empty/deny cases assert `[]`, never truthiness.
- Minimal: test-only diff, no production logic touched, no stubs/mocks of `copilotToolsFor` itself (exercises real `compileAgentRecipe → vscodeMcpJson` path).
- Sabotage coverage: any omission of deny subtraction, wildcard+unknown passthrough of `['*']`, or deny-all bypass now fails at least one exact-equality assertion.
