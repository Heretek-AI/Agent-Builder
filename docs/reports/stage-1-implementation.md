# Stage 1 Implementation Report — Local Bridge + content_file Hardening

- Stage ID: Stage 1 (Fleet Audit Remediation)
- Date (UTC): 2026-10-19
- Source findings: `AUDIT_REPORT_FINDINGS.md` §§ AB-5.6-introspect-rce,
  AB-5.4-bridge-untested, AB-5.5-chat-untested, AB-5.6-introspect-untested,
  AB-5.4-content-file-read, AB-5.4-targetdir-unrestricted,
  AB-5.5-ssrf-private-range.

## Summary of deliverables

Fail-closed hardening of the local bridge server (`src/server/local-server.js`),
`content_file` containment across schema/export/MCP, and a 29-test regression
file (`test/local-server.test.js`) with sabotage tripwires. No catalog entries
touched (still 63). No publish/push/secrets. Minimal diff.

## Files created / modified

| File | Change |
|------|--------|
| `src/server/local-server.js` | `MCP_COMMAND_ALLOWLIST={npx,node,python3}` via `path.basename`; argv-only `spawn`, no `shell`; loopback-only CORS (no `*` on `/api/*`); per-boot `crypto.randomUUID` token (`x-ab-token`/`?token=`, 401; `GET /api/status` exempt, token logged `AGENT_BUILDER_LOCAL_TOKEN`); SSRF gate (`assertBaseUrlPermitted`: private ranges + userinfo → 400, `--allow-loopback-llm` loopback-only, no redirect following); `assertHttpTargetDir` (absolute/`..`/decoded `%2e%2e` → 400); test exports. |
| `bin/agent-builder.js` | `serve --allow-loopback-llm` parse + passthrough only. |
| `data/schema.json` | `content_file` → `pattern: ^(?!/)(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./-]*\.md$`. |
| `scripts/export-json.js` | Export containment: reject absolute/traversal/URL/non-.md/repo-escape, warn + skip, never copy. |
| `src/mcp/server.js` | `isSafeContentFileRef` + `readBundledContent` fail-closed (`null` for absolute/`..`/URL/non-.md); exports added. |
| `test/local-server.test.js` | NEW — 29 tests: traversal, baseUrl matrix, introspect matrix, CORS/token, static traversal, content_file schema+MCP. Header documents sabotage-verify. |
| `REMEDIATION_LOG.md` | Created; Stage 1 section with per-finding status + commands/outputs. |
| `scripts/build-site.js` | Unchanged (only copies `dist/content/*.md`). |

Explicitly NOT edited: `.github/workflows/*`, `package.json` engines,
`data/**/*.yaml`, `src/core/compiler.js` (later stages).

## Test results

```
$ npm run validate
VALIDATED 63 ENTRIES OK
$ npm run site
SITE_BUILT _site/ with 63 registry entries
$ npm test
ℹ tests 72 / pass 72 / fail 0   (43 pre-existing + 29 new)
```

`generate-rigs.py` / `verify-rigs.sh` do not exist; real equivalents used
(see REMEDIATION_LOG.md).

## Self-audit notes

- Fail-closed everywhere: invalid states reject with descriptive 400/401/403,
  never permissive defaults.
- CORS: no wildcard string remains on any `Access-Control-Allow-Origin` line
  (verified by test + `rg`).
- Spawn: `rg shell` shows only comments; `shell: true` sabotage → RED.
- Token: fresh `crypto.randomUUID` per `startLocalServer`, exposed as
  `server.bootToken`, required on all three `POST /api/*` routes; both header
  and `?token=` paths tested.
- SSRF: literal-IP + userinfo blocked; DNS resolution not performed (meets
  "at minimum" bar); loopback flag does not open RFC1918 (tested).
- targetDir: raw + decoded `..` and absolute blocked; bundle-path
  `isSafeRelPath` + `path.resolve` containment retained.
- Sabotage checks performed on a backup/restore cycle, working tree restored
  byte-identical (`diff` clean): gut `isSafeRelPath` → 28/1 RED; `if(false)`
  gate → 27/2 RED; `shell:true` → 28/1 RED.
- No network exfiltration, no writes outside repo except `/tmp` markers
  (asserted absent) and `/tmp/opencode` backup (outside repo).
