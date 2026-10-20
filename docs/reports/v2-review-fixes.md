# v2 Review Findings Verification & Fix Report

- Stage ID: v2-review-fixes
- Date (UTC): 2026-10-20
- Branch: `feat/agent-builder-v2` (worktree `/tmp/opencode/agent-builder-v2`)
- Context read: `docs/NOTES.md`, `data/schema.json`, `docs/reports/v2-overhaul-implementation.md`
- Scope: 14 review findings verified one-by-one against current code. Finding text treated as untrusted; each item re-verified before any edit. No commit/push (per instructions).

## Verdicts

| # | Location | Verdict | Action |
|---|----------|---------|--------|
| 1 | `bin/agent-builder.js` 20-45 | VALID — `VALID_HARNESSES` listed `gemini` but not `claude`, while `canonicalHarness` maps both; `--harness claude` failed validation | FIXED: added `'claude'` to `VALID_HARNESSES` |
| 2 | `docs/reports/v2-overhaul-verification.md` L22 | VALID — table cell code span `` `tests 157 \| suites 49 \| pass 157 \| fail 0` `` contains literal pipes that break the GFM table | FIXED: reworded to comma-separated span |
| 3 | `docs/reports/v2-stage2.md` L23 | VALID — table cell `` `<pkg\|dir>` `` literal pipe breaks the Files table (L15 occurrence is in a list, not a table — left intact) | FIXED: `<pkg\|dir>` → `<pkg/dir>` in L23 only |
| 4 | `scripts/scout.js` 332-339 | VALID — both `resolveClassifyInput` branches rebuilt a stripped manifest, dropping `pi`/`opencode`/`devDependencies`/`files` Tier-1 signals; explicit `--deps` merged peerDeps into dependencies | FIXED: `Object.assign({}, parsed/manifest, {...})` passthrough in both branches; explicit `--deps` overrides `dependencies` and clears peer/devDeps |
| 5 | `site/app.js` 1253-1267 | VALID — `clearFiltersBtn` reset state but never reset `.kind-pill-btn` `tab-active`/`text-slate-400` classes, unlike the pill click handler | FIXED: same toggle loop added to the clear handler |
| 6 | `site/app.js` L695/L715 | VALID — Scout Lab fabricated `license: MIT` for arbitrary user-supplied packages in both the YAML preview and the injected session entry | FIXED: both emit `UNKNOWN` |
| 7 | `site/app.js` 350-352 | VALID — preset used `github-mcp`/`filesystem-mcp`, which match no catalog id (real ids: `github-code-intel-mcp`, `filesystem-shell-mcp`), so the `entryById` filter silently dropped the MCP tools | FIXED: correct ids, filter kept |
| 8 | `site/index.html` L409 | VALID — static `Bundle (11 Files)` label stale (bundle is 18 files) | FIXED: static label → `Bundle`; `renderPreview` now sets `Bundle (<n> Files)` from `compiled.bundleFiles.length` |
| 9 | `site/index.html` 10-13 | SKIPPED (out-of-scope) — removing Tailwind CDN + Google Fonts and vendoring locally requires a build-time CSS pipeline (`package.json` has no tailwind/postcss tooling) and the entire markup is Tailwind-utility-driven; doing it in this PR risks breaking all styling. Styling kept intact. | NONE |
| 10 | `src/core/classifier.js` L285 | VALID — Tier-2 keyword match was `keywordsStr.indexOf(kw)`, so keyword `javascript` contained `java` (→ jvm-dotnet) and `axios` contained `ios` (→ mobile-ios); reproduced pre-fix routing to `skills/design/mobile-ios` | FIXED: `keywordHit()` exact per-token match in both skill and MCP scorers + regression test |
| 11 | `src/core/compiler.js` 466-467 | VALID — Gemini entry copied `tr.url` for all remotes, losing the SSE vs Streamable-HTTP distinction (`serverTransport` reports it via `type`) | FIXED: `tr.type === 'http'` → `gEntry.httpUrl`, else `gEntry.url` |
| 12 | `src/core/compiler.js` 497-501 | VALID — Cursor/Windsurf/Copilot JSON copied full server transport, ignoring `sel.tools`/`deniedTools` (a narrowed selection emitted as unrestricted) and those formats have no tool-filter field | FIXED: `scopedMcpNote()` appends a `Scoped MCP Tools (host-enforced…)` section with per-server allow/deny scope to all three rules docs |
| 13 | `src/core/compiler.js` 458-496 | VALID (fail-open) — non-wildcard selection with empty `tools` omitted `includeTools`, so Gemini allowed every tool despite deny-only intent | FIXED: non-wildcard always sets `includeTools` (even `[]`); wildcard omits; `excludeTools` kept |
| 14 | `src/core/importer.js` 509-525 | VALID (fail-open) — `exposure: 'hidden'` with an empty allow list fell through to wildcard `['*']`, importing a locked-down server as allow-all | FIXED: hidden exposure always takes the explicit allow list, even empty; wildcard-key + hidden-entry exclusions preserved |

## Files created / modified

| File | Change |
|------|--------|
| `bin/agent-builder.js` | +`'claude'` in `VALID_HARNESSES` |
| `docs/reports/v2-overhaul-verification.md` | L22 pipe-containing code span reworded |
| `docs/reports/v2-stage2.md` | L23 `<pkg\|dir>` → `<pkg/dir>` |
| `scripts/scout.js` | Full-manifest passthrough in both `resolveClassifyInput` branches |
| `site/app.js` | Pill reset in clear handler; `UNKNOWN` licenses ×2; correct preset MCP ids; dynamic bundle count in `renderPreview` |
| `site/index.html` | Bundle button label → `Bundle` (count now dynamic) |
| `src/core/classifier.js` | `keywordHit()` helper; exact match in both scorers |
| `src/core/compiler.js` | Gemini `httpUrl`/`url` split; always-set `includeTools`; `scopedMcpNote()` on cursor/windsurf/copilot docs |
| `src/core/importer.js` | Hidden-exposure deny-only fix |
| `test/classifier.test.js` | +1 regression test (`javascript`/`axios` → `skills/coding/typescript-js`, not jvm-dotnet/mobile-ios) |
| `docs/reports/v2-review-fixes.md` | NEW — this report |

Explicitly NOT committed or pushed; `_site/` rebuilt locally as a build artifact only.

## Test results

```
$ node scripts/run-tests.js
tests 158 | suites 49 | pass 158 | fail 0   (was 157; +1 regression test, 0 regressions)

$ npm run validate
VALIDATED 66 ENTRIES OK

$ npm run site
SITE_BUILT _site/ with 66 registry entries
```

Targeted re-verification (all exit 0, fail-closed preserved):

- `compile --harness claude` → `CLAUDE_ALIAS_OK` (was: `unknown harness` exit 1)
- Gemini empty non-wildcard tools → `includeTools: []`; wildcard → key omitted; remote `streamable-http` → `httpUrl`, `sse` → `url`
- Cursor/Copilot rules docs contain the `Scoped MCP Tools` limitation note with per-server allow/deny scope
- Importer `exposure:hidden + toolExposure:{q:hidden}` → `tools: [], deniedTools: [q]` (was wildcard `['*']`)
- Classifier `axios`+`javascript` keywords → `skill / skills/coding/typescript-js`
- `node --check` clean on `site/app.js`, `src/core/*.js`, `scripts/scout.js`; `scout parseClassifyArgs` smoke OK

## Self-audit notes

- Zero-stubs: no TODO/FIXME/placeholder introduced; every fix asserts or preserves exact behavior (live probes above, not vacuous).
- Fail-closed: #13/#14 close fail-open paths (empty-tools Gemini allow-all; hidden-exposure wildcard import); #6 stops fabricating license provenance; validation gates re-run green with no schema/taxonomy changes.
- Minimal scope: #9 deliberately skipped with reason (needs a CSS build pipeline; would risk all site styling); #3 touched only the table row, not the list occurrence; appended rules-doc notes are conditional on non-empty selections and keep all existing `includes` assertions passing.
- Working tree: only the files above modified plus this report. Nothing committed or pushed.
