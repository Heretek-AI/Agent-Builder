# PR Batch-3 Verification Report (Independent Drift Guard Audit)

Date (UTC): 2026-10-20
Worktree: /tmp/opencode/agent-builder-v2, branch feat/agent-builder-v2
Auditor: Independent Adversarial Drift Guard (subagent, CHANGE NO CODE)
Under audit: `docs/reports/pr-batch3-fix.md` (2 UNTRUSTED findings, 2 fixed) + `docs/evidence/v2/qa-batch3.log`
Scope: Gemini `[]` stays `[]` fail-closed + download `bundleFiles` 5 tabs minimal, 159 tests, red-proof valid

## 1. Deliverables cross-reference (spec/architecture audit)

### Fix 1 — `src/core/importer.js` L533 Gemini `includeTools` empty-array fail-open
- Claimed: `if (Array.isArray(srv.includeTools) && srv.includeTools.length > 0)` treated `[]` as absent → wildcard `['*']` (CWE-284), inconsistent with Pi hidden fail-closed path L522-531.
- Verified VALID against code. Current file L532-535:
  ```
  // Gemini CLI `includeTools` / `excludeTools` support
  if (Array.isArray(srv.includeTools)) {
    tools = srv.includeTools.map(String);
  }
  ```
- Minimal 1-line diff confirmed via `git diff`: only the `&& srv.includeTools.length > 0` guard removed, `String` mapping kept. `excludeTools` denied-list handling (L536-540) untouched. Pi hidden paths (L522-531) untouched.
- Semantics verified independently (see §3): `[]`→`[]`, absent→`['*']`, string→`['*']`, coercion + denied-list correct.

### Fix 2 — `site/app.js` `downloadCurrentFile` multi-file preview invalid download
- Claimed: `downloadCurrentFile` downloaded combined `tabText` under a single-file name (invalid JSON/md).
- Verified VALID against code. `tabText` (L758-796) still combined for pi/gemini/cursor/windsurf/copilot — display untouched. `TAB_FILES` (L735-747) untouched.
- Fix adds `SINGLE_DOWNLOAD_BY_TAB` (L841-847, exactly 5 tabs) + bundle lookup in `downloadCurrentFile` (L849-861):
  - `pi → '.pi/settings.<slug>.json'`, `gemini → '.gemini/settings.<slug>.json'`, `cursor → '.cursor/rules/<slug>.mdc'`, `windsurf → '.windsurfrules.<slug>'`, `copilot → '.github/copilot-instructions.<slug>.md'`
  - All 5 paths verified to exist in `src/core/compiler.js` `bundleFiles` (L909, L915, L917, L920, L922; full list 18 files L905-924).
  - Fallback is fail-closed: if tab not in map or bundle entry missing → legacy `TAB_FILES`+`tabText` download, no crash, no throw (L860). Loop has explicit `return` on hit; missing entry falls through.
- Scope note honored: `claude` (L770-773 combined), `install`/`v2`/`v1`/`opencodeMd`/`codex` left untouched per instruction. Correct — instruction said exactly Pi/Gemini/Cursor/Windsurf/Copilot.

### Files changed (verified via `git status --short` + `git diff --stat`)
- `M site/app.js` (+21), `M src/core/importer.js` (1 line). Only intended 2 files.
- Untracked: `docs/reports/pr-batch3-fix.md` (report under audit). No other drift.
- Note: `windsurf` TAB_FILES returns `'.windsurfrules'` (no slug) while bundle path is `'.windsurfrules.<slug>'` and SINGLE map uses slugged form — this is intentional: legacy name was ambiguous, fix downloads the correct slug-qualified bundle artifact. Not a defect.

## 2. Anti-stub / shortcut scan (RULE 2)
- Ran: `grep -rn -E 'cmd: *"true"|echo "pass"|exit 0|\|\| *true|set \+e|catch *\(e?\) *\{\}'` on `src/core/importer.js site/app.js scripts/run-tests.js` → zero hits (only `scripts/accept/` missing, N/A — repo has no Makefile/`scripts/accept/`, runner is `node scripts/run-tests.js` + `npm run validate`).
- `grep -rn -E 'TODO|FIXME|DUMMY|STUB|NOT_IMPLEMENTED'` on both fixed files → zero hits.
- Test runner `scripts/run-tests.js` is real: discovers `test/*.test.js`, executes via `execFileSync(process.execPath, ['--test', ...files])` — not a vacuous `exit 0`. Sampled assertions are substantive (`assert.equal`, `assert.deepEqual`, `assert.ok(...includes...)`, `assert.throws`), not `1===1` or process-existence checks.
- Both fixes are exact logic with fail-closed fallbacks; no swallowed errors, no empty mocks, no unrelated refactors. `tabText`, `TAB_FILES`, `downloadBundle`, compiler output shapes unchanged.

## 3. Independent sample verification (RULE 4) — 2 key assertions fail-closed

### 3a. Gemini `[]` stays `[]` (fail-closed, not `['*']`)
Ran independently (correct arg order `parseUploadedConfig(filename, rawContent)`):
- `[]` → `[]` — PASS fail-closed (deny-only, not wildcard)
- absent → `["*"]` — PASS default preserved
- `['a',123]` → `["a","123"]` — PASS String coercion
- string `'foo'` → `["*"]` — PASS non-array falls through to default
- `[]+excludeTools:['x']` → tools `[]`, denied `["x"]` — PASS
In-memory buggy-variant contrast: buggy guard `&& length>0` maps `[]`→`["*"]` (FAIL-OPEN); fixed guard maps `[]`→`[]` (FAIL-CLOSED). Confirms the removed length check is the exact fail-open cause.

### 3b. Download `bundleFiles` 5 tabs minimal
Ran independently via `compileAgentRecipe({slug:'demo',...})`:
- `bundleFiles count=18`
- PASS all 5: `.pi/settings.demo.json`, `.gemini/settings.demo.json`, `.cursor/rules/demo.mdc`, `.windsurfrules.demo`, `.github/copilot-instructions.demo.md` (each found, non-empty content)
- PASS `.pi/settings.demo.json` parses as valid JSON (proves single-artifact download is valid, unlike combined `tabText` with `// ---` markers)
- `grep -c SINGLE_DOWNLOAD site/app.js` = 3 refs (def + guard + call); map has exactly 5 entries, no scope creep into `claude`/`install`/`v2`/`v1`/`opencodeMd`/`codex`.

### 3c. Test suites (independently re-run, not trusting log)
- `node scripts/run-tests.js` → `tests 159 / suites 49 / pass 159 / fail 0`, EXIT 0 (tail confirms `bundleFiles ships 18 slug-qualified files` ✔). Matches claimed 159/0.
- `npm run validate` → `VALIDATED 66 ENTRIES OK`, EXIT 0. Matches claimed 66 OK.
- No `make check` / `scripts/accept/<stage>/` in this repo (no Makefile); the above two are the canonical gates and both were run.

## 4. Red-proof assessment
- `docs/evidence/v2/qa-batch3.log` §Red-proof: sabotage restored buggy `&& length>0` via `cp` backup (not `git checkout`, preserving batch3 fixes — correct method), ran probe `includeTools:[]` → sabotaged `tools=["*"]`, log `RED-PROOF: FAIL as expected`, EXIT 1 → check correctly fails when sabotaged (no vacuous pass). Restore via `cp /tmp/importer.js.bak`, `grep` confirms `if (Array.isArray(srv.includeTools))`, probe `[]`→`[]` RESTORED PASS, re-ran 159/0 + 66 OK. Protocol is sound and evidence is specific (exact guard string, exact probe output, exit codes, restore verification).
- Independent corroboration (§3a in-memory buggy-vs-fixed contrast + live fixed-file probes) confirms the red-proof claim: buggy form fail-opens, fixed form fail-closes. Red-proof VALID.
- `docs/evidence/v2/red-proofs.log` (older 7-step protocol) also shows sabotage→EXIT 1 across compiler/classifier/validate/site — consistent fail-closed culture; not required for batch3 but supports validity.

## 5. Gaps / notes (non-blocking)
- No dedicated regression test in `test/` covers `includeTools: []` (grep `includeTools` in `test/` → no hits; `bundleFiles` covered in `test/compiler.test.js` L302-308 with real content assertions). Batch3 relies on ad-hoc node probes + red-proof. Recommend adding a `test/stage4.test.js` (or importer) case: `[]`→`[]`, absent→`['*']`. Not a FAIL — behavior independently verified and 159/0 green.
- `_site/` copies (`_site/app.js`, `_site/core/*`) are build output and not in scope; canonical `site/` + `src/` verified.

## 6. Binding verdict
Both claimed findings verified VALID against code, both fixes minimal and correct, fail-closed semantics confirmed by independent probes, 159/0 + 66 OK re-run green, anti-stub scan clean, red-proof valid (sabotage fails, restore passes), diff scope exactly 2 files. No code changed by auditor; this report is the only write.

VERDICT: PASS
