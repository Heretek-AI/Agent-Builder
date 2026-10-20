# v2 Stage 3 Implementation Report — Studio WebUI + build-site + cross-harness data

- Stage ID: v2-stage3
- Date (UTC): 2026-10-20
- Branch: `feat/agent-builder-v2` (worktree `/tmp/opencode/agent-builder-v2`)
- Reference bundle: `/tmp/opencode/v2-extract/Agent-Builder` (Stage 1 compiler/importer + Stage 2 classifier done, 147 tests pass)
- Ground truth read: `site/app.js` (1428 lines), `site/index.html` (482 lines), `site/styles.css` (286 lines), `scripts/build-site.js` (156 lines), `data/plugins/cross-harness/` (2 yamls), `bin/agent-builder.js` (356 lines)

## Summary of deliverables

Ported the Studio v2.0 WebUI verbatim from the reference (split-pane dark glassmorphic, sticky preview, Smart Scout Lab tab):

1. `site/index.html` (verbatim port) — sticky top command header (`sticky top-0`, backdrop-blur), Studio nav (`studio-tab-btn` × 4: explorer / harness / scope / scout + `badgeRegistryCount` + `selectedCount` + `activeSlugPill`), 12-col split layout (`lg:grid-cols-12`: 7/8-col workbench + 5/4-col `lg:sticky lg:top-28` preview aside), kind-filter pills (`kind-pill-btn`), `presetAgentSelect` dropdown with 5 presets (db-security-auditor / fullstack-polyglot-agent / frontend-design-agent / sre-database-agent / pi-codemode-architect), Pi client settings (`piThinkingLevel` / `piMcpExposure` / `piDefaultTools`), `simTraceOutput` trace pane, Scout Lab (`view-scout`: `scoutPkgName` / `scoutRepoUrl` / `scoutDescription` / `scoutKeywords` / `scoutDeps` / `runScoutClassifyBtn` / `injectScoutEntryBtn` / `scoutResultCard` / `scoutTargetFile` / `scoutYamlOutput` / `copyScoutYamlBtn` + 4 `scout-sample-btn`), 11-tab preview (`v2/v1/opencodeMd/pi/claude/codex/gemini/cursor/windsurf/copilot/install` + `previewTargetPath` / `copyPreviewBtn` / `downloadFile` / `downloadBundle`), helper drawer + publish modal with `role="dialog" aria-modal="true"`. Preserves a11y contract: `#dropZone` uses `aria-labelledby="dropZoneText"` (no mismatched `aria-label`), `#fileInput` has `aria-label`, inline data-URI favicon. Loads `./core/classifier.js` in addition to compiler/importer.
2. `site/app.js` (verbatim port) — 5-preset support (`loadAgentPresetById`: generic `agent_preset` skills + `mcp_selections` normalisation via `Compiler.normalizeMcpId` for the 4 registry agents + hardcoded `pi-codemode-architect` fallback filtered by `entryById`), `traceV2Permission` simulator (`runSimulator` writes `simResult` + `simTraceOutput` winning-rule `[#N] action/resource -> EFFECT` via `Compiler.traceV2Permission` when present), Scout Lab (`SCOUT_SAMPLES` pi/ghidra/rust/design, `runScoutLab` via `window.Classifier.classifyManifest`, `injectScoutCandidateIntoSession` unshifts synthetic entry + `addToAgent` + rebuilds tree, `copyScoutYamlBtn`/`copyPreviewBtn` via clipboard fallback), `currentRecipe` gains `piOptions` (thinkingLevel/mcpExposure/defaultTools), `TAB_FILES` gains `pi/gemini/cursor/windsurf/copilot` + `install` emits `install --recipe <base64url>` (no `--slug`) + `installScriptSh` suffix, `syncPreviewTabs`, studio-tab switching, kind-pill filtering, `clearFiltersBtn`/`clearSelectedBtn`, `runScoutLab()` on boot. Fail-closed: `restoreRecipeFromUrl` ignores malformed permalink, empty helper request short-circuits, LLM JSON parse failure surfaces `Helper failed`.
3. `site/styles.css` (verbatim port) — dark glassmorphic theme (`--bg:#090d16`, `.glass-panel` blur 12px, teal accent), `.tab-active`, category-tree / cards (`min-height:240px` CLS reserve) / entry-card hover, `.scope-server h3` + `.tool-grid` grid, `.dropzone` hover, `#fileInput{min-height:28px}` (≥24px target), `.sim-result.allow/deny`, `.drawer` sets **no** `display` (so UA `[hidden]` applies natively), `.modal-backdrop[hidden]{display:none}` flex-override guard, `.preview .s/.c` tokens.
4. `scripts/build-site.js` (verbatim port) — adds `copyFile(.../src/core/classifier.js -> _site/core/classifier.js)` (step 2) so the Scout Lab `<script src="./core/classifier.js">` resolves; header documents `generated_at` exception + `SOURCE_DATE_EPOCH` reproducibility; otherwise identical (clean `_site/`, shell copy, registry regen, content/health, `.nojekyll`, `SITE_BUILT` + fail-closed `exit 1`).
5. `data/plugins/cross-harness/` pi entries — **checked, no copy needed**: reference contains only `harness-adapter-kit.yaml` + `litellm-router-bridge.yaml`, byte-identical to local (`diff -r data/` clean). No `earendil-works/pi` or `pi-review` yamls exist anywhere in the reference bundle (`grep -ril` hits are code-level only: `site/app.js` SCOUT_SAMPLES, `scripts/scout.js` Pi queries, `src/core/compiler.js` + `classifier.js` Pi detection). Pi support is compiler-level (`piSettingsJson`/`piMcpJson`/`piAgentsMd`), already present in Stage 1. Nothing to copy verbatim.
6. `bin/agent-builder.js` — **kept local superset** (not overwritten): local adds `canonicalHarness` (`gemini↔gemini-cli`, `claude↔claude-code` aliases) + `'gemini'` in `VALID_HARNESSES`; reference lacks both. All 5 presets verified against the CLI (see tests below).

## Files created / modified

| File | Change |
|------|--------|
| `site/index.html` | Verbatim port of reference (byte-identical, `diff -q` clean). |
| `site/app.js` | Verbatim port of reference (byte-identical). |
| `site/styles.css` | Verbatim port of reference (byte-identical). |
| `scripts/build-site.js` | Verbatim port of reference (byte-identical; adds classifier copy). |
| `docs/reports/v2-stage3.md` | NEW — this report. |

Explicitly NOT edited: `src/core/compiler.js`, `src/core/importer.js`, `src/core/classifier.js`, `bin/agent-builder.js`, `src/server/local-server.js`, `scripts/scout.js`, `data/**`, `test/**`, `package.json` (Stage 1/2 outputs + catalog untouched; local compiler/importer are newer than reference — extra slug-qualified bundle paths + generic skill extraction — and all 147 tests depend on them).

## Test results

```
$ npm run site
SITE_BUILT _site/ with 64 registry entries  (_site/core/ = compiler.js + importer.js + classifier.js)

$ node scripts/run-tests.js
ℹ tests 147 | suites 46 | pass 147 | fail 0

$ SOURCE_DATE_EPOCH=1234567890 node scripts/build-site.js ×2 → registry.json + index.html byte-identical (stage4 AB-5.3 re-verified via suite)

$ bin preset verification (all exit 0):
  compile --recipe /tmp/preset-db.json (db-security-auditor: skills rust-secure-coding+secure-code-audit, mcp postgres-prod) --harness opencode-v2 → agents.db-security-auditor allow×2 + deny-first
  compile --recipe /tmp/preset-db.json --harness pi → settings/defaultThinkingLevel + mcpServers.postgres-prod + .pi/skills/*
  compile --recipe probe.json --harness {opencode-v2,opencode-v1,opencode-md,pi,claude-code,codex,gemini-cli,cursor,windsurf,copilot} → OK ×10
  install --recipe <base64url(site install-tab format)> --dry-run → DRY_RUN install stage3-probe … would write: opencode.*.v2.json, .pi/settings.*.json …

$ registry preset presence: db-security-auditor / fullstack-polyglot-agent / frontend-design-agent / sre-database-agent FOUND (64 entries); pi-codemode-architect is a hardcoded app.js fallback (filters missing github-mcp/filesystem-mcp via entryById, keeps typescript-strict-patterns + rust-secure-coding)

$ site feature grep: traceV2Permission ×2, SCOUT_SAMPLES/runScoutLab/injectScoutCandidateIntoSession present; view-scout/simTraceOutput/presetAgentSelect/glass-panel/lg:sticky present; build-site classifier copy present
```

## Self-audit notes

- Zero-stubs: `grep -rni "TODO.*implement|dummy.*pass|TODO:" site/app.js site/index.html scripts/build-site.js` → no hits; all 5 presets / simulator / Lab inject fully wired (no `// TODO`, no `|| true`, no swallowed errors).
- Fail-closed: permalink restore ignores malformed base64url; `loadAgentPresetById` drops unknown skill/MCP ids via `entryById` filter; `runSimulator` requires non-empty action; `resolveGeneratedAt` exits 1 on bad `SOURCE_DATE_EPOCH`; bundle-path traversal still refused in `bin install`.
- a11y preserved: `publishClose`/`helperClose` set `hidden=true` (modal dismiss); `.modal-backdrop[hidden]{display:none}` guard present, `.drawer` sets no `display`; card/scope headings are `<h3>` (no `<h4>`); `#dropZone` labelledby visible text, `#fileInput` labelled + ≥24px, `.cards` min-height CLS reserve — all re-verified by `test/stage4.test.js` (147/147 pass).
- Determinism: `site/*` + `scripts/build-site.js` are byte-identical to the reference (`diff -q` clean ×4); `_site/` rebuild is `SOURCE_DATE_EPOCH`-idempotent.
- Working tree: `git status --short` shows Stage 1/2 mods + `M site/*, scripts/build-site.js` and `?? src/core/classifier.js, test/classifier.test.js, docs/reports/v2-stage*`. Nothing committed or pushed, per instructions.
