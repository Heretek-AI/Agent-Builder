# v2 Stage 2 Implementation Report — Weighted Classifier + `scout classify` CLI

- Stage ID: v2-stage2
- Date (UTC): 2026-10-20
- Branch: `feat/agent-builder-v2` (worktree `/tmp/opencode/agent-builder-v2`)
- Reference bundle: `/tmp/opencode/uploads/f81fd801b59078/Agent-Builder-v2.zip` → `/tmp/opencode/v2-extract/Agent-Builder`
- Ground truth read: `src/core/classifier.js` (552 lines), `scripts/scout.js` (871 lines), `data/taxonomy.json` (56 leaves)

## Summary of deliverables

Ported the 4-tier weighted classifier and its scout integration:

1. `src/core/classifier.js` (NEW, verbatim port) — UMD module (Node + browser `<script>` → `globalThis.Classifier`) exporting `classifyManifest`, `scoreBestSkillCategory`, `scoreBestMcpCategory`, `suggestTopics`. Tiers: **T1 weight 10** (exact deps/peerDeps, `mcp`/`opencode` manifest keys, `SKILL.md`/`DESIGN.md`/`AGENTS.md`/`mcp.json` filenames), **T2 weight 6–8** (package name affixes, explicit npm keywords/topics, harness families incl. Pi `@earendil-works/pi`/`pi-package`), **T3 weight 3** (word-boundary `hasWord` domain tokens across all 32 skill + 8 MCP leaves, so `go`/`ui`/`c` never false-trigger inside `cargo`/`guided`/`liquid`), **T4 weight 1** (description/README context). Returns `{ harnesses, kind, category, topics, signal, confidence, reasons, alternativeCategories, isPiPackage }` — `confidence` is an integer 0–100 (`signal ? min(99, max(35, 30 + weight*3)) : 10`), `reasons` are human-readable `[+N] …` lines, `alternativeCategories` are scored runner-up leaves.
2. `scripts/scout.js` — replaced local `classifyManifest`/`categoryFor`/`suggestTopics` (~170 lines of substring matching) with `require('../src/core/classifier')`; `SEARCHES` gains the 3 Pi queries; `candidateInput` + live issue body now carry `confidence`; added `classify` command (see below).
3. `node scripts/scout.js classify <pkg|dir>` CLI — positional npm name (live `registry.npmjs.org/<name>/latest` fetch) or local directory (`package.json` + `README.md` Tier-4 context); legacy `--name/--description/--keywords/--deps` flags still work and override fetched fields; `--json` emits machine-readable output, default is human-readable (`=> kind / category`, harnesses, `Confidence: N%`, `Breakdown:`, `Runner-up categories:`, topics, signal). Fail-closed: unknown command/flag, missing target, non-dir/non-npm target, npm 404 / HTTP error / network failure, deprecated packages, dirs without/invalid `package.json` all exit 1 with `ERROR: …`. No new dependencies (global fetch + fs/path only).
4. `test/classifier.test.js` (NEW, 16 tests) — contract fields, confidence range, `[+N]` breakdown format, no-signal fail-closed (`dotenv` shape → `universal`, confidence ≤ 35), T1 dep routing, Pi detection, T2 `golang` routing, T3 `go`/`ui` non-triggers (`ergonomic/algorithms/category`, `guided/liquid/equip`) vs real `ui` match, runner-up scoring, all best + runner-up ids ∈ the 56 taxonomy leaves, topics cap, `parseClassifyArgs`/`formatClassifyHuman`/delegation wiring.

## Files created / modified

| File | Change |
|------|--------|
| `src/core/classifier.js` | NEW — verbatim port of v2 reference (byte-identical). |
| `scripts/scout.js` | Port of v2 reference (classifier require, Pi searches, confidence in candidates/issues, `parseClassifyArgs`/`cmdClassify`/routing/exports) + positional `<pkg/dir>` target, `--json`, `--deps=` form, unknown-flag rejection, `resolveClassifyInput` (npm/dir/flags), `formatClassifyHuman`. |
| `test/classifier.test.js` | NEW — 16 tests as above. |
| `docs/reports/v2-stage2.md` | NEW — this report. |

Explicitly NOT edited: `src/core/compiler.js`, `src/core/importer.js`, `bin/agent-builder.js`, `src/server/local-server.js` (Stage 1 outputs untouched), `data/taxonomy.json`, `package.json`, existing tests.

## Test results

```
$ node scripts/run-tests.js
ℹ tests 147 | suites 46 | pass 147 | fail 0   (was 131/40; +16 classifier tests)
$ npm run validate
VALIDATED 64 ENTRIES OK
$ node scripts/scout.js run --dry-run
SCOUT_DRY_RUN_OK candidates=11 declined=1
$ node scripts/scout.js accept --issue 1 --dry-run
ACCEPT_OK (dry-run) … up to 10 PR(s)
$ node scripts/scout.js bogus → exit 1 fail-closed
$ node scripts/scout.js classify --help → exit 0, documents classify <pkg|dir>
$ node scripts/scout.js classify dotenv
dotenv => plugin / plugins/cross-harness · Harnesses: universal · Confidence: 10% · Signal: no · EXIT=0
$ node scripts/scout.js classify express
express => plugin / plugins/cross-harness · Harnesses: universal · Confidence: 10% · Signal: no · EXIT=0
$ node scripts/scout.js classify nonexistent-pkg-xyz
ERROR: classify: package 'nonexistent-pkg-xyz' not found on npm (HTTP 404) · EXIT=1
$ node scripts/scout.js classify @modelcontextprotocol/server-filesystem
mcp-server / mcp-servers/filesystem-shell · Confidence: 69% · Signal: yes · EXIT=0
$ node scripts/scout.js classify .   (repo dir → package.json + README context)
mcp-server / mcp-servers/git-repos · 6 harnesses · Confidence: 99% · EXIT=0
$ node scripts/scout.js classify --name demo-skill --description "kubernetes helm skill playbook" --keywords skill,kubernetes --json
skill / skills/devops-cloud/containers-k8s · Confidence: 93% · runner-up listed · EXIT=0
```

`dotenv`/`express` correctly yield no-signal (neither package carries harness/skill/MCP markers — fail-closed low confidence, not a crash); positive-signal paths (MCP SDK dep, kubernetes skill) score 69–99% with runner-ups.

## Self-audit notes

- Fail-closed: every invalid classify input exits 1 with a descriptive `ERROR:`; unknown scout commands/flags unchanged (`bogus` → exit 1); deprecated npm packages refused; `resolveClassifyInput` failure strings are static (package name is the only interpolation, never shell-executed — argv-array discipline preserved).
- No bare `latest`: only occurrence is the pinned registry path `/<name>/latest` for manifest fetch; `grep -n latest src/core/classifier.js` (minus registry URL) → no hits.
- No stubs: `grep -rni TODO|FIXME|not implemented|stub` on touched files → no hits; `src/core/classifier.js` is byte-identical to the reference (`cmp` clean apart from the copy).
- Determinism: scoring is pure (no timestamps/randomness); `--json` output key order stable.
- Working tree: `git status --short` shows only Stage 1 mods (`bin/agent-builder.js`, `src/core/compiler.js`, `src/core/importer.js`, `src/server/local-server.js`, `docs/reports/v2-stage1.md`) plus `M scripts/scout.js`, `?? src/core/classifier.js`, `?? test/classifier.test.js`, `?? docs/reports/v2-stage2.md`. Nothing committed/pushed.
