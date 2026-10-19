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
