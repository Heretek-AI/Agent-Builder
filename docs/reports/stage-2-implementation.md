# Stage 2 Implementation Report — P0 Catalog + Compiler Correctness

- Stage ID: Stage 2 (Fleet Audit Remediation)
- Date (UTC): 2026-10-19
- Source findings: `AUDIT_REPORT_FINDINGS.md` §§ AB-1.2-example-repos,
  AB-1.2-dead-mcp-repos, AB-7.5-k8s-tools, AB-7.5-notion-tools,
  AB-7.5-filesystem-exec, AB-7.5-figma-tools, AB-7.5-postgres-ungrounded,
  AB-2.5-codex-transport, AB-7.4-hyphen-normalization,
  AB-7.4-claude-transport-key, AB-6.1-npm-never-published,
  AB-1.2-sst-opencode-redirect.

## Summary of deliverables

Fail-closed catalog remediation (15 synthetic markers with zero invented
upstreams; 5 MCP servers re-grounded against live `tools/list` output; 2
dead repos replaced with curl-200 successors; org rename) plus compiler
correctness (Codex `command`/`args`/`env` transport, hyphen-preserving
normalization in compiler+importer, non-spec Claude `transport` key dropped
in favor of url→type mapping). README regenerated from the fixed template
(Quick Start no longer claims the unpublished `npx` path). 63 entries kept;
75/75 tests pass. Stage 1 files untouched.

## Files created / modified

| File | Change |
|------|--------|
| `data/schema.json` | Appended optional `synthetic: {type:boolean}`; `content_file` pattern byte-identical to Stage 1. |
| 15× `data/**/*.yaml` (`plugins/opencode/opencode-session-hooks`, `plugins/claude-code/claude-slash-bundle`, 8 skills, `postgres`→(see below), `design-md`, `prompt`, `db-security-auditor`→(see below)) | `repo` → `https://github.com/Heretek-AI/Agent-Builder` (curl 200) + `synthetic: true` + `Synthetic seed entry (no external upstream, …)` attribution. Postgres + db-security-auditor instead got real upstreams (below). Net: 14 synthetic + postgres real = 15 files, 0 `github.com/example` hits. |
| `data/mcp-servers/cloud-devops/k8s-observe-mcp.yaml` | Tools → `kubectl_get/kubectl_describe/kubectl_logs` (live 23-tool list vs 4.1.9) + provenance comment. |
| `data/mcp-servers/knowledge-productivity/notion-knowledge-mcp.yaml` | Repo → `makenotion/notion-mcp-server` (200, MIT); tools → `API-post-search/API-retrieve-a-page/API-post-page` (live 24-tool list vs 2.5.2). |
| `data/mcp-servers/filesystem-shell/filesystem-shell-mcp.yaml` | Dropped invented `execute_command` (live 14-tool list vs 2.0.0 has none). |
| `data/mcp-servers/design-ui/figma-design-mcp.yaml` | Repo → `planetabhi/figma-mcp-server` (200; npm `repository.url` match); tools → `get_figma_file/render_images/list_components` (live 50-tool list vs 3.1.2). |
| `data/mcp-servers/databases/postgres-mcp-connector.yaml` | Repo → `kristofer84/mcp-postgres` (200, MIT), npm `mcp-postgres` (1.4.2); tools → `execute_query/list_tables/describe_table` per published README; `synthetic: false`. |
| 3 agent presets (`db-security-auditor`, `sre-database-agent`, `frontend-design-agent`) | `mcp_selections` rescoped to the real tool names above. |
| 2 plugin entries (`opencode-native-toolchain`, `harness-adapter-kit`) | `sst/opencode` → `anomalyco/opencode` (redirect target, 200). |
| `src/core/compiler.js` | `normalizeMcpId` → `/[^a-zA-Z0-9_-]+/g` (hyphens/underscores preserved); new `serverTransport()` shared by Claude (no `transport` key; url→`{type,url}`) and Codex (`command`/`args` + `env` when present; url passthrough). |
| `src/core/importer.js` | Identical `normalizeMcpId` + cross-reference comment. |
| `scripts/generate-readme.js` | Template: `node bin/agent-builder.js serve` Quick Start + `npm pack` + `npm view` 404 known-gap note; hyphen-preserving scoping snippet + normalization note. |
| `README.md`, `dist/registry.json`, `_site/` | Regenerated (export/generate/site). |
| `test/compiler.test.js` (+3 net) | Hyphen expectations; no-`transport` assert; codex `command`/`args`/`env` + bare-placeholder test; remote url→type test; hyphen fail-open guard test. |
| `test/mcp.test.js` | `postgres-prod_query` expectation. |
| `REMEDIATION_LOG.md` | Stage 2 section appended (per-finding table, curl proofs, files, outputs, sabotage). |

Explicitly NOT edited (Stage 1 / later stages): `src/server/local-server.js`,
`test/local-server.test.js`, `src/mcp/server.js`, `scripts/export-json.js`
(content), `.github/workflows/*`, `package.json`, `scripts/check-pr.js`,
`scripts/ai-review.js`, `site/app.js` (AB-5.2 install-slug stays a separate
stage), `scripts/import/seed-all.js` (stale seeds logged as residual).

## Test results

```
$ npm run validate
VALIDATED 63 ENTRIES OK
$ npm run site
SITE_BUILT _site/ with 63 registry entries
$ npm test
ℹ tests 75 / suites 27 / pass 75 / fail 0
```

Proofs: `grep -r github.com/example data/` → 0; `grep sst/opencode
data/ README.md docs/ site/` → 0; codex TOML contains `command = "npx"`;
`normalizeMcpId('postgres-prod')` → `postgres-prod`.

## Self-audit notes

- Fail-closed: no upstream URL invented — every real repo has a curl-200
  proof in the log; the 14 unresolvable placeholders are explicit
  `synthetic: true` pointing at the registry's own (200) repo, schema-gated.
- Postgres grounding is README-documented (not live-listed) because both
  candidate servers require a live DB at startup and the official package is
  npm-deprecated; this limitation is stated in the entry comment and the log.
- Hyphen decision documented in code + log: matches upstream OpenCode
  `tool/mcp.ts` and Claude `mcp__plugin_my-plugin_…` style; deny rules now
  match real action names instead of missing fail-open.
- Sabotage tripwires (backup/restore, tree restored): old strip-hyphen
  regex → 13/15 RED; removed codex `command` push → 26/2 RED; restored → GREEN.
- No network exfiltration beyond version/proof reads; no writes outside repo
  except `/tmp` probe scripts and the compiler backup (both outside repo).
- `git status` shows no modifications to Stage 1 files beyond their
  pre-existing Stage 1 diff (`local-server.js`, `mcp/server.js`,
  `export-json.js`, `bin/agent-builder.js` were already modified before
  Stage 2 began; verified via `git diff` content = Stage 1 allowlist work).
