# v2 Stage 1 Implementation Report — Multi-Client Compiler & Importer (10 Targets)

- Stage ID: v2-stage1
- Date (UTC): 2026-10-20
- Branch: `feat/agent-builder-v2` (worktree `/tmp/opencode/agent-builder-v2`)
- Reference bundle: `/tmp/opencode/uploads/f81fd801b59078/Agent-Builder-v2.zip` → `/tmp/opencode/v2-extract/Agent-Builder`
- Ground truth read: `docs/NOTES.md`, `data/schema.json`, `src/core/compiler.js`, `bin/agent-builder.js`, `src/server/local-server.js`

## Summary of deliverables

Implemented the v2 Multi-Client Compiler & Importer covering all 10 targets with fail-closed validation, no bare `latest`, no stubs:

1. `opencode-v2` — `opencode.<slug>.v2.json` (deny-first `permissions` array)
2. `opencode-v1` — `opencode.<slug>.v1.json` (deny-first `permission` object)
3. `opencode-md` — `.opencode/agent/<slug>.md` (frontmatter + prompt)
4. `pi` — `.pi/settings.json` (`$schema: https://pi.dev/schemas/settings.schema.json`, `defaultProvider/defaultModel` split, `defaultThinkingLevel`, `defaultTools`, `skills`) + `.pi/mcp.json` (`toolExposure` codemode/direct/hidden, `exposure` wildcard→default / explicit→hidden) + `AGENTS.md` (System Instructions + Enabled Skills)
5. `claude-code` — `.claude/agents/<slug>.md` + `.mcp.json` (registry transport, `Skill` tool, `mcp__<server>__<tool>`, no `transport: stdio` key)
6. `codex` — `config.toml` (`[mcp_servers.<server>]` with real `command/args/env`, `enabled_tools`/`disabled_tools`)
7. `gemini` — `.gemini/settings.json` (`mcpServers` + `includeTools`/`excludeTools`, `contextFileName: GEMINI.md`) + `GEMINI.md`
8. `cursor` — `.cursor/rules/<slug>.mdc` (frontmatter `description/globs/alwaysApply` + prompt + Scoped Skills) + `.cursor/mcp.json`
9. `windsurf` — `.windsurfrules` + `.windsurf/mcp_config.json` (`mcpServers`)
10. `copilot` — `.github/copilot-instructions.md` + `.vscode/mcp.json` (`servers`)

Round-trip importer handles: v2/v1 JSON, `.mcp.json`/`mcpServers`, `.vscode/mcp.json` (`servers`), `.gemini/settings.json` (`includeTools`/`excludeTools`), Pi `mcp.json` (`toolExposure`/`exposure`), Pi `settings.json` (`pi.dev/schemas/settings` or `defaultTools`/`defaultThinkingLevel`), `.opencode/agent/*.md` permission frontmatter, `.claude/agents/*.md` (`mcp__*` + skill refs), `.cursor/rules/*.mdc` frontmatter + generic skill sections, and plain `AGENTS.md`/`GEMINI.md`/`.windsurfrules`/`copilot-instructions.md` (prompt + skill extraction, fail-closed otherwise).

Probe artifact `docs/reports/v2-probe.md` deleted first (clean `git status`). No commit/push per instructions.

## Files created / modified

| File | Change |
|------|--------|
| `src/core/compiler.js` | Ported v2 reference (`traceV2Permission`, `PI_SETTINGS_SCHEMA_URL`, `buildPiOutputs`, `buildAdditionalClients`); extended bundle from 11 → 18 files to include every computed output (`AGENTS.<slug>.md`, `GEMINI.<slug>.md`, `.cursor/mcp.<slug>.json`, `.windsurf/mcp_config.<slug>.json`, `.windsurfrules.<slug>`, `.vscode/mcp.<slug>.json`, `.github/copilot-instructions.<slug>.md`); expanded `mkdir -p` + echo lines for all 10 canonical install locations; preserved deny-first ordering, normalization, fail-closed throws, no `latest`. |
| `src/core/importer.js` | Ported v2 reference (`recipesFromMcpServers` with `toolExposure`/`includeTools`/`excludeTools`, `recipesFromPiSettings`, `.mdc` routing, `servers` support); added `extractGenericSkills` (`.claude/.pi/.windsurf` SKILL.md + `.cursor/rules` + backticked/ plain skill sections), `recipeFromPlainMarkdown`, `isMarkdownFilename`/`isPlainMarkdownFilename` (plain only for `AGENTS`/`GEMINI`/`windsurfrules`/`copilot-instructions`; other `.md` without `---` still throws `/must start with ---/`); preserved comment stripping, longest-prefix matcher, deny-only warn, descriptive rejections. |
| `bin/agent-builder.js` | Ported v2 `VALID_HARNESSES` (10) + `renderCompiled` for `pi/gemini-cli/cursor/windsurf/copilot`; added `gemini` alias + `canonicalHarness` (`gemini`→`gemini-cli`, `claude`→`claude-code`); fail-closed unknown harness. |
| `src/server/local-server.js` | Extended `installRecipeFiles.validHarnesses` to all 10 + aliases (`claude`, `gemini`); bundle-path traversal checks unchanged. |
| `docs/reports/v2-stage1.md` | NEW — this report. |

Explicitly NOT edited: `data/schema.json` (identical in reference), `src/server/local-server.js` SSRF/CORS/token logic, `src/mcp/server.js`, `scripts/build-site.js`, `site/*`, `data/**`, workflows.

## Diff vs worktree (pre-stage)

- `src/core/compiler.js`: `diff` showed +~246 lines in reference (Pi/Gemini/Cursor/Windsurf/Copilot exporters, `traceV2Permission`, `PI_SETTINGS_SCHEMA_URL`, install dirs); stage adds 7 more bundle entries + full install echo on top of reference.
- `src/core/importer.js`: `diff` showed +~39 lines in reference (MCP-servers variants, Pi settings, `.mdc`); stage adds ~60 lines (generic skill extraction, plain-markdown fallback with fail-closed guard).
- `bin/agent-builder.js`: `diff` showed harness list 5→10 + 5 render cases; stage adds 1 alias entry + `canonicalHarness`.
- `src/mcp/server.js`, `src/server/local-server.js` (except harness list), `data/schema.json`, `package.json`, all `test/*.test.js`: `diff -q` clean (no drift).

## Test results

```
$ node scripts/run-tests.js
ℹ tests 131
ℹ suites 40
ℹ pass 131
ℹ fail 0
$ node scripts/build-site.js
SITE_BUILT _site/ with 64 registry entries
$ npm run validate
VALIDATED 64 ENTRIES OK
$ node bin/agent-builder.js compile --recipe /tmp/demo-recipe.json --harness <each>
opencode-v2: OK 1756 bytes | opencode-v1: OK | opencode-md: OK | pi: OK
claude-code: OK | codex: OK | gemini/gemini-cli: OK 434 bytes
cursor: OK | windsurf: OK | copilot: OK | bogus: exit 1 fail-closed
$ node bin/agent-builder.js install --recipe /tmp/demo-recipe.json --target-dir /tmp/demo-inst3 --dry-run
DRY_RUN install demo -> /tmp/demo-inst3 [opencode-v2] + 18 would-write lines
```

Initial regression: `rejects unknown shapes` failed (`agent.md` without frontmatter now parsed as plain). Fixed by restricting plain fallback to `AGENTS`/`GEMINI`/`windsurfrules`/`copilot-instructions` only; re-run 131/131 pass. No test files modified.

Manual round-trip checks: Pi `toolExposure` (codemode/hidden), Gemini `includeTools`/`excludeTools`, `.vscode/mcp.json` (`servers`), Pi `settings.json` (`anthropic/claude-sonnet-4-5` + `skills`), `.cursor/rules/demo.mdc` (skill `my-skill`), `GEMINI.md`/`AGENTS.md`/`.windsurfrules`/`copilot-instructions.md` skill preservation, and v2 compile→import→recompile deep-equal all OK.

## Self-audit notes

- Fail-closed: all unknown harnesses/shapes/effects throw with descriptive messages; omitted `tools` stays deny-only; `evaluateV2Permission`/`normalizeEffect` reject bad rules; `isSafeRelPath` + `path.resolve` containment unchanged; `agent.md` garbage still throws `/must start with ---/`.
- No bare `latest`: `grep -rn latest src/core/compiler.js src/core/importer.js bin/agent-builder.js src/server/local-server.js` → no hits; Pi/Gemini models default to explicit `anthropic/claude-sonnet-4-5`-style strings only when recipe provides them, else omitted (no empty `model:` line).
- No stubs: `grep -rni TODO|FIXME|not implemented|stub` on touched files → no hits; every `bundleFiles` entry has non-empty string content (existing `compiler.test.js` asserts this).
- Transport safety: Claude/Codex/Pi/Gemini/Cursor exports reuse `serverTransport` (registry `command/args/env` or safe `npx -y <server>` placeholder, remote `url`→`type/url`, never `transport: stdio`); install script is `mkdir -p` + `echo` only, single-quote-escaped slug, no secrets.
- Determinism: key order stable (v2 permissions, v1 insertion order, bundle order); no timestamps in compiler outputs.
- Working tree: `git status --short` shows only `M bin/agent-builder.js`, `M src/core/compiler.js`, `M src/core/importer.js`, `M src/server/local-server.js` plus untracked `docs/reports/v2-stage1.md`. Nothing committed/pushed.
