# REMEDIATION_LOG — Fleet Audit Remediation

## Stage 1 — Local bridge + content_file hardening (2026-10-19)

Scope: AB-5.6-introspect-rce, AB-5.4-targetdir-unrestricted,
AB-5.5-ssrf-private-range, AB-5.4-content-file-read, AB-5.4-bridge-untested,
AB-5.5-chat-untested, AB-5.6-introspect-untested.

NOTE: `scripts/generate-rigs.py` / `scripts/verify-rigs.sh` do not exist in
this repo. Real equivalents used instead: `npm run validate`, `npm run site`,
`npm test` (node scripts/run-tests.js), `node scripts/ai-review.js selftest`
(not run in Stage 1 — rubric enforcement is a later stage). No publish, no
push, no secrets. Loopback-only verification servers killed after use.

### Per-finding status

| ID | Status | Evidence |
|----|--------|----------|
| AB-5.6-introspect-rce | FIXED | `MCP_COMMAND_ALLOWLIST={npx,node,python3}` via `path.basename`; `spawn` argv-only, no `shell:true`; no `Access-Control-Allow-Origin: *` on `/api/*` (loopback-echo only); per-boot `crypto.randomUUID` token required on all `POST /api/*` (`x-ab-token` or `?token=`), 401 otherwise; `GET /api/status` exempt. `touch` probe → 400 `command not allowlisted`, marker absent. |
| AB-5.4-targetdir-unrestricted | FIXED | `assertHttpTargetDir` rejects absolute + any `..` segment (raw or `decodeURIComponent`-decoded) with 400 before `installRecipeFiles`. `..` and `/etc/gamma-pwn` → 400. Rel-layer `isSafeRelPath` + `path.resolve` containment intact. |
| AB-5.5-ssrf-private-range | FIXED | `assertBaseUrlPermitted` denies 10/8, 172.16/12, 192.168/16, 169.254/16, 127/8, `::1`, `0.0.0.0` + rejects `username:password@` userinfo → 400 `baseUrl target not permitted`. `--allow-loopback-llm` permits loopback only (never RFC1918). `https?` gate kept. Upstream uses raw `http/https.request` with no redirect following (manual — 3xx relayed, never followed). `POST /api/llm/chat {"baseUrl":"http://10.255.255.1:9"}` → 400. |
| AB-5.4-content-file-read | FIXED | `data/schema.json`: `content_file` → `pattern: ^(?!/)(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./-]*\.md$`. `scripts/export-json.js`: rejects absolute/traversal/URL/non-.md + repo-escape, warns + skips. `src/mcp/server.js`: `isSafeContentFileRef` + `readBundledContent` returns `{null,null}` for absolute/`..`/URL/non-.md. `validateEntryObject` with `/etc/passwd`, `../../etc/passwd`, `https://evil` → `valid=false`. |
| AB-5.4-bridge-untested | FIXED | `test/local-server.test.js` (29 tests): traversal payloads (`..`, absolute, `/etc`, `%2e%2e`) assert 403/400. |
| AB-5.5-chat-untested | FIXED | Same file: baseUrl matrix (`file://`, `ftp://` → 400; `http://10.x` → 400; userinfo → 400; `https://example.com` passes validation). |
| AB-5.6-introspect-untested | FIXED | Same file: introspect matrix (non-allowlisted → 400; source asserts spawn lacks `shell`, argv-no-shell proof). |

### Files changed

- `src/server/local-server.js` — allowlist, token, loopback-only CORS, SSRF gate, targetDir gate, exports for tests.
- `bin/agent-builder.js` — `serve --allow-loopback-llm` passthrough (read-only reference otherwise untouched).
- `data/schema.json` — `content_file` pattern.
- `scripts/export-json.js` — export containment.
- `src/mcp/server.js` — `readBundledContent` containment + `isSafeContentFileRef` export.
- `test/local-server.test.js` — NEW (29 tests, sabotage tripwires documented in header).
- `scripts/build-site.js` — unchanged (copies only `dist/content/*.md`, no `content_file` handling needed).

### Verification commands + outputs

```
$ npm run validate
VALIDATED 63 ENTRIES OK

$ npm run site
SITE_BUILT _site/ with 63 registry entries

$ npm test
ℹ tests 72
ℹ suites 27
ℹ pass 72
ℹ fail 0
(43 pre-existing + 29 new)
```

Manual loopback probes (token via `server.bootToken`, servers killed after):

```
POST /api/mcp/introspect {"command":"/usr/bin/touch","args":["/tmp/pwn-<ts>"]}
→ 400 {"error":"command not allowed..."}; marker absent  (401 without token)
POST /api/mcp/introspect {"command":"npx","args":["--version"]} (valid token)
→ 200 or 400 MCP-timeout, never `command not allowlisted`
POST /api/install {"recipe":{"name":"t","prompt":"p"},"targetDir":"/etc/gamma-pwn"}
→ 400; {"targetDir":".."} → 400
POST /api/llm/chat {"baseUrl":"http://10.255.255.1:9",...}
→ 400 {"error":"baseUrl target not permitted"}
POST /api/llm/chat {"baseUrl":"http://user:pass@example.com/v1",...}
→ 400 {"error":"baseUrl target not permitted (userinfo not allowed)"}
GET /api/status → 200, no `access-control-allow-origin: *`
```

### Sabotage checks (all RED as required, then restored)

```
isSafeRelPath → `return true`            → 29 tests: pass 28 / fail 1 (RED)
https? gate `if (!/^https?:\/\//...)` → `if (false)` → pass 27 / fail 2 (RED)
spawn + `shell: true`                   → pass 28 / fail 1 (RED)
```

Data catalog untouched: still 63 entries (`data/**/*.yaml` not modified).

## Stage 2 — P0 Catalog + Compiler Correctness (2026-10-19)

Scope: AB-1.2-example-repos, AB-1.2-dead-mcp-repos, AB-7.5-k8s-tools,
AB-7.5-notion-tools, AB-7.5-filesystem-exec, AB-7.5-figma-tools,
AB-7.5-postgres-ungrounded, AB-2.5-codex-transport, AB-7.4-hyphen-normalization,
AB-7.4-claude-transport-key, AB-6.1-npm-never-published,
AB-1.2-sst-opencode-redirect.

Stage 1 files untouched (no regression): `src/server/local-server.js`,
`test/local-server.test.js`, `src/mcp/server.js` content handling,
`scripts/export-json.js` containment, `data/schema.json` content_file pattern
(preserved exactly; only a new optional `synthetic` key appended).
No publish/push/secrets. Minimal diffs. No invented upstream URLs — every
non-synthetic repo/tool claim below carries a curl/npm/live-tools-list proof.

### Per-finding status

| ID | Status | Evidence |
|----|--------|----------|
| AB-1.2-example-repos | FIXED | 15 files with `repo: https://github.com/example/...` → `repo: https://github.com/Heretek-AI/Agent-Builder` (curl 200, own repo) + `synthetic: true` + attribution rewritten to `Synthetic seed entry … (no external upstream, …)`. `data/schema.json`: added optional `synthetic: {type:boolean}` (content_file pattern untouched). `grep -r github.com/example data/` → 0 hits. |
| AB-1.2-dead-mcp-repos | FIXED | `Framelink/figma-mcp-server` → curl 404 (dead); `framelink-ai/figma-mcp-server` → 404 (NOT used). Replacement: `planetabhi/figma-mcp-server` → curl 200 (matches `npm view figma-mcp-server repository.url`). `makersu/notion-mcp-server` → curl 404 (dead); replacement `makenotion/notion-mcp-server` → curl 200 + GitHub API `license: MIT`. |
| AB-7.5-k8s-tools | FIXED | Live `tools/list` vs `mcp-server-kubernetes@4.1.9` (npm 200): 23 tools. Catalog `list_pods/list_deployments/get_logs` (0/3 real) → `kubectl_get/kubectl_describe/kubectl_logs` + provenance comment. `sre-database-agent` reseoped to `kubectl_get/kubectl_logs`. |
| AB-7.5-notion-tools | FIXED | Live `tools/list` vs `@notionhq/notion-mcp-server@2.5.2` (npm 200): 24 `API-*` tools. `search_pages/get_page/create_page` (0/3) → `API-post-search/API-retrieve-a-page/API-post-page` (search/retrieve/create mapping) + comment. Server kept on `@notionhq/notion-mcp-server` (real npm). |
| AB-7.5-filesystem-exec | FIXED | Live `tools/list` vs `@modelcontextprotocol/server-filesystem@2.0.0` (npm 200): 14 tools, no `execute_command`. Dropped `execute_command`; kept verified `read_file/write_file/list_directory` + comment. |
| AB-7.5-figma-tools | FIXED | Live `tools/list` (FIGMA_API_KEY=dummy) vs `figma-mcp-server@3.1.2` (npm 200): 50 tools incl. `list_components`, no `get_design_context/get_screenshot`. → `get_figma_file/render_images/list_components` + comment. `frontend-design-agent` rescoped to `get_figma_file/render_images`. Note: repo `planetabhi` declares license Other while npm metadata says MIT — recorded in entry attribution; license field left MIT per npm. |
| AB-7.5-postgres-ungrounded | FIXED | `@example/postgres-mcp` E404 → `mcp-postgres@1.4.2` (npm 200, repo `kristofer84/mcp-postgres` curl 200, MIT both sides). Tools per published README Available Tools: `execute_query/list_tables/describe_table`. Live `tools/list` impossible without a DB (server connects at startup; `@modelcontextprotocol/server-postgres@0.6.2` also deprecated per npm) — documented, README used instead. `db-security-auditor` + `sre-database-agent` rescoped to `execute_query/list_tables`. `synthetic: false` explicit. |
| AB-2.5-codex-transport | FIXED | `src/core/compiler.js` Codex block now emits `command`/`args` (registry or `npx -y <server>` placeholder) + `env` when present; remote `url` entries emit `url`; never a bare tools-only block. `node bin/agent-builder.js compile … --harness codex` → `[mcp_servers.postgres-prod]` with `command = "npx"`. New test asserts `command = "npx"` + `args = …`. |
| AB-7.4-hyphen-normalization | FIXED | Decision: preserve hyphens AND underscores — `replace(/[^a-zA-Z0-9_-]+/g,'_')` in `src/core/compiler.js:42` + `src/core/importer.js` (identical copies, cross-commented). Rationale: upstream OpenCode `tool/mcp.ts` preserves `-`, Claude Code emits `mcp__plugin_my-plugin_database-tools__query`; underscore-stripping made deny rules (`postgres-prod_*`) miss real actions fail-open. `postgres-prod` → `postgres-prod`. README scoping section, generator template, and all fixtures/tests updated. New regression test: real hyphenated actions allow/deny correctly; no `postgres_prod` rule remains. |
| AB-7.4-claude-transport-key | FIXED | Shared `serverTransport()` helper: no `transport` key emitted; remote `url` → `{type,url}` (`sse` default; `streamable-http`→`http`, `websocket` kept). Test asserts absence of `transport` + url/type mapping. |
| AB-6.1-npm-never-published | FIXED (docs) | No publish performed. `scripts/generate-readme.js` template: Quick Start now `node bin/agent-builder.js serve` + `npm pack` note + `npm view` 404 known-gap callout (AB-6.1). Regenerated README keeps `@heretek-ai/agent-builder` mention (badge/package ref) so catalog test stays green. `package.json` version `0.1.0` untouched. |
| AB-1.2-sst-opencode-redirect | FIXED | `curl -L https://github.com/sst/opencode` → 200 `https://github.com/anomalyco/opencode` (successor, archived:false per audit). Both plugin entries + descriptions/attributions → `anomalyco/opencode`. README tables auto-fixed via regeneration; `grep sst/opencode data/ README.md docs/ site/` → 0 hits. |

Residual (out of Stage 2 scope, logged): `scripts/import/seed-all.js` still
embeds the old sst/Framelink/makersu/example seeds — a one-shot seed script,
not referenced by validate/export/site/tests (`rg seed-all test/` → no hits);
regenerating it is follow-up work. `site/app.js:475` still prints the
`npx … install --slug` string (AB-5.2 P2, separate stage — install-command fix
not attempted here).

### Files changed

- `data/schema.json` — appended optional `synthetic` boolean (content_file untouched).
- `data/**/*.yaml` (15 files) — synthetic migration (own-repo URL + flag + attribution).
- `data/mcp-servers/cloud-devops/k8s-observe-mcp.yaml` — real k8s tools.
- `data/mcp-servers/knowledge-productivity/notion-knowledge-mcp.yaml` — makenotion repo + real API-* tools.
- `data/mcp-servers/filesystem-shell/filesystem-shell-mcp.yaml` — dropped `execute_command`.
- `data/mcp-servers/design-ui/figma-design-mcp.yaml` — planetabhi repo + real tools.
- `data/mcp-servers/databases/postgres-mcp-connector.yaml` — kristofer84/mcp-postgres + real tools.
- `data/agents/security-auditors/db-security-auditor.yaml`, `data/agents/devops-data/sre-database-agent.yaml`, `data/agents/design-frontend/frontend-design-agent.yaml` — rescoped to real tools.
- `data/plugins/opencode/opencode-native-toolchain.yaml`, `data/plugins/cross-harness/harness-adapter-kit.yaml` — anomalyco URLs.
- `src/core/compiler.js` — hyphen-preserving `normalizeMcpId`, `serverTransport()` (claude/codex), codex `command`/`args`/`env`, no `transport` key.
- `src/core/importer.js` — identical `normalizeMcpId` + cross-comment.
- `scripts/generate-readme.js` — Quick Start + 404 note + hyphen/normalization strings.
- `README.md`, `dist/registry.json`, `_site/` — regenerated (`npm run export/generate/site`).
- `test/compiler.test.js` — hyphen expectations, no-transport, codex `command`/`args`/`env`, remote url→type, hyphen fail-open guard (+3 tests net).
- `test/mcp.test.js` — `postgres-prod_query` expectation.

### Verification commands + outputs

```
$ npm run validate
VALIDATED 63 ENTRIES OK
$ npm run site
SITE_BUILT _site/ with 63 registry entries
$ npm test
ℹ tests 75
ℹ suites 27
ℹ pass 75
ℹ fail 0
(72 pre-existing incl. 29 Stage-1 + 3 new Stage-2)
$ grep -r "github.com/example" data/ | wc -l
0
$ node bin/agent-builder.js compile --recipe '{"name":"p","prompt":"p","skills":[],"mcp":[{"server":"postgres-prod","tools":["execute_query"]}]}' --harness codex
[mcp_servers.postgres-prod]
command = "npx"
args = ["-y", "mcp-postgres"]
enabled_tools = ["execute_query"]
$ node -e "…normalizeMcpId('postgres-prod')"
postgres-prod
```

Curl/npm proofs (2026-10-19): makersu 404 / makenotion 200 (MIT) /
Framelink 404 / framelink-ai 404 / planetabhi 200 / Flux159 200 /
modelcontextprotocol/servers 200 / crystaldba 200 / kristofer84 200 (MIT) /
sst/opencode → anomalyco/opencode 200 / own Heretek-AI/Agent-Builder 200 /
npm: mcp-server-kubernetes 4.1.9, @notionhq/notion-mcp-server 2.5.2,
figma-mcp-server 3.1.2, @modelcontextprotocol/server-filesystem 2.0.0,
mcp-postgres 1.4.2 (MIT). Live tools/list counts: k8s 23, notion 24,
filesystem 14, figma 50. Postgres live list impossible (needs DB at startup;
deprecated official 0.6.2 rejected) — published README used.

### Sabotage checks (backup/restore, all RED then GREEN)

```
normalizeMcpId → old /[^a-zA-Z0-9]+/g   → 28 tests: pass 13 / fail 15 (RED)
codex `command =` push → commented out   → pass 26 / fail 2 (RED)
restored                                     → pass 28 / fail 0 (GREEN, file diff vs backup clean)
```

## Stage 3 — P1 hardening + validator gates (2026-10-19)

Scope: AB-1.3-untested-invariant, AB-1.3-check-pr-scope-bypass,
AB-ai-review-no-enforcement, AB-7.3-reviewer-dead-allows,
AB-5.3-nojekyll-hygiene, AB-6.2-engines-eol-floor, AB-7.2-ci-hardening,
AB-6.2-deps-placement.

Stages 1–2 files untouched (no regression): `src/server/local-server.js`,
`test/local-server.test.js`, `src/mcp/server.js` content handling,
`scripts/export-json.js` containment, `data/schema.json` content_file pattern
(only pre-existing Stage 2 `synthetic` key present), `src/core/compiler.js`
hyphen logic (only tests added in Stage 2), `data/**/*.yaml` tools/repos
(Stage 2 values preserved — 63 entries, 0 errors). No publish, no push, no
secrets. Loopback-only where applicable; sabotage via backup/restore with
`cp` (never `git stash`, working tree holds uncommitted Stages 1–3 work).

### Per-finding status

| ID | Status | Evidence |
|----|--------|----------|
| AB-1.3-untested-invariant | FIXED | `test/catalog-negative.test.js` (NEW, 15 tests): duplicate-id fixture asserts `/duplicate id 'negative-fixture-probe'/`; duplicate-tuple fixture asserts `/duplicate/`; validator canary asserts `runValidatorCanary(ROOT) === true`. Sabotage `if (seenIds.has(doc.id))` → `if (false)` → 13 pass / 2 fail (RED), restored. |
| AB-1.3-check-pr-scope-bypass | FIXED | `scripts/check-pr.js`: `classifyChangedFiles` splits `data/**/*.yaml` AND `scripts/**`; scripts-changes trigger full-catalog validation + `runValidatorCanary` (duplicate-id negative control); `getChangedFiles` failure → `process.exit(1)` (fail-closed). `validate-pr.yml` wires the gate (`Fetch PR base` + `PR gate` steps). Sabotage classify→data-only → 14/1 RED. |
| AB-ai-review-no-enforcement | FIXED | `scripts/ai-review.js`: `auditCatalogEntries` enforces harness-ids (taxonomy), kind/folder match, tool-grounding (invented tools fail), deny-first compile check; `cmdRun` exits 1 (`REVIEW FAILED`) on any finding. Evil `mcp.tools:[totally-invented-tool-xyz]` in-memory probe → `REVIEW FAILED: 1 rubric violation(s)`, exit 1; clean catalog → `REVIEW_OK entries=63`, exit 0. Sabotage tool-loop → `if (false)` → 14/1 RED. Tests: unknown harness, kind mismatch, unknown server, deny-first presence. |
| AB-7.3-reviewer-dead-allows | FIXED | `.opencode/agents/catalog-reviewer.md`: `read_*`/`glob_*`/`grep_*` → bare `read`/`glob`/`grep` (upstream tool names have no prefix). Test embeds a last-match-wins evaluator replica: bare `read`/`glob`/`grep` → allow; `bash`/`write`/`skill` → deny. Sabotage restoring `read_*` → RED (bare `read` denied). |
| AB-5.3-nojekyll-hygiene | FIXED | `scripts/build-site.js`: `fs.rmSync(_site, recursive)` at start (fail-closed abort on error), then rebuild + `.nojekyll`. Sabotage `.nojekyll` write removal + clean build → catalog test 9/1 RED; restored → GREEN. |
| AB-6.2-engines-eol-floor | FIXED | `package.json` engines `>=18.20.0` → `>=22.12.0` (18 EOL 2025-04-30, 20 EOL 2026-04-30; CI matrix already 22/24). |
| AB-7.2-ci-hardening | FIXED | All 9 workflows: SHA-pinned `checkout` (`3d3c42e…` # v7.0.1) + `setup-node` (`949feb2…` # v7.1.0); node pinned `22.23.3` (+ `24.22.0` matrix in validate-pr); `fetch-depth: 1` everywhere; `contents: read` everywhere except `generate-readme` (`contents: write`, required for auto-commit) and `site` (`pages`+`id-token: write`); `git-auto-commit-action` SHA-pinned (# v7.2.0); `upload-pages-artifact` # v5.0.0 + `deploy-pages` # v5.0.1. NEW `.github/CODEOWNERS` (`*`, `/data/`, `/.github/`, `/scripts/`, `/src/` → maintainers). |
| AB-6.2-deps-placement | FIXED | `ajv` + `ajv-formats` → `devDependencies` (`"dependencies"` keeps only `js-yaml`). Proof: `rg ajv src/ bin/` → 0 hits (only `scripts/utils/catalog.js`, unshipped — `npm pack --dry-run` tarball has no `scripts/`); `npm run validate` + `npm test` green with devDeps installed. |

### Files changed

- `scripts/check-pr.js` — fail-closed scripts/** gate + validator canary + exports (`parseArgs`, `getChangedFiles`, `classifyChangedFiles`, `runValidatorCanary`).
- `scripts/ai-review.js` — `KIND_FOLDERS`, `auditCatalogEntries` (harness/kind/tools/deny-first), `REVIEW FAILED` exit 1; exports for tests.
- `scripts/build-site.js` — clean `_site/` at start (steps 0–6 documented).
- `package.json` — engines `>=22.12.0`; `ajv`/`ajv-formats` to devDependencies.
- `.github/workflows/*.yml` (9 files) — SHA pins, pinned node matrix, `fetch-depth: 1`, minimal scopes.
- `.github/CODEOWNERS` — NEW.
- `.opencode/agents/catalog-reviewer.md` — bare `read`/`glob`/`grep`.
- `test/catalog-negative.test.js` — NEW (15 tests, sabotage tripwires in header/comments).
- `REMEDIATION_LOG.md` — this Stage 3 section appended.
- `docs/reports/stage-3-implementation.md` — NEW (stage report).

Explicitly NOT edited: `src/server/local-server.js`,
`test/local-server.test.js`, `src/core/compiler.js` hyphen/codex logic,
`src/core/importer.js`, `data/**/*.yaml` tools/repos, `src/mcp/server.js`
content handling, `data/schema.json` content_file/synthetic, `site/app.js`
(AB-5.2 stays a separate stage), `scripts/import/seed-all.js` (stale-seed
residual carried from Stage 2).

Residual: `.opencode/agents/catalog-reviewer.md` rubric line 4 still shows
the pre-Stage-2 normalization example (`postgres_prod_list_tables`, "all
non-alphanumerics map to `_`") while Stage 2 preserves hyphens
(`postgres-prod`). Prose-only; `ai-review.js` enforces the real rule.
Follow-up: update the example to `postgres-prod_<tool>`.

### Verification commands + outputs

```
$ npm run validate
VALIDATED 63 ENTRIES OK
$ npm run site
SITE_BUILT _site/ with 63 registry entries
$ npm test
ℹ tests 90
ℹ suites 31
ℹ pass 90
ℹ fail 0
(75 pre-existing incl. 29 Stage-1 + 3 Stage-2 net + 15 new Stage-3)
$ node scripts/ai-review.js run
REVIEW_OK entries=63 categories=56 mcp_tools=25   (exit 0)
$ node -e "<evil totally-invented-tool-xyz probe>"
REVIEW FAILED: 1 rubric violation(s)               (exit 1)
$ npm pack --dry-run
total files: 15 (no scripts/ → ajv move ships nothing new)
```

### Sabotage checks (backup/restore with cp, all RED then GREEN)

```
catalog.js seenIds check → if (false)        → 15 tests: pass 13 / fail 2 (RED)
ai-review tool loop → if (false)             → pass 14 / fail 1 (RED)
check-pr classify → scriptsChanged: []       → pass 14 / fail 1 (RED)
build-site .nojekyll write → removed + clean → catalog.test.js 9/10 pass, 1 fail (RED)
restored all                                     → pass 90 / fail 0 (GREEN)
```

Data catalog untouched: still 63 entries, 0 errors (`loadCatalog` count asserted).

## Stage 4 — P2/P3 polish + final verification (2026-10-19)

Scope: AB-5.2-install-slug, AB-5.3-registry-idempotency, AB-2.1-question-wildcard,
AB-5.1-favicon, AB-3.3-silent-default, AB-7.4-claude-transport-key
(re-verified, no code change), stale prose residuals from Stage 3.

Stages 1–3 files untouched (no regression): `src/server/local-server.js`,
`test/local-server.test.js`, `src/mcp/server.js`, `scripts/export-json.js`,
`data/schema.json`, `scripts/check-pr.js`, `scripts/ai-review.js` enforcement
logic, `src/core/compiler.js` hyphen/codex logic, `data/**/*.yaml` catalog,
`package.json` engines, `.github/workflows/*`, `.nojekyll` clean step in
`scripts/build-site.js` (only `generated_at` sourcing + header wording changed).
No publish, no push, no secrets. Loopback-only where applicable.

### Per-finding status

| ID | Status | Evidence |
|----|--------|----------|
| AB-5.2-install-slug | FIXED | `site/app.js` `installCommand` now emits `node bin/agent-builder.js install --recipe <base64url>` (recipe JSON via existing `base64UrlEncode`, shell-safe alphabet) instead of the rejected `install --slug`. `bin` `loadRecipe` accepts base64url (`decodeBase64Url` + pad + `Buffer`). Pasted command → `DRY_RUN install …` exit 0 (ASCII + UTF-8 recipes verified). Test in `test/stage4.test.js` asserts source shape + live `--dry-run` exit 0. |
| AB-5.3-registry-idempotency | FIXED | `scripts/build-site.js` gains `resolveGeneratedAt()`: honors `SOURCE_DATE_EPOCH` (integer seconds; unparseable value → fail-closed exit 1) for both `registry.json` and `health.json` `generated_at`. Header wording now states idempotency holds *except* `generated_at` unless `SOURCE_DATE_EPOCH` is set. Proof: two runs with `SOURCE_DATE_EPOCH=1234567890` → identical sha256 for `registry.json` and `index.html`; two wall-clock runs → identical except `generated_at` (`IDENTICAL_EXCEPT_GENERATED_AT=true`). `README.md` needed no change (carries no byte-identical claim). |
| AB-2.1-question-wildcard | FIXED | `wildcardToRegExp` in `src/core/compiler.js` maps `?` → `.` (exactly one char) after `*` → `.*` expansion; other metacharacters stay escaped literally. `evaluateV2Permission([{action:'a?c',…deny}],'abc')` → `deny` (effect allow in the issue's framing); `'ac'`/`'abbc'` → no match. Compiler never emits `?` (comment notes simulator-only). Tests: deny/allow matrices + `*` composition. |
| AB-5.1-favicon | FIXED | `site/index.html` gains `<link rel="icon" href="data:image/svg+xml,…">` (inline gear glyph, zero network fetch). No `/favicon.ico` request possible → no 404. Test asserts `rel="icon"` + `href="data:`. |
| AB-3.3-silent-default | FIXED | `src/core/importer.js` gains `warnDenyOnly(slug)`: empty v2 agents, empty v1 agents, and empty `mcpServers:{}` now emit a `console.warn` naming the agent + stating the deny-only (all-deny) outcome. Shape unchanged (still fail-closed deny-only, compiles identically). Warn-not-throw chosen so legitimate locked/shutoff recipes keep importing; throwing would also have kept the suite green (no existing empty-shape test) but would break that valid use. Tests assert warn fires on all three empty shapes and stays silent when an allow exists. |
| AB-7.4-claude-transport-key | RE-VERIFIED (Stage 2 fix holds) | No code change. Regression test added: registry entry with `transport:'stdio'` compiles to `claudeCodeMcp` whose JSON contains no `"transport"` key; remote `url` → `{type,url}` mapping covered by pre-existing tests. |
| Stage 3 prose residuals | FIXED | `.opencode/agents/catalog-reviewer.md:30` example `postgres_prod_list_tables` + "all non-alphanumerics map to `_`" → `postgres-prod_list-tables` + hyphen/underscore-preserving wording. `scripts/ai-review.js:19` rubric line → same hyphen-preserving wording (enforcement logic untouched). |

### Files changed

- `site/app.js` — `installCommand(recipe)` → `--recipe <base64url>`; install tab passes `currentRecipe()`.
- `site/index.html` — inline SVG data-URI favicon.
- `scripts/build-site.js` — `resolveGeneratedAt()` + header wording (clean-`_site/` step untouched).
- `src/core/compiler.js` — `?` → `.` in `wildcardToRegExp` + simulator comment (hyphen/codex logic untouched).
- `src/core/importer.js` — `warnDenyOnly` in `recipeFromV2`/`recipeFromV1`/`recipesFromClaude` (normalize/parse logic untouched).
- `.opencode/agents/catalog-reviewer.md` — prose/example fix (permission rules untouched).
- `scripts/ai-review.js` — rubric comment prose only (audit enforcement untouched).
- `test/stage4.test.js` — NEW (12 tests, sabotage tripwires in header comments).
- `REMEDIATION_LOG.md` — this Stage 4 + Final Verification section appended.
- `docs/reports/stage-4-implementation.md` — NEW (stage report).

Explicitly NOT edited: `src/server/local-server.js`, `test/local-server.test.js`,
`src/core/compiler.js` hyphen/codex blocks, `data/**/*.yaml`, `scripts/check-pr.js`,
`scripts/ai-review.js` enforcement, `scripts/build-site.js` clean step,
`package.json` engines/deps, `.github/workflows/*`, `scripts/import/seed-all.js`
(pre-existing stale-seed residual, out of scope).

### Verification commands + outputs

```
$ npm run validate
VALIDATED 63 ENTRIES OK
$ npm run site
SITE_BUILT _site/ with 63 registry entries
$ npm test
ℹ tests 102
ℹ suites 37
ℹ pass 102
ℹ fail 0
(90 pre-existing incl. 29 Stage-1 + 3 Stage-2 net + 15 Stage-3 + 12 new Stage-4)
$ node scripts/ai-review.js run
REVIEW_OK entries=63 categories=56 mcp_tools=25   (exit 0)
$ node scripts/ai-review.js selftest
VALIDATED 63 ENTRIES OK / SITE_BUILT _site/ with 63 registry entries / SELFTEST_OK (exit 0)
$ SOURCE_DATE_EPOCH=1234567890 npm run site (x2)
sha256 identical for _site/registry.json and _site/index.html; generated_at=2009-02-13T23:31:30.000Z
$ SOURCE_DATE_EPOCH=bogus npm run site
ERROR: invalid SOURCE_DATE_EPOCH="bogus" (…) (exit 1, fail-closed)
$ install --recipe <base64url of {slug:'webui-paste',…}> --dry-run
DRY_RUN install webui-paste -> … [opencode-v2] (exit 0)
```

### Sabotage checks (all RED as required, then restored)

```
? handling removed (literal ?)                  → 12 tests: pass 10 / fail 2 (RED)
installCommand back to --slug                   → pass 11 / fail 1 (RED)
resolveGeneratedAt ignores SOURCE_DATE_EPOCH    → pass 11 / fail 1 (RED)
warnDenyOnly call removed (v2 path)             → pass 11 / fail 1 (RED, recipes still deny-only)
favicon link removed                            → pass 11 / fail 1 (RED)
restored                                          → pass 102 / fail 0 (GREEN)
```
(Sabotage performed by temporary in-place edits on `test/stage4.test.js` runs,
verified RED, then reverted before the final green run above.)

## Final Verification (all stages, 2026-10-19)

- `npm run validate` → `VALIDATED 63 ENTRIES OK` (63 entries, 0 errors; catalog
  files byte-identical to Stages 1–3 — no `data/**/*.yaml` edits in Stage 4).
- `npm run site` → `SITE_BUILT _site/ with 63 registry entries` (wall-clock
  `generated_at`; fixed-epoch runs byte-identical per AB-5.3 proof above).
- `npm test` → `ℹ tests 102 / suites 37 / pass 102 / fail 0`.
- `node scripts/ai-review.js run` → `REVIEW_OK entries=63 categories=56 mcp_tools=25`.
- `node scripts/ai-review.js selftest` → `SELFTEST_OK`.
- `git status --short` → only Stage 1–4 working-tree modifications plus
  pre-existing untracked audit artifacts (`.opencode/opencode-loop/`,
  `AUDIT_REPORT_FINDINGS.md`, `PROMPT_ADVERSARIAL_FLEET_AUDIT.md`,
  `docs/reports/`, new tests); no commits, no pushes, no publishes, no secrets.
- `python3 ./scripts/generate-rigs.py` and `./scripts/verify-rigs.sh` do NOT
  exist in this repo and were never part of it — `ls` proof:
  `scripts/generate-rigs.py: No such file or directory`,
  `scripts/verify-rigs.sh: No such file or directory`.
  Real equivalents used instead, all green: `npm run validate`, `npm run site`,
  `npm test` (`node scripts/run-tests.js`), `node scripts/ai-review.js selftest`.
