# Verification Report — PR r4328794775 Fix (Copilot/Cursor/Windsurf MCP Tool Scoping)

- **Stage ID:** pr-r4328794775-fix
- **Auditor:** Independent Adversarial Drift Guard (subagent, read-only; NO code changed)
- **Date (UTC):** 2026-10-20
- **Worktree / branch:** `/tmp/opencode/agent-builder-v2`, `feat/agent-builder-v2` (HEAD `cb0f843` at audit time)
- **Inputs audited:**
  - `docs/reports/pr-r4328794775-fix.md` (fix report + verification table)
  - `docs/evidence/v2/qa-r4328794775.log` (QA log with 7-step red-proof)
  - `src/core/compiler.js` lines 505–632 (`scopedMcpNote`, `copilotToolsFor`, `buildAdditionalClients` §2–§4)
  - `test/stage4.test.js` lines ~347–355 (existing Copilot coverage)
- **Write scope obeyed:** this report only (`docs/reports/pr-r4328794775-verification.md`). No source, test, config, or evidence file modified.

## 1. Spec & architecture cross-check (RULE 3)

Fix report claims vs. code at HEAD — all confirmed:

| Claim | Code location | Auditor result |
|---|---|---|
| `copilotToolsFor(sel, reg)` fail-closed allowlist | `compiler.js:538–571` | CONFIRMED. Deny-all `'*'` → `[]` (541–543); wildcard + no deny → `['*']` (553–555); wildcard + deny + known `reg.mcp.tools` → subtracted list (557–560); wildcard + deny + unknown universe → `[]` (562); explicit allows minus denies, `'*'` entries dropped (564–570) |
| `vscodeMcpServers` separate map, not aliasing `cursorMcpServers` | `compiler.js:606–613` | CONFIRMED. Fresh `{}` + `serverTransport` clone + `entry.tools = copilotToolsFor(...)`. Cursor map untouched |
| Cursor/Windsurf transport-only, no fabricated `tools` key | `compiler.js:574–595` | CONFIRMED. Both built from `serverTransport(...)` only; `windsurfMcpJson` shares cursor transport shape; no `tools` assignment on either path |
| `scopedMcpNote(selections, enforcedHint)` backward-compatible, two headers | `compiler.js:512–530` | CONFIRMED. Empty selections → `''`; `enforcedHint` truthy → Copilot `also enforced in .vscode/mcp.json` header (526), else `host-enforced; mcp.json cannot restrict tools` (527). Call sites: Cursor (591), Windsurf (602) without hint; Copilot (620) with `true` |
| Stale comment updated (Copilot does support `tools`) | `compiler.js:505–511` | CONFIRMED |
| Diff size `68 ++++--- (61+/7-)` | `git diff --stat` | CONFIRMED exact match |

## 2. Independent sample verification (RULE 4)

### 2a. Automated gates (re-run by auditor, read-only)

- `node scripts/run-tests.js` → `tests 159, suites 49, pass 159, fail 0` (exit 0). Matches fix report and QA log. **PASS**
- `npm run validate` → `VALIDATED 66 ENTRIES OK` (exit 0). **PASS**

### 2b. Fail-closed matrix (auditor re-probe via `compileAgentRecipe`, correct registry shape `{id, mcp:{tools}}`)

All 7 fix-report rows reproduced (registry `['query','list-tables','drop-table']`; unknown-universe case uses `[]` registry):

| Selection | `vscodeMcpJson.servers[…].tools` | Cursor/Windsurf `tools` key | Notes |
|---|---|---|---|
| explicit `['query','list-tables']` deny `['drop-table']` | `["query","list-tables"]` PASS | absent PASS | headers correct |
| wildcard, no denies | `["*"]` PASS | absent PASS | — |
| wildcard + deny `['drop-table']` (known reg) | `["query","list-tables"]` PASS | absent PASS | — |
| wildcard + deny `['evil']` (unknown universe) | `[]` PASS (fail-closed) | absent PASS | never `['*']` over deny |
| deny-only `tools: []` | `[]` PASS | absent PASS | — |
| `deniedTools: ['*']` | `[]` PASS | absent PASS | — |
| explicit `['query','drop-table']` deny `['drop-table']` | `["query"]` PASS (deny wins) | absent PASS | — |

One auditor probe initially returned `[]` for the wildcard+deny-known row because the probe used the wrong registry shape (`{slug}` instead of `{id}`); with the correct `{id:'postgres-prod', mcp:{tools}}` shape the result matches the report. This confirms `findRegistryMcp` (259–270) resolves by `mcp.server_name/serverName → server → id → name`, and unknown-universe fail-closed is reached exactly when lookup returns `null` — by design.

### 2c. CLI harness probes (independent of QA's key names)

- `--harness copilot`: `vscodeMcp.servers['postgres-prod'].tools = ["execute_query","list_tables"]`, enforced-allowlist header present. **PASS**
- `--harness cursor`: server = `{command, args, env}` only, NO `tools` key; `cannot-restrict` note present. **PASS**
- `--harness windsurf`: same transport-only shape, NO `tools` key; `cannot-restrict` note present. **PASS**
- Minor drift (non-blocking): QA log cites keys `vscodeMcpJson`/`cursorMcpJson`/`windsurfMcpJson` (the `compileAgentRecipe` return names), while CLI harness output uses `vscodeMcp`/`mcp`+`ruleMdc`/`mcp`+`windsurfRules`. Substance identical; naming follows the harness envelope, not an error.

### 2d. Anti-stub scan (RULE 2)

- `grep` for `cmd.*true`, `echo "pass"`, `exit 0` shortcuts, `|| true`, `set +e`, empty `catch(){}` in `src/core/compiler.js` → **CLEAN, no stub shortcuts**.
- No vacuous assertions introduced by the fix: `copilotToolsFor` branches all return concrete values asserted by the probes above; no `assert(1===1)`-style checks.
- Normalization note (informational, NOT a finding): `normalizeMcpId` is separator-level only (no case-folding), consistent with `collectKnownServers`/`findRegistryMcp`. MCP tool names are case-sensitive, so deny `QUERY` does not suppress allow `query` — exact-match semantics, matching the fix report's "exact + `normalizeMcpId` comparison" claim. No fail-open: the only wildcard path that emits `['*']` requires zero denies.

## 3. QA red-proof validity + coverage gap

- QA sabotage (replace line 610 with omit-`tools`, probe expects `["execute_query","list_tables"]` → got `undefined`, exit 1) is **valid and non-vacuous**: auditor reproduced the logic without touching any file (real probe passes; simulated `tools=undefined` assertion fails), proving the probe is fail-closed.
- Coverage gap acknowledged in QA log and **independently confirmed**: `test/stage4.test.js:347–355` asserts only presence (`assert.ok(out.vscodeMcpJson.servers['postgres-prod'])`), never `tools` content — so `scripts/run-tests.js` stays 159/159 under sabotage. QA documented this rather than hiding it ("STILL PASSES — no existing unit test covers copilotToolsFor; probe is the guard"). Auditor agrees with the characterization and the recommendation to add a `copilotToolsFor` unit test to the stage4/compiler suite (recommendation only — auditor changes no code).
- Restore hygiene per QA log (cp-restore, `grep -c RED-PROOF == 0`, diff-stat back to 68/61+/7-, tests+validate green) is consistent with current worktree state observed by auditor (`M src/core/compiler.js`, diff-stat match, 159/159 + 66 OK re-verified). No sabotage residue found.

## 4. Findings

No blocking findings. Two non-blocking notes:

1. **Coverage gap (known, accepted):** no unit test pins `copilotToolsFor`; the CLI/compile probe is the sole guard. Recommend adding matrix cases (wildcard+deny known/unknown, deny-all, deny-wins) to `test/stage4.test.js` in a follow-up. Not a FAIL — QA disclosed it and the probe is non-vacuous.
2. **Key-name drift in QA log (cosmetic):** `vscodeMcpJson` vs CLI `vscodeMcp`, etc. Substance verified correct under both surfaces. Suggest aligning names in future logs. Not a FAIL.

## 5. Binding verdict

- All fix-report deliverables present in code at the cited lines; diff matches.
- 159/159 tests and 66-entry validate re-verified green by the auditor.
- Copilot `tools` fail-closed on all 7 matrix rows; Cursor/Windsurf carry no `tools` key with the advisory note in the correct rule files; Copilot carries the enforced-allowlist note.
- QA red-proof is valid; the 159/159-under-sabotage coverage gap is real, disclosed, and non-blocking.

`VERDICT: PASS`
