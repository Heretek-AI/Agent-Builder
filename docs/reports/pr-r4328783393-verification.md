# Verification Report — pr-r4328783393-fix (CWE-284 Hidden Pi Wildcard Allow)

- **Stage ID:** pr-r4328783393-fix
- **Fix report audited:** `docs/reports/pr-r4328783393-fix.md`
- **QA evidence audited:** `docs/evidence/v2/qa-r4328783393.log` (+ `/tmp/redproof-fail.log`, `/tmp/restore-pass.log`, `/tmp/importer-r4328783393.bak`)
- **Fix location:** `src/core/importer.js:527-531` (+ `test/compiler.test.js` regression test)
- **Date (UTC):** 2026-10-20
- **Auditor:** Independent Drift Guard (no code changes made; write restricted to this report)

## 1. Spec & architecture audit (RULE 3)

Finding (from fix report + code): Pi hidden servers imported as wildcard allows. Compiler deny-only shape (`src/core/compiler.js:411-427`, confirmed via grep `buildPiOutputs` at line 368, `entry.exposure` at 412, `toolExposure` at 413-426: `exposure='hidden'` with `toolExposure` omitted when empty) round-tripped through `recipesFromMcpServers` as `tools:['*']` because the hidden guard sat inside `if (isPlainObject(srv.toolExposure))`.

Fix claims:
1. Added `else if (srv.exposure === 'hidden') { tools = []; }` at `importer.js:527-531`.
2. Regression test `imports hidden Pi servers as explicit deny-only (CWE-284, r4328783393)` covering 5 sub-cases.
3. `159 pass / 0 fail`, `VALIDATED 66 ENTRIES OK`.

Code check (direct read of `src/core/importer.js:502-555`):
- Lines 512-526: pre-existing branch — `toolExposure` map present + `exposure==='hidden'` → `tools = allowedList` (empty allowed → deny-only). Untouched. Correct.
- Lines 527-531 (NEW): `else if (srv.exposure === 'hidden')` → `tools = []` with CWE-284 fail-closed comment. Verified present, exact text matches fix report.
- Lines 533-540: Gemini `includeTools`/`excludeTools` ordering unchanged — explicit `includeTools` still overrides after the hidden branch. Confirmed: probe D `exposure:hidden + includeTools:['z']` → `tools:['z']`, matching pre-existing precedence, no regression.
- `git diff --stat`: `src/core/importer.js 4 ++++, test/compiler.test.js 53 +++` — minimal, matches fix report claim. `git diff src/core/importer.js` shows ONLY the 4-line else-if addition. No other behavior changed.
- Deny-list semantics preserved: `'*'` key excluded from both lists (`tk !== '*'` at lines 517-518); non-`*` hidden entries pushed to `denied` — regression test asserts `hidden+{q:hidden}` → `deniedTools:['q']`, mixed case → `deniedTools:['drop-table']`.

`test/compiler.test.js:522-573` (direct read): regression test asserts exactly the 5 cases claimed in the fix report (hidden-missing → `[]`; hidden-only-hidden → `[]`+`['q']`; hidden mixed + wildcard-key exclusion → `['query']`; non-hidden → `['*']`; compile→Pi→re-import round-trip stays `[]` with `!('toolExposure' in piServer)` assertion). Line-by-line match to fix report section. Test uses `assert.deepEqual` on full `mcpSelections` objects — non-vacuous (exact-shape assertions, would fail on `['*']`).

## 2. Stub / shortcut scan (RULE 2)

- `grep -rnE 'cmd.*true|echo "pass"|exit 0|\|\| *true|set \+e|catch *\(e?\) *\{\s*\}' src/core/importer.js test/compiler.test.js` → **NO_STUBS**.
- Vacuous-assert scan (`1 === 1`, `true.*true`) → **NO_VACUOUS**. All new assertions are strict `deepEqual`/`strictEqual` on security-relevant values.
- No `|| true`, `set +e`, empty catch, `process.exit(0)` masking, or existence-only checks in fix or test.
- No premature pass: all 5 sub-cases required by the finding are covered, including the exact compiler-produced shape.

## 3. Independent sample verification (RULE 4)

`node scripts/run-tests.js` re-run by auditor on clean tree: **159 tests / 49 suites / 159 pass / 0 fail** (tail confirms, EXIT:0). Matches fix-report and QA-log claims exactly.

`npm run validate` re-run: **VALIDATED 66 ENTRIES OK**. Matches claims.

Independent fail-closed probes (auditor-executed, `parseUploadedConfig` + `compileAgentRecipe`):
- A `hidden + no toolExposure` → `tools:[]` ✅ (was `['*']` pre-fix; fail-closed confirmed)
- B `hidden + {q:hidden}` → `tools:[], deniedTools:['q']` ✅
- C `no exposure` → `tools:['*']` ✅ (wildcard default preserved for non-hidden)
- D `hidden + includeTools:['z']` → `tools:['z']` ✅ (explicit-override precedence unchanged)
- E compile `tools:[], denied:[]` → Pi `{exposure:'hidden', no toolExposure}` (`hasToolExposure:false` confirmed) → re-import `tools:[]` ✅ (round-trip escalation closed)

Two key assertions independently verified fail-closed: (1) hidden-missing yields `[]` not `['*']`; (2) compiler deny-only round-trip stays `[]`. Both confirmed by direct execution, not by trusting logs.

## 4. Red-proof audit

QA log `docs/evidence/v2/qa-r4328783393.log` documents the 7-step protocol: sabotage `tools = [];` → `tools = ['*'];`, run check → EXIT 1 with the new test failing (`AssertionError`, `+ ['*'] / - []`), restore via `cp` backup (not git checkout), diff-clean + 159/0 on restore, `git status` clean.

Auditor verification of artifacts:
- `/tmp/redproof-fail.log` exists: contains `pass 158 / fail 1` + `AssertionError ... deep-equal` ✅ — proves the check detects the restored bug (non-vacuous, fail-closed assertion).
- `/tmp/restore-pass.log` exists: contains `pass 159 / fail 0` ✅ — proves clean restoration.
- `/tmp/importer-r4328783393.bak` exists ✅.
- `diff backup vs current` was clean per QA log step 5; current `git status` shows only `M importer.js, M compiler.test.js, ?? fix/QA reports` — no sabotage residue. Sabotage was a single-line semantic inversion (not deletion of the test), so it proves the test — not just the harness — is fail-closed.

Red-proof verdict: **VALID** (fail under sabotage, pass on restore, artifacts present, protocol followed).

## 5. Minimality & no-regression

- 4-line importer diff + 53-line focused test; no wildcard-default change for non-hidden; no `includeTools`/`excludeTools` reordering; `'*'`-key exclusion unchanged. Independent probes C and D confirm no regression.
- No commit/push performed (working tree holds uncommitted fix) — consistent with instructions; auditor likewise performed no commits and changed no code.

## Findings

None. All fix-report claims verified against code and by independent execution. Zero stubs, zero vacuous assertions, 159/159 tests pass, red-proof valid, fail-closed confirmed on 2+ independent probes plus round-trip.

VERDICT: PASS
