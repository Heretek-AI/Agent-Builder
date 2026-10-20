# PR Batch-3 Fix Report — 2 UNTRUSTED Review Findings (verified + fixed)

Date (UTC): 2026-10-20
Worktree: /tmp/opencode/agent-builder-v2, branch feat/agent-builder-v2 (PR #8)
Scope: Verify 2 UNTRUSTED review findings against code, apply minimal fix, skip invalid with reason. No commit/push.

## Verdict: 2 fixed, 0 skipped

### Finding 1 — FIXED: src/core/importer.js L533 Gemini includeTools empty array fail-open
- Claim: `if (Array.isArray(srv.includeTools) && srv.includeTools.length > 0)` treats `includeTools: []` as absent and falls back to wildcard `['*']` instead of deny-only `[]`.
- Verified VALID against code (read src/core/importer.js L502-542): default `tools = ['*']`; Pi hidden path correctly fail-closes to `[]`, but Gemini path required `.length > 0`, so `[]` never overrode the wildcard — fail-open (CWE-284), inconsistent with hidden-server handling at L522-531.
- Fix (minimal, 1 line): removed length requirement, kept String mapping:
  `if (Array.isArray(srv.includeTools)) { tools = srv.includeTools.map(String); }`
  Empty stays `[]` (deny-only), non-array (undefined/string) still falls through to prior default, `excludeTools` denied-list handling unchanged.
- Behavioral check (node): `[]` → `[]`; `['a',123]` → `["a","123"]`; absent → `["*"]`; string → `["*"]`; `[]+excludeTools:['x']` → tools `[]` denied `["x"]`. All as expected.

### Finding 2 — FIXED: site/app.js downloadCurrentFile multi-file previews download invalid combined text
- Claim: `downloadCurrentFile` downloads combined `tabText` for multi-file previews, producing an invalid single file.
- Verified VALID against code (read site/app.js L758-796 tabText, L837-840 downloadCurrentFile, src/core/compiler.js L905-924 bundleFiles): `pi` preview concatenates settings JSON + mcp JSON + AGENTS.md but downloads it as `.pi/settings.<slug>.json` (invalid JSON); same class of bug for `gemini` (settings+GEMINI.md), `cursor` (mdc+mcp json), `windsurf` (rules+mcp json), `copilot` (md+mcp json). Confirmed combined markers (`// --- .pi/settings.json ---`) in tabText.
- Fix (minimal, display untouched): added `SINGLE_DOWNLOAD_BY_TAB` mapping the 5 tabs to their primary slug-qualified `bundleFiles` paths (verified to exist in compiler output for slug `demo`: `.pi/settings.demo.json`, `.gemini/settings.demo.json`, `.cursor/rules/demo.mdc`, `.windsurfrules.demo`, `.github/copilot-instructions.demo.md`). `downloadCurrentFile` now looks up the matching `bundleFiles` entry and downloads its `path`+`content`; falls back (fail-closed, no crash) to legacy `TAB_FILES`+`tabText` if the entry is missing. `tabText` combined display unchanged (copy/preview unaffected).
- Scope note: applied exactly to Pi, Gemini, Cursor, Windsurf, Copilot as instructed; `claude` tab (also combined) and `install`/`v2`/`v1`/`opencodeMd`/`codex` left untouched per instruction.

## Files changed (2, +22/-1)
- src/core/importer.js (1 line)
- site/app.js (+21: SINGLE_DOWNLOAD_BY_TAB map + bundle lookup in downloadCurrentFile)

## Tests
- `node scripts/run-tests.js`: 159 tests / 49 suites — pass 159, fail 0 (baseline before fix also 159/0).
- `npm run validate`: VALIDATED 66 ENTRIES OK.
- Ad-hoc node checks above: importer 5 cases + app.js bundle-path existence 5/5 — all pass.
- Did NOT commit/push per instructions; `git diff --stat` shows only the 2 files above.

## Self-audit
- No stubs/shortcuts; both fixes are exact logic with fail-closed fallbacks.
- No `TODO`, dummy passes, swallowed errors, or empty mocks.
- No unrelated refactors; `tabText`, `TAB_FILES`, `downloadBundle`, compiler output shapes unchanged.
