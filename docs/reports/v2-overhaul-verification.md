# v2-overhaul Drift Guard Verification Report — Stage v2-overhaul

- Stage ID: v2-overhaul
- Date (UTC): 2026-10-20
- Auditor: Independent Adversarial Drift Guard (subagent, read-only; no code modified)
- Branch: `feat/agent-builder-v2` (worktree `/tmp/opencode/agent-builder-v2`)
- Programmer report audited: `docs/reports/v2-overhaul-implementation.md`
- Prior stage reports read: `docs/reports/v2-stage2.md`, `docs/reports/v2-stage3.md`
- Context read: `docs/NOTES.md`, `data/schema.json`, `data/taxonomy.json`, `package.json`,
  `src/core/compiler.js`, `src/core/importer.js`, `src/core/classifier.js`,
  `scripts/scout.js`, `site/app.js`, `site/index.html`, `bin/agent-builder.js`,
  `data/plugins/cross-harness/pi-coding-agent.yaml`, `data/plugins/cross-harness/pi-review.yaml`
- QA evidence reviewed: `docs/evidence/v2/qa-run.log`, `docs/evidence/v2/red-proofs.log`

## 1. Spec cross-reference (original v2 request vs delivered)

| Required deliverable | Programmer claim | Auditor finding |
|---|---|---|
| Harness compiler + importer (10 targets) | Stage-1 carryover, re-verified 10/10 + bogus fail-closed | CONFIRMED. `bin compile --recipe /tmp/preset-test.json --harness {opencode-v2,opencode-v1,opencode-md,pi,claude-code,codex,gemini,cursor,windsurf,copilot}` all EXIT:0; `--harness bogus` EXIT:1 with `unknown harness` (re-ran independently). 19 export keys present on compiled recipe (incl. `piSettingsJson/piMcpJson/piAgentsMd`, gemini/cursor/windsurf/copilot/vscode keys); `bundleFiles` length 18 with all pi/client slug-qualified paths (recomputed live via `compileAgentRecipe`). |
| 4-tier classifier (confidence/breakdown/runner-ups) + `scout classify` | Stage-2 carryover (`src/core/classifier.js` 552 lines, `scripts/scout.js` 1050 lines), T1 w10 / T2 w6-8 / T3 w3 word-boundary / T4 w1, confidence 0-100, `alternativeCategories` | CONFIRMED. `test/classifier.test.js` 16 tests cover contract, confidence range, `[+N]` breakdown, no-signal fail-closed (`dotenv`/`express` → Confidence 10%, Signal no), T1 dep routing, Pi detection, T2 `golang`, T3 `go`/`ui` non-triggers (`ergonomic/algorithms/category`, `guided/liquid/equip`), runner-up scoring with all ids ∈ 56 taxonomy leaves (leaf count recomputed: 56). Live `classify express` EXIT:0 with breakdown; `classify nonexistent-pkg-xyz-123` EXIT:1 `HTTP 404` (re-ran; note: shell pipe to `head` masks `$?` — direct redirect gives EXIT:1 correctly). |
| Split-pane site (presets / traceV2Permission / Lab) | Stage-3 carryover, 5 presets + trace + Scout Lab | CONFIRMED. `site/index.html` (482 lines) preset dropdown holds exactly the 5 ids (`db-security-auditor`, `fullstack-polyglot-agent`, `frontend-design-agent`, `sre-database-agent`, `pi-codemode-architect`); `site/app.js` (1428 lines) contains `presetId === 'pi-codemode-architect'` fallback + 11-key `TAB_FILES` (`v2/v1/opencodeMd/pi/claude/codex/gemini/cursor/windsurf/copilot/install`, counted 11); `traceV2Permission` referenced 2× in `site/app.js`, defined + exported in `src/core/compiler.js` (lines 98/866); Scout Lab ids (`runScoutClassifyBtn`, `scoutPkgName`, `view-scout`) present. |
| 157 tests + 66 entries + pi yamls | 147→157 (+10), 64→66 (+2 Pi entries) | CONFIRMED. `node scripts/run-tests.js` independently re-ran: `tests 157, suites 49, pass 157, fail 0` EXIT:0. `npm run validate` → `VALIDATED 66 ENTRIES OK`; `npm run site` → `SITE_BUILT _site/ with 66 registry entries`; `find data -name *.yaml | wc -l` → 66; `data/plugins/cross-harness/` holds `harness-adapter-kit`, `litellm-router-bridge`, `pi-coding-agent`, `pi-review`. Both Pi yamls pass `loadCatalog` schema+taxonomy gate (entries:2 errors:0) and `classifyManifest('@earendil-works/pi-coding-agent')` → `plugin / plugins/cross-harness` conf 84, matching yaml exactly. |

Deviations claimed by programmer — both VERIFIED as legitimate, not scope cuts:
1. Missing `v2-overhaul.test.js` in reference drop. Verified: `/tmp/opencode/v2-extract/Agent-Builder/test/` lists 6 suites (`catalog-negative`, `catalog`, `compiler`, `local-server`, `mcp`, `stage4`) — no `v2-overhaul.test.js` anywhere (`find -name '*v2-overhaul*'` → empty). Resolution (10 new in-suite tests in `test/stage4.test.js` covering trace/10-target/site-presets) is a reasonable closure, not a premature pass.
2. Missing `earendil-works/pi` + `pi-review` yamls in reference drop. Verified: `diff -rq <ref>/data <local>/data` shows ONLY the two new Pi files differ; reference otherwise byte-identical. Authored entries carry real repo URLs, pinned `@1.3.0` npm install (coding-agent) and verbatim upstream `pi install git:…` (review, npm-absent documented) — no placeholders, no bare `latest` (grep confirms).

## 2. Stub / shortcut hunt (assume broken until proven)

- `grep -rniE 'cmd.*true|echo pass|exit 0|TODO.*implement|FIXME|not implemented|stub|dummy.*pass|\|\| true|set \+e'` over `src/core/*`, `scripts/scout.js`, `site/app.js`, `site/index.html`, `bin/agent-builder.js`, `scripts/build-site.js`, `test/stage4.test.js`, `test/classifier.test.js`: only 2 hits, both benign — `bin/agent-builder.js:78` usage text `exit 0` documentation, and `test/stage4.test.js:30` test *name* containing `exit 0`. No `|| true`, no `set +e`, no `TODO/FIXME/stub` markers.
- Empty-`catch` sweep: `site/app.js:897 catch (e) { stored = {}; }` is a `localStorage` JSON-parse fallback defaulting to `{}` — fail-closed default, not a swallowed domain error. Remaining catches are fetch/clipboard/permalink fallbacks with explicit fallback paths (`fallbackCopyText`, fetch→remote registry, malformed-permalink ignore). No empty `catch {}` hiding compiler/classifier/validator failures.
- Vacuous assertions: none. New `v2-overhaul` blocks (lines 256-393) assert exact winning-rule index/rule/trace flags, `matchedIndex -1` empty case, `assert.throws` on malformed perms, all 19 export keys non-null, `$schema` pin, `toolExposure` codemode/hidden mapping, 18-file bundle list with 12 explicit slug paths, all 5 preset `value="…"` options, and `TAB_FILES` tab keys. Prior suites assert deny-first ordering, hyphen preservation, byte-exact fixtures, and fail-closed gates — all substantive.
- QA logs note `*.log` files are gitignored (`git check-ignore` confirms) — evidence present on disk but correctly absent from `git status`. Not a missing-artifact issue.

## 3. Independent gates (re-ran, not trusted from report)

- `node scripts/run-tests.js` → 157/157 pass, 49 suites, EXIT:0 (full output captured; `v2-overhaul` 10 tests all pass).
- `npm run validate` → `VALIDATED 66 ENTRIES OK` EXIT:0.
- `npm run site` → `SITE_BUILT _site/ with 66 registry entries` EXIT:0.
- Compiler 10-target matrix + bogus rejection: all 10 EXIT:0, bogus EXIT:1 (see §1).
- Scout: `--help` EXIT:0, `classify express` EXIT:0, `classify nonexistent-pkg-xyz-123` EXIT:1 (see §1).
- `git status --short` matches programmer's claimed tree exactly (9 modified + 8 untracked stage files, no commits): `M bin/agent-builder.js, scripts/build-site.js, scripts/scout.js, site/app.js, site/index.html, site/styles.css, src/core/compiler.js, src/core/importer.js, src/server/local-server.js, test/stage4.test.js` + `?? data/plugins/cross-harness/pi-*.yaml, docs/reports/v2-*.md, src/core/classifier.js, test/classifier.test.js`. Branch `feat/agent-builder-v2` confirmed. Nothing committed/pushed (log head `7884b40` unchanged).

## 4. Red-proof review + independent fail-closed verification

Programmer `red-proofs.log` documents a 7-step protocol per sabotage with `cp`-backup restores (correctly avoiding `git checkout --` on dirty Stage 1-3 files) and `STATUS_MATCH_PRE` verification. Coverage: compiler (`compileAgentRecipe` throw → compile + run-tests EXIT:1), classifier (untracked-file injection → classify EXIT:1), validate+site (Bad_ID schema violation → both EXIT:1). Logs show failing outputs and restoration to `VALIDATED 66` / `SITE_BUILT 66`. Credible and complete.

Independently re-verified 3 fail-closed assertions (exceeds the 2-required minimum):
1. **Compiler is live, not stubbed**: injected `throw new Error("AUDIT_SABOTAGE")` into `compileAgentRecipe` → `bin compile` EXIT:1; restored via backup → EXIT:0; `grep -c AUDIT_SABOTAGE` == 0. Proves the 10-target check is fail-closed.
2. **`traceV2Permission` fail-closed**: `traceV2Permission('not-array','a','r')` throws `permissions must be an array`; invalid-effect rule throws `invalid effect` (also covered by in-suite `assert.throws` tests, which pass).
3. **Harness + classify rejection**: bogus harness EXIT:1 `unknown harness`; `classify nonexistent-pkg-xyz-123` EXIT:1 `HTTP 404`. Both re-ran EXIT:1 correctly.

No code was modified by this audit except this report (restoration verified byte-clean after the sabotage probe).

## 5. Findings

None. Zero stubs, zero vacuous passes, zero regressions, zero uncommitted-QA residue, deviations documented and grounded.

---

VERDICT: PASS
