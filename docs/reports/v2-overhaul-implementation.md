# v2-overhaul Finalization Implementation Report — Stage v2-overhaul

- Stage ID: v2-overhaul
- Date (UTC): 2026-10-20
- Branch: `feat/agent-builder-v2` (worktree `/tmp/opencode/agent-builder-v2`)
- Reference bundle: `/tmp/opencode/v2-extract/Agent-Builder` (Stages 1–3 done, 147 tests pass at entry)
- Prior reports: `docs/reports/v2-stage1.md`, `v2-stage2.md`, `v2-stage3.md`

## Summary of deliverables

Finalized the v2 overhaul with zero regressions and two catalog additions:

1. **v2-overhaul.test.js port check — absent, deviation documented (see §Deviations).**
   `/tmp/opencode/v2-extract/Agent-Builder/test/` contains exactly 6 suites
   (`catalog-negative`, `catalog`, `compiler`, `local-server`, `mcp`, `stage4`) —
   no `v2-overhaul.test.js` exists anywhere in the reference drop. Nothing to port.
2. **v2 coverage closed in-suite (10 new tests, all passing).** Verified the
   checklist item-by-item against the 7 local suites and closed the two real gaps:
   - Compiler 10 targets: already covered by `test/compiler.test.js` (deny-first
     v2/v1/markdown, claude/codex/install/bundle, `?` simulator, resource scoping,
     round-trips) — extended with a new `v2-overhaul` block asserting all 19
     export keys, Pi outputs, Gemini/Cursor/Windsurf/Copilot outputs, and the
     18-file slug-qualified bundle.
   - Classifier tiers + scout classify: already covered by `test/classifier.test.js`
     (return contract, Tier-1/Tier-2, Tier-3 word-boundary, Tier-4 topics, scout
     `parseClassifyArgs`/`formatClassifyHuman`/delegation). No change needed.
   - Site presets: previously manual-only (v2-stage3 bin verification) — added an
     in-suite block asserting all 5 preset options in `site/index.html` and the
     `pi-codemode-architect` fallback + 11-tab `TAB_FILES` wiring in `site/app.js`.
   - `traceV2Permission`: previously untested (defined in `src/core/compiler.js`,
     consumed by `site/app.js` behind a feature guard) — added an in-suite block
     for winning-rule index/rule/trace flags, the allow-by-default empty case,
     and fail-closed throws.
3. **`data/plugins/cross-harness/` Pi entries created (were missing from the drop).**
   The reference bundle ships only `harness-adapter-kit.yaml` +
   `litellm-router-bridge.yaml` (byte-identical locally); no `earendil-works/pi`
   or `pi-review` yamls exist anywhere in the drop (`grep -ril` hits are
   code-level only: `site/app.js` SCOUT_SAMPLES, `scripts/scout.js` Pi queries,
   `src/core/compiler.js` + `classifier.js` Pi detection). Created two minimal
   valid yamls, each schema-checked, taxonomy-leaf-checked
   (`plugins/cross-harness`), classifier-aligned
   (`plugin / plugins/cross-harness / [universal]`, verified live via
   `classifyManifest`), with a concrete pinned install string and a real source
   URL — no placeholders, no bare `latest`:
   - `pi-coding-agent.yaml` — repo `https://github.com/earendil-works/pi`
     (GitHub API 200, `main`, MIT), `path: packages/coding-agent` (real monorepo
     path), `npm: @earendil-works/pi-coding-agent` (published, verified),
     install `npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.3.0`
     (1.3.0 = live registry latest + highest `v1.3.0` git tag, pinned — the
     upstream README's alternative `curl https://pi.dev/install.sh | sh` is noted
     but the pinned npm form is recorded to satisfy no-float policy).
   - `pi-review.yaml` — repo `https://github.com/earendil-works/pi-review`
     (GitHub API 200, `main`, MIT, "A review extension for Pi"), install
     `pi install git:github.com/earendil-works/pi-review` (verbatim upstream
     README command; the package is not published to npm — registry returns
     `Not Found` — and the repo has zero git tags, so no pin exists to record;
     no `npm:` field claimed). `review.ts` at repo root confirmed via contents API.
4. **Full gates re-run, tails captured (see §Test results).** No regressions.

## Files created / modified

| File | Change |
|------|--------|
| `data/plugins/cross-harness/pi-coding-agent.yaml` | NEW — Pi harness entry (pinned npm install, real repo/path/npm, MIT). |
| `data/plugins/cross-harness/pi-review.yaml` | NEW — Pi review-extension entry (verbatim upstream install, real repo, MIT). |
| `test/stage4.test.js` | +10 tests in 3 `v2-overhaul` describes (trace, 10-target exports, site presets). No existing test touched. |
| `docs/reports/v2-overhaul-implementation.md` | NEW — this report. |

Explicitly NOT committed or pushed (per instructions); `_site/` rebuilt locally
(66 entries) as a build artifact only.

## Test results

```
$ npm run validate
VALIDATED 66 ENTRIES OK   (was 64; +2 Pi entries)

$ npm run site
SITE_BUILT _site/ with 66 registry entries

$ node scripts/run-tests.js
ℹ tests 157 | suites 49 | pass 157 | fail 0   (was 147/46; +10 new, 0 regressions)
```

Targeted re-verification (all exit 0, fail-closed):
- `classifyManifest` live probe: `@earendil-works/pi-coding-agent` →
  `plugin / plugins/cross-harness / [universal]` (conf 84); `@earendil-works/pi-review` →
  `plugin / plugins/cross-harness / [universal]` (conf 84) — matches the new yamls exactly.
- Upstream liveness (no placeholders): GitHub API 200 for both repos; npm
  `@earendil-works/pi-coding-agent@1.3.0` resolved with tarball + integrity;
  `@earendil-works/pi-review` confirmed npm-absent (hence git-based install);
  `pi-review` README install string fetched verbatim from `main`.

## Self-audit notes

- Zero-stubs: `grep -rni "TODO.*implement|dummy.*pass|TODO:" test/stage4.test.js
  `data/plugins/cross-harness/pi-*.yaml` → no hits; every new assertion checks
  exact behavior (winning-rule index, 18-file bundle list, 5 preset option values).
- Fail-closed: new yamls validate against `data/schema.json` + taxonomy leaf set
  via the same `loadCatalog` gate as all entries (`duplicate id` pre-checked —
  none); `traceV2Permission` tests assert throws on non-array permissions and
  invalid effects; site-preset tests read the real `site/` files (no mocks).
- No placeholders / no bare latest: both `repo:` URLs returned HTTP 200 from
  GitHub; both install strings are executable as written (pinned `1.3.0` npm;
  verbatim upstream `pi install git:…` where no published version exists —
  documented, not floated).
- Determinism: catalog grows 64 → 66 through data files only; compiler, importer,
  classifier, site, and bin untouched, so the 147 baseline assertions are
  unaffected (confirmed 157/157).
- Working tree: `git status --short` shows only Stage 1–3 carryover mods plus
  `M test/stage4.test.js` and the 4 new files above. Nothing committed or pushed.

## Deviations

1. **Missing `v2-overhaul.test.js` in the reference drop.** The task's Stage-4
   checklist assumes a `v2-overhaul.test.js` file in
   `/tmp/opencode/v2-extract/Agent-Builder/test/` to port. That file does not
   exist (drop holds 6 suites; verified by directory listing). Resolution: no
   port performed; instead the v2 surface (compiler 10 targets, classifier
   tiers, scout classify, site presets, `traceV2Permission`) was verified
   against the 7 local suites and the 2 genuine gaps (`traceV2Permission`,
   site presets) plus 10-target export depth were closed with 10 new in-suite
   tests (157/157 pass).
2. **Missing `earendil-works/pi` and `pi-review` yamls in the reference drop.**
   The task's harness-entry step assumes these exist upstream to inspect/copy.
   They do not (drop `data/` is byte-identical to local; Pi support there is
   compiler-level only). Resolution: authored both entries from live upstream
   ground truth (GitHub API + npm registry + upstream README fetched 2026-10-20)
   as documented above, rather than copying.
