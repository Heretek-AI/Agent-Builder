# v2 Review Fixes — Independent Drift Guard Verification

- Stage ID: v2-review-fixes
- Date (UTC): 2026-10-20
- Branch: `feat/agent-builder-v2` (worktree `/tmp/opencode/agent-builder-v2`)
- Auditor: Independent Adversarial Drift Guard (subagent, CHANGE NO CODE)
- Reports read: `docs/reports/v2-review-fixes.md`, `docs/evidence/v2/qa-review-fixes.log`, `docs/reports/v2-overhaul-implementation.md`
- Scope: verify 13 fixes minimal+valid, 1 skip (#9) justified, no stubs, tests 158 pass, validate/site 66, 2 fail-closed re-proofs

## Gate results (independently re-run, all exit 0)

- `node scripts/run-tests.js` → `tests 158 | suites 49 | pass 158 | fail 0` (was 157; +1 classifier regression)
- `npm run validate` → `VALIDATED 66 ENTRIES OK`
- `npm run site` → `SITE_BUILT _site/ with 66 registry entries`
- `node --check` clean: `site/app.js`, `src/core/compiler.js`, `src/core/classifier.js`, `src/core/importer.js`, `scripts/scout.js` (all `*_OK`)
- `git status --short` → exactly 10 modified + `?? docs/reports/v2-review-fixes.md`; branch `feat/agent-builder-v2`. Evidence log `docs/evidence/v2/qa-review-fixes.log` is gitignored via `.gitignore:5:*.log` so absence from status is expected, not drift. No commit/push observed (`git log --oneline -3` head `03118cb feat v2 overhaul`).
- `git diff --stat` → 10 files, 116 insertions, 24 deletions — matches claimed file list, no extra files.
- Backup integrity: `diff /tmp/qa-backup-agent-builder.js bin/agent-builder.js` → DIFF_CLEAN1; `diff /tmp/qa-backup-compiler.js src/core/compiler.js` → DIFF_CLEAN2 (QA destructive red-proofs correctly restored).

## Fix-by-fix verification (minimal + valid)

| # | Claim | Independent check | Result |
|---|-------|-------------------|--------|
| 1 | `bin/agent-builder.js` 20-45: added `'claude'` to `VALID_HARNESSES` | `sed 20-50` shows `'claude',` at L25; `canonicalHarness` L38-46 maps `claude→claude-code`, `gemini→gemini-cli`; `git diff` shows single-line `+'claude',`. Live `compile --harness claude` → JSON `{mcpServers, agentMd}` EXIT:0. Old list without `claude` would reject (logic confirmed). | VALID, minimal |
| 2 | `docs/reports/v2-overhaul-verification.md` L22 pipe fix | Diff L22: `` `tests 157 \| suites…` `` → `tests 157, suites 49, pass 157, fail 0`. Current L22 contains commas, no literal pipe in code span. Table intact. | VALID, minimal |
| 3 | `docs/reports/v2-stage2.md` L23 `<pkg\|dir>` → `<pkg/dir>` | Diff L23 only; L15 prose-list occurrence `<pkg\|dir>` intentionally left (`grep pkg` L15 still has pipe, L23 now `<pkg/dir>`). Correct: only table cell fixed. | VALID, minimal |
| 4 | `scripts/scout.js` 332-339 full-manifest passthrough | `sed 276-400`: both branches now `Object.assign({}, parsed/manifest, {...})` preserving `pi/opencode/dev/peerDeps/files`; explicit `--deps` overrides `dependencies` and clears peer/devDeps. Minimal 34-line hunk, no behavior change otherwise. | VALID, minimal |
| 5 | `site/app.js` 1253-1267 pill reset | `sed 1244-1280`: clear handler now contains identical `querySelectorAll('.kind-pill-btn')` toggle loop (`tab-active`/`text-slate-400`) matching pill click handler L1244-1253. | VALID, minimal |
| 6 | `site/app.js` L695/L715 `MIT` → `UNKNOWN` | `grep UNKNOWN` hits L695 `license: UNKNOWN` (YAML preview) and L715 `license: 'UNKNOWN'` (session entry). No other license fabrication. Fail-closed provenance. | VALID, minimal |
| 7 | `site/app.js` 350-352 preset ids | L350-351 now `github-code-intel-mcp`, `filesystem-shell-mcp` with `entryById` filter kept (L336, L351, L359). Old `github-mcp`/`filesystem-mcp` matched nothing → silently dropped tools; fixed ids are real catalog ids. | VALID, minimal |
| 8 | `site/index.html` L409 + `site/app.js` dynamic count | `index.html:409` static label now `Bundle`; `site/app.js:813-814` sets `$('downloadBundle').textContent = 'Bundle (' + compiled.bundleFiles.length + ' Files)'`. Stale `Bundle (11 Files)` (actual 18) eliminated. | VALID, minimal |
| 9 | `site/index.html` 10-13 Tailwind CDN skip | `sed 1-20` confirms CDN `https://cdn.tailwindcss.com/3.4.17` + Google Fonts still present. `grep tailwind\|postcss package.json` → no hits (no build tooling). Entire markup is Tailwind-utility-driven. Vendoring without pipeline risks all styling. | SKIP JUSTIFIED, out-of-scope, explicitly documented |
| 10 | `src/core/classifier.js` L285 `keywordHit()` | L57-69 defines `keywordHit()` exact per-token match with comment citing `javascript/java` and `axios/ios` bug; used at L301 (skill scorer) and L335 (MCP scorer). Regression test `test/classifier.test.js:169` asserts `axios+javascript → skill/skills/coding/typescript-js`. Live probe with correct manifest shape → `CLASSIFIER_OK`. | VALID, minimal, fail-closed routing |
| 11 | `src/core/compiler.js` 466-467 Gemini `httpUrl`/`url` split | `sed 455-480`: `tr.type === 'http'` → `gEntry.httpUrl`, else `gEntry.url`. Live: `streamable-http` registry → `httpUrl`, `sse` → `url` (both `*_OK`). `serverTransport` L294-322 reports distinction via `type`. | VALID, minimal |
| 12 | `src/core/compiler.js` 497-501 `scopedMcpNote()` | L509-527 defines `scopedMcpNote()`; wired at L544 (cursor), L555 (windsurf), L566 (copilot). Live `cursorRuleMdc.includes('Scoped MCP Tools')` → `SCOPED_OK`. Conditional on non-empty selections, existing `includes` assertions still pass (158/158). | VALID, minimal |
| 13 | `src/core/compiler.js` 458-496 Gemini `includeTools` always-set | L483-489: `if (!wildcard) { gEntry.includeTools = sel.tools.slice(); }` with fail-closed comment. Live: empty non-wildcard → `{"includeTools":[],"excludeTools":["q"]}` `GEMINI_EMPTY_OK`; wildcard → key omitted `GEMINI_WILDCARD_OK`. Old `!wildcard && sel.tools.length>0` would omit → fail-open (logic confirmed). | VALID, minimal, fail-closed |
| 14 | `src/core/importer.js` 509-525 hidden-exposure deny-only | `sed 500-535`: `if (srv.exposure === 'hidden') { tools = allowedList; }` — explicit allow list stands even when empty. Live `parseUploadedConfig('mcp.json', …exposure:hidden, toolExposure:{q:hidden})` → `tools: [], deniedTools: [q]` `IMPORTER_OK` (was wildcard `['*']`). Wildcard-key + hidden-entry exclusions preserved. | VALID, minimal, fail-closed |

Count: 13 fixes (##1-8, 10-14) VALID + 1 skip (#9) JUSTIFIED. No scope cuts.

## Stub / shortcut scan (adversarial)

- `grep -rn TODO|FIXME|PLACEHOLDER…` on changed JS: only hits are pre-existing comments in `src/core/compiler.js:24,290,826,830` describing the legitimate safe placeholder install script (verified `git show HEAD:…` — pre-existing, not introduced). No `TODO.*implement`, `dummy.*pass`, bare `latest`, or `lorem`.
- `grep || true|set +e|echo pass`: only `bin/agent-builder.js:79` help text `exit 0` and `test/catalog-negative.test.js:117` comment about `|| true` swallow (test asserts it turns RED). No swallowed failures.
- `grep catch`: `src/core/importer.js:255,792`, `scripts/scout.js:299,310,322` — all non-empty (fail with message or fallback), no `catch(e){}` vacuous blocks.
- Vacuous asserts: `grep assert.*1 === 1|assert(true)|expect(true)` in `test/classifier.test.js` → no hits. New regression test asserts exact `kind` + `category` (`skill` / `skills/coding/typescript-js`), not existence.
- `node --check` + live probes above assert exact behavior, not process existence.

## Fail-closed re-proofs (independent, non-mutating per RULE 1)

QA log performed destructive sabotage+restore; auditor does NOT repeat file mutations. Instead verified:
- **Red-proof 1 (claude alias):** QA sabotage (remove `'claude',`) → `ERROR: compile: unknown harness "claude"` EXIT:1 (FAIL as required, not vacuous); restore → JSON EXIT:0 `CLAUDE_ALIAS_OK`. Independently confirmed: current file contains `'claude'` (L25), live `compile --harness claude` EXIT:0, and old-list logic `!OLD.includes('claude')` → reject confirmed. Backup diff `DIFF_CLEAN1` proves byte-identical restore, no `git checkout` on tracked files.
- **Red-proof 2 (Gemini includeTools):** QA sabotage (`if (!wildcard)` → `if (!wildcard && sel.tools.length>0)`) → `includeTools` missing → probe `FAIL: includeTools missing (fail-open reverted)` EXIT:1; restore → `includeTools:[]` `GEMINI_EMPTY_OK` + wildcard omitted `GEMINI_WILDCARD_OK`. Independently confirmed live with same recipes (see Gate section), plus old-condition simulation (`OLD_COND_WOULD_SET_INCLUDE:false` → would omit → fail-open confirmed). Backup diff `DIFF_CLEAN2` proves restore.
- Both checks are truly fail-closed (sabotage forces EXIT:1 / missing-key FAIL, not silent pass).

Minor log inaccuracy (non-blocking): handoff gate claims status shows evidence log, but `*.log` is gitignored so it correctly does not appear. Expected status (10M + `?? v2-review-fixes.md`) matches exactly.

## Verdict

All 13 fixes re-verified minimal and behavior-exact; skip #9 justified with build-pipeline reason; zero stubs; 158/158 tests, 66 validate, 66 site; both red-proofs fail-closed and restore-clean; working tree matches expected.

VERDICT: PASS
