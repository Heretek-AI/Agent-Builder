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
