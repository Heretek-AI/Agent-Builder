# Implementation Notes & Decisions Log

## Milestone 1 — Repository Initialization, Toolchain Setup & Verification Spike (2026-10-19)

- Created `.gitignore` with `node_modules/`, `_site/`, `.scratch/`, `.env`, `*.log`, `.DS_Store`.
- Wrote `package.json` verbatim from brief Section 5 (`@heretek-ai/agent-builder@0.1.0`, `ajv ^8.17.1`, `ajv-formats ^3.0.1`, `js-yaml ^4.1.0`, `test` script uses `node scripts/run-tests.js` with no quoted globs).
- Created `scripts/run-tests.js` (recursive `*.test.js` discovery under `test/`, runs via `execFileSync(process.execPath, ['--test', ...files], { stdio: 'inherit' })`).
- Created `scripts/spike-verify.js` verbatim from brief Section 6 (deny-first skill scoping + MCP normalization assertions).
- Evidence:
  - Command: `npm install` -> exit `0` (`found 0 vulnerabilities`), Node `v26.10.0`, npm `11.19.1`.
  - Command: `npm run spike` -> stdout `SPIKE_VERIFY_OK`, exit `0`.
  - Command: `npm test` -> stdout `run-tests: no test/ directory found, nothing to run.`, exit `0` (no `test/` dir yet; runner handles absence gracefully).
  - Command: `git check-ignore -v node_modules .scratch` -> `.gitignore:1:node_modules/` and `.gitignore:3:.scratch/` both matched.
  - Command: `git status --ignored` (with a temp file in `.scratch/`) -> Ignored files list shows both `.scratch/` and `node_modules/`. Note: an empty `.scratch/` dir is not listed by `git status --ignored` (git does not track/show empty dirs); ignore rule itself verified via `git check-ignore`.
- No blockers. 0 failed attempts.

## Milestone 2 — Taxonomy, Schema & Validator (2026-10-19)

- Wrote `data/taxonomy.json` verbatim from brief Section 4 (version `1.0.0`, 8 harnesses, 6 top-level categories with all children).
- Wrote `data/schema.json` (Draft-07 `$schema: http://json-schema.org/draft-07/schema#`, `required: [id, name, repo, tagline, description, kind, category, harnesses]`, `additionalProperties: false`, kind enum `[plugin, skill, mcp-server, design-md, prompt, agent, agent-preset]`, id pattern `^[a-z0-9][a-z0-9-]*$`, `repo`/`homepage`/`mcp.url` as `uri` format, optional `path/npm/homepage/languages/platforms/mcp/agent_preset/content_file/tags/compat/scope/min_version/installation/license/source_attribution`).
- Wrote `scripts/utils/catalog.js` (CommonJS `require`) exporting `loadTaxonomy` (Set of all branch+leaf IDs plus lookup map), `walkYamlFiles` (recursive `.yaml`/`.yml` discovery, sorted), `loadCatalog(rootDir, targetFiles)` (js-yaml parse, Ajv + ajv-formats with regex `uri` fallback, taxonomy membership check, global id uniqueness, duplicate `(repo, path, kind, id)` tuple check; returns `{ entries, errors }`), and `validateEntryObject(obj, rootDir)` (fresh Ajv compile, returns `{ valid, errors }`).
- Wrote `scripts/validate.js` (resolves `rootDir` via `path.join(__dirname, '..')`, calls `loadCatalog`, prints `VALIDATED <N> ENTRIES OK` or `ERROR:` lines to stderr with exit `1`).
- Created 15 seed YAML entries covering all required categories: `plugins/opencode`, `plugins/claude-code`, `skills/coding/c-cpp`, `skills/coding/rust`, `skills/coding/lua`, `skills/design/webui`, `skills/design/desktop-linux`, `skills/design/mobile-android`, `skills/cybersecurity/reverse-engineering`, `skills/cybersecurity/malware-analysis`, `skills/cybersecurity/security-auditing`, `mcp-servers/databases` (with `mcp` block: `server_name postgres-prod`, `transport stdio`, `command/tools/resources`), `design-md/ai-dev-tools`, `prompts/security-research`, `agents/security-auditors` (with `agent_preset` block: `mode subagent`, skills + `mcp_selections`).
- Decisions: kind enum includes `agent-preset` alongside the 6 folder-derived kinds to avoid over-constraining future presets while still validating; `validateEntryObject` uses schema-only validation (no taxonomy check) so `{ id: 'Bad_ID' }` fails on both pattern and missing required fields.
- Evidence:
  - Command: `npm run validate` -> stdout `VALIDATED 15 ENTRIES OK`, exit `0`.
  - Command: `node -e "const { validateEntryObject } = require('./scripts/utils/catalog'); const res = validateEntryObject({ id: 'Bad_ID' }); if (res.valid) process.exit(1); console.log('NEGATIVE_CHECK_OK');"` -> stdout `NEGATIVE_CHECK_OK`, exit `0`.
- No blockers. 0 failed attempts.

## Milestone 3 — Registry Compiler & Content Bundler (2026-10-19)

- Wrote `scripts/export-json.js` (CommonJS `require`): parses `--pretty` (2-space indent) and `--output <filepath>` (default `dist/registry.json`, `--help` supported, unknown/missing args fail closed with exit `1`); fail-closed on any `loadCatalog` error (prints `ERROR:` lines, exit `1`); reads raw `data/taxonomy.json` for output; sorts entries deterministically by `category` then `id`; computes `stats: { total, by_kind, by_category, by_harness }`; emits `{ version: "1.0.0", repository: "https://github.com/Heretek-AI/Agent-Builder", registry_url: "https://heretek-ai.github.io/Agent-Builder/registry.json", generated_at: <ISO>, stats, taxonomy, entries }`; content bundler copies each entry's `content_file` (resolved relative to repo root) to `dist/content/<id>.md` (`fs.mkdirSync` recursive for both dirs), warns `WARNING: content_file ... not found; skipping.` without failing when missing; writes JSON with trailing newline; prints `EXPORTED <N> ENTRIES -> <relpath>`.
- Ran `npm run export` (`node scripts/export-json.js --pretty --output dist/registry.json`) to generate `dist/registry.json` + `dist/content/` (empty: none of the 15 seed entries set `content_file`, so all copies skipped with no warnings).
- Evidence:
  - Command: `npm run export && node -e "const r = require('./dist/registry.json'); if (!r.entries || r.entries.length < 12 || !r.taxonomy) process.exit(1); console.log('EXPORT_OK:', r.entries.length);"` -> stdout `EXPORTED 15 ENTRIES -> dist/registry.json` + `EXPORT_OK: 15`, exit `0`.
  - Detail check: `version 1.0.0`, `repository`/`registry_url` exact, `generated_at` ISO-parseable, `stats.total === entries.length (15)`, `by_kind {"agent":1,"design-md":1,"mcp-server":1,"plugin":2,"prompt":1,"skill":9}`, entries sorted by `category,id`, file pretty-printed (starts `{\n  "version"`), exit `0`.
  - Command: `node scripts/export-json.js --output /tmp/opencode/registry-test.json` -> stdout `EXPORTED 15 ENTRIES` + `CUSTOM_OK: 15`, exit `0` (custom `--output` outside repo works; temp file left in `/tmp/opencode/`, not in repo).
  - `ls dist/ dist/content/` -> `dist/registry.json` (30844 bytes) + empty `dist/content/`.
- No blockers. 0 failed attempts.
