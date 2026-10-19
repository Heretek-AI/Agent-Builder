# AUDIT_REPORT_FINDINGS: Agent-Builder

## Baseline

- Commit: `d0a17eecf41ca9942ea648a6f799e715a94bd2ba`
- Commit date: `2026-10-19 03:40:21 -0400` — `fix(ci): build site before tests to unblock Validate PR and AI Review`
- Audit date (UTC): `Mon Oct 19 08:24:42 AM UTC 2026` (runs spanned 08:00–08:24 UTC)
- Tool versions: `node v26.10.0` (linuxbrew) + `/usr/bin/node v24.21.0`, `npm 11.19.1`, `npx 11.19.1`, `git 2.56.0`, `rg 15.1.0`, `jq-1.8.2`, `curl 8.22.0`, `gh 2.97.0`
- Host capabilities: outbound HTTPS OK (`registry.npmjs.org` HTTP/2 200, `heretek-ai.github.io` HTTP/2 200, `api.github.com` OK, `raw.githubusercontent.com` OK, `api.osv.dev` OK, `developers.openai.com` OK, `code.claude.com` OK). Real hosts present: `opencode v2.0.32` (official-lineage successor after official `sst` org rename to `anomalyco`; installed from `anomalyco/tap`), `claude 2.1.292 (Claude Code)` official, `Codex CLI 0.163.0` (npm `@openai/codex` into scratch), `chromium 154 / chrome 155`, `MCP Inspector 2.11.0` via npx. No Node 18/20/22 on host. No GitHub writes. Dummy keys only. Loopback-only servers, all killed.
- Dirty files at start: `?? .opencode/opencode-loop/`, `?? PROMPT_ADVERSARIAL_FLEET_AUDIT.md` (pre-existing untracked). Per section 0, all experiments ran in clean detached worktree `/tmp/Agent-Builder-audit-I9ah7n/wt` @ HEAD, not the working tree. Real checkout left with only `AUDIT_REPORT_FINDINGS.md` + prompt file as new files.
- Scratch: `AUDIT_TMP=/tmp/Agent-Builder-audit-I9ah7n`, worktree `/tmp/Agent-Builder-audit-I9ah7n/wt`, raw notes `alpha.md/beta.md/gamma.md`, cross-exam `x-alpha.md/x-beta.md/x-gamma.md`, ~185 log files under `logs/`.
- Previous run: none (first run).
- Checks that could not run here and why: see `Not Audited / Unverifiable` (Node 18/20/22 matrix; live OpenCode enforcement blocked by API billing; Pages deploy; funded-CLI execution; archived-flag sweep; cursor/windsurf/copilot/gemini binaries).

## Verdict

`Agent-Builder` is a real, largely working registry (63 entries validate, deny-first compiler ordering is correct and caught by tests, MCP server handshakes cleanly against the official Inspector and real Claude Code, WebUI functions end-to-end in real Chromium, Pages serves live v1.0.0/63), but it does not meet its own fail-closed, machine-validated contract: the local bridge executes arbitrary local binaries unauthenticated with `CORS: *`, the catalog trusts unverified `repo`/tool names (15 placeholder `example/*` 404s, 4 invented MCP tool sets, an unpublished npm package behind the headline `npx` path), and the highest-risk server gates have zero tests so one-line backdoors stay green. The Codex harness surface is fully rejected by the real Codex CLI, and hyphenated MCP ids miss real tool actions fail-open. The single most important fix is the introspect RCE (`AB-5.6-introspect-rce`): allowlist commands, require a per-boot token, and drop the CORS wildcard before any further `serve` use.

## Prioritized Defect Matrix

| ID | Priority | Claim | Location | Summary |
|----|----------|-------|----------|---------|
| AB-5.6-introspect-rce | P0 | 5.6 | `src/server/local-server.js:216-251,84-88` | Unauthenticated introspect + CORS * spawns any binary; live touch proof |
| AB-5.4-bridge-untested | P0 | 5.4 | `src/server/local-server.js:367-376` | Traversal gutting → 43/43 green; zero local-server tests |
| AB-5.5-chat-untested | P0 | 5.5 | `src/server/local-server.js:153` | Dropping https? gate → green; zero tests |
| AB-5.6-introspect-untested | P0 | 5.6 | `src/server/local-server.js:247` | Adding shell:true → green; zero tests |
| AB-6.1-npm-never-published | P0 | 6.1 | `package.json:2; README.md:10,14` | npm view 404; headline npx path broken |
| AB-2.5-codex-transport | P0 | 2.5 | `src/core/compiler.js:492-521` | Every Codex TOML rejected invalid transport; omits command/args |
| AB-1.2-example-repos | P0 | 1.2 | `data/**/*.yaml` (15 files) | 15 github.com/example/* 404s |
| AB-1.2-dead-mcp-repos | P0 | 1.2 | `data/mcp-servers/design-ui/figma-design-mcp.yaml:4`, `data/mcp-servers/knowledge-productivity/notion-knowledge-mcp.yaml:4` | Framelink + makersu 404 (API Not Found) |
| AB-7.5-k8s-tools | P0 | 7.5 | `data/mcp-servers/cloud-devops/k8s-observe-mcp.yaml` | 0/3 tools exist on real mcp-server-kubernetes@4.1.9 |
| AB-7.5-notion-tools | P0 | 7.5 | `data/mcp-servers/knowledge-productivity/notion-knowledge-mcp.yaml` | 0/3 tools exist on real @notionhq/notion-mcp-server@2.5.2 |
| AB-7.5-filesystem-exec | P0 | 7.5 | `data/mcp-servers/filesystem-shell/filesystem-shell-mcp.yaml` | execute_command invented; real server has 14 tools without it |
| AB-7.5-figma-tools | P0 | 7.5 | `data/mcp-servers/design-ui/figma-design-mcp.yaml` | 2/3 tools absent on real figma-mcp-server@3.1.2 |
| AB-5.4-content-file-read | P1 | 5.4 + validator | `data/schema.json:79; scripts/export-json.js:80-91; src/mcp/server.js:245-271` | content_file unvalidated: absolute/traversal/URL pass, export copies, get_entry_details reads host files |
| AB-5.4-targetdir-unrestricted | P1 | 5.4 | `src/server/local-server.js:380-402; bin/agent-builder.js:241-251` | targetDir unconstrained; attempted /etc write; .. → 200 |
| AB-5.5-ssrf-private-range | P1 | 5.5 | `src/server/local-server.js:136-211` | No destination boundary: private-range dialed, userinfo forwarded |
| AB-1.3-untested-invariant | P1 | 1.3 [S] | `scripts/utils/catalog.js:129-133` | Neutering dup-id check → 43/43 green; no negative fixture |
| AB-7.5-postgres-ungrounded | P1 | 7.5 | `data/mcp-servers/databases/postgres-mcp-connector.yaml` | @example/postgres-mcp E404; tools unverifiable |
| AB-7.4-hyphen-normalization-divergence | P1 | 7.4 + 2.1/2.5 | `src/core/compiler.js:36-38; src/core/importer.js:45-47` | Strips - vs upstream preserves -; rules miss real postgres-prod_* fail-open (merges AB-2.5-claude-tool-naming) |
| AB-6.2-engines-eol-floor | P1 | 6.2 | `package.json:28-30` | engines >=18.20.0 admits EOL 18+20; CI only 22.x/24.x |
| AB-7.2-ci-hardening | P1 | 7.2 | `.github/workflows/*.yml` | Mutable major pins (checkout@v4 vs v7.0.1, setup-node@v4 vs v7.1.0, deploy-pages@v4 vs v5.0.1, git-auto-commit@v5 vs v7.2.0), floating matrix, fetch-depth:0, over-scoped dry-run tokens, no CODEOWNERS |
| AB-1.3-check-pr-scope-bypass | P1 | validator gate | `scripts/check-pr.js:67-69` | Neutering validator passes check-pr + suite green; gate unwired into any workflow |
| AB-1.2-sst-opencode-redirect | P2 | 1.2 | plugin entries + README/docs | sst/opencode → official rename anomalyco/opencode (200); stale org docs-drift |
| AB-5.3-nojekyll-hygiene | P2 | 5.3 [S] | `scripts/build-site.js:114` | Build never cleans _site/; stale .nojekyll masks regression (clean: 42/1 red) |
| AB-5.2-install-slug | P2 | 5.2 | `site/app.js:474-475` | Install tab prints install --slug which CLI rejects |
| AB-7.3-reviewer-dead-allows | P2 | 7.3 | `.opencode/agents/catalog-reviewer.md:4-13` | read_*/glob_*/grep_* never match bare read/glob/grep; reviewer fully denied |
| AB-ai-review-no-enforcement | P2 | ai-review rubric | `scripts/ai-review.js:48-68` | Invented tools/harnesses/kind-folder pass REVIEW_OK |
| AB-7.4-claude-transport-key | P3 | 7.4 | `src/core/compiler.js:449-451` | Emits non-spec transport:stdio (tolerated by real CLI) |
| AB-6.2-deps-placement | P3 | 6.2 | `package.json:47-51` | ajv/ajv-formats validate-time only but shipped as runtime |
| AB-5.3-registry-idempotency | P3 | 5.3 | `scripts/build-site.js` | generated_at breaks byte-identical claim (1-line diff) |
| AB-2.1-question-wildcard | P3 | 2.1 | `src/core/compiler.js:38-44` | ? escaped literal vs upstream one-char; simulator-only |
| AB-5.1-favicon | P3 | 5.1 | `site/index.html` | No favicon; single 404 |
| AB-3.3-silent-default | P3 | 3.3 | `src/core/importer.js` | Empty-permission shapes construct deny-closed recipes |

## Findings

### AB-5.6-introspect-rce: unauthenticated arbitrary local-command execution via /api/mcp/introspect + CORS *
- **Priority:** P0
- **Claim:** 5.6 (spawns argv-array no-shell — true but ANY binary spawnable by ANY caller)
- **Location:** `src/server/local-server.js:216-251`, `:84-88`, `bin/agent-builder.js:294-303`
- **Proof:** from worktree root, loopback only:
```
node -e "fetch('http://127.0.0.1:18097/api/status').then(async r=>console.log('CORS_HEADER='+r.headers.get('access-control-allow-origin')))"
curl -s -X POST http://127.0.0.1:18097/api/mcp/introspect -H 'Content-Type: application/json' -d '{"command":"/usr/bin/touch","args":["/tmp/gamma-pwn-marker"]}'
ls /tmp/gamma-pwn-marker
```
- **Raw output:**
```
CORS_HEADER=*
{"error":"timed out waiting for MCP response id 1"}
MARKER_EXISTS=true
```
Re-ran with `/bin/sh -c` → `MARKER2_EXISTS=true`, `PREFLIGHT 204 CORS=*`, `LAN_BIND_OK 0.0.0.0`.
- **Why it matters:** any visited website can POST cross-origin and run local commands; 5s kill fires after execution.
- **Remediation:** fail-closed:
```diff
-    child = spawn(command.trim(), args.slice(), { env, stdio: ['pipe', 'pipe', 'pipe'] });
+    const ALLOW = new Set(['npx', 'node', 'python3']);
+    const base = path.basename(command.trim());
+    if (!ALLOW.has(base) && !ALLOW.has(command.trim())) throw new Error('command not allowlisted');
+    child = spawn(command.trim(), args.slice(), { env, stdio: ['pipe', 'pipe', 'pipe'] });
```
plus drop CORS wildcard + per-boot token on /api/* POSTs.
- **Verify the fix:** touch probe → `400 command not allowlisted`, `MARKER_EXISTS=false`.
- **Cross-examination:** Alpha-challenging-Gamma re-ran live — mitigations failed. **KEEP P0** (strengthened: LAN-bind possible).

### AB-5.4-bridge-untested: traversal containment has zero tests
- **Priority:** P0
- **Claim:** 5.4 [S]
- **Location:** `src/server/local-server.js:367-376`; `rg local-server test/` → zero hits
- **Proof:** `rg -n "local-server|installRecipeFiles" test/` (exit 1); in wt gut `isSafeRelPath` → `return true`; `npm test`
- **Raw output:** `pass 43 / fail 0` GREEN with containment gutted
- **Why it matters:** unauthenticated-write gate silently removable.
- **Remediation:** add `test/local-server.test.js` with traversal payloads (.., absolute, /etc, %2e%2e), assert 403/400.
- **Verify the fix:** gutting → RED.
- **Cross-examination:** re-ran, zero hits confirmed. **KEEP P0**.

### AB-5.5-chat-untested: baseUrl scheme gate has zero tests
- **Priority:** P0
- **Claim:** 5.5 [S]
- **Location:** `src/server/local-server.js:153`
- **Proof:** in wt `if (!/^https?:\/\//i.test(...))` → `if (false)`; `npm test`
- **Raw output:** `fail 0` GREEN
- **Why it matters:** sole scheme gate vs file:// / ftp:// silently removable.
- **Remediation:** baseUrl matrix in `test/local-server.test.js`.
- **Verify the fix:** re-run → RED.
- **Cross-examination:** re-ran. **KEEP P0**.

### AB-5.6-introspect-untested: spawn no-shell has zero tests
- **Priority:** P0
- **Claim:** 5.6 [S]
- **Location:** `src/server/local-server.js:247`
- **Proof:** in wt add `shell: true`; `npm test`
- **Raw output:** `fail 0` GREEN
- **Why it matters:** argv→shell RCE escalation invisible.
- **Remediation:** introspect matrix + argv-no-shell proof + allowlist test.
- **Verify the fix:** re-run → RED.
- **Cross-examination:** re-ran. Strongest of three. **KEEP P0**.

### AB-6.1-npm-never-published: package never published
- **Priority:** P0
- **Claim:** 6.1
- **Location:** `package.json:2`; `README.md:10,14`
- **Proof:** `npm view @heretek-ai/agent-builder version dist-tags`
- **Raw output:** `npm error 404 Not Found - GET https://registry.npmjs.org/@heretek-ai%2fagent-builder - Not found`
- **Why it matters:** headline `npx @heretek-ai/agent-builder serve` cannot work.
- **Remediation:** `npm publish --provenance` or remove npx claims. Do NOT publish from audit.
- **Verify the fix:** `npm view @heretek-ai/agent-builder version` → `0.1.0`.
- **Cross-examination:** re-ran with controls (ajv resolves, org has siblings). **KEEP P0**.

### AB-2.5-codex-transport: every Codex TOML rejected
- **Priority:** P0
- **Claim:** 2.5
- **Location:** `src/core/compiler.js:492-521`
- **Proof:** `node bin/agent-builder.js compile --recipe '{"name":"audit-probe","prompt":"probe","skills":["secure-code-audit"],"mcp":[{"server":"postgres-prod","tools":["query"]}]}' --harness codex > cfg.toml`; `CODEX_HOME=/tmp/x codex mcp list` (config at `$CODEX_HOME/config.toml`)
- **Raw output:** `Error: failed to load bootstrap configuration / invalid transport in mcp_servers.postgres-prod`; with command/args → `enabled`
- **Why it matters:** Codex surface does not work as emitted.
- **Remediation:** emit `command`/`args`/`env`; never bare tools-only block.
- **Verify the fix:** `codex mcp list` shows enabled.
- **Cross-examination:** re-ran with 0.163.0 verbatim. **KEEP P0**.

### AB-1.2-example-repos: 15 placeholder repo URLs 404
- **Priority:** P0
- **Claim:** 1.2
- **Location:** 15× `data/**/*.yaml` (e.g. `data/agents/security-auditors/db-security-auditor.yaml:2`)
- **Proof:** `for u in $(grep -rhoE 'https?://github.com/example/[^ "]*' data/ | sort -u); do code=$(curl -s -o /dev/null -w "%{http_code}" -L -m 15 "$u"); echo "$code $u"; done`
- **Raw output:** `404 https://github.com/example/...` x15
- **Why it matters:** 15 entries incl. all 4 agent presets hit 404.
- **Remediation:** replace with real upstreams or `synthetic: true` marker + validator exemption.
- **Verify the fix:** probe → all 200.
- **Cross-examination:** reproduced; Beta agreed. **KEEP P0**.

### AB-1.2-dead-mcp-repos: figma + notion repos 404
- **Priority:** P0
- **Claim:** 1.2
- **Location:** `data/mcp-servers/design-ui/figma-design-mcp.yaml:4`, `data/mcp-servers/knowledge-productivity/notion-knowledge-mcp.yaml:4`
- **Proof:** `curl -s -o /dev/null -w "%{http_code} %{url_effective}" -L -m 20 https://github.com/Framelink/figma-mcp-server`; `curl -s https://api.github.com/repos/Framelink/figma-mcp-server`
- **Raw output:** `404`; `{"message":"Not Found"}`
- **Why it matters:** entries cite nonexistent repos; figma npm resolves to different author.
- **Remediation:** real source + correct tools. Do NOT use framelink-ai (itself 404); makenotion/notion 200 is lead needing confirmation.
- **Verify the fix:** 200 + tools match.
- **Cross-examination:** reproduced via curl + API. **KEEP P0**.

### AB-7.5-k8s-tools: k8s 0/3 invented
- **Priority:** P0
- **Claim:** 7.5
- **Location:** `data/mcp-servers/cloud-devops/k8s-observe-mcp.yaml`
- **Proof:** stdio tools/list vs `npx -y mcp-server-kubernetes@4.1.9`
- **Raw output:** 23 real (`kubectl_get/describe/logs`); claimed 3 absent
- **Why it matters:** scoped agents reference nonexistent tools.
- **Remediation:** real names + re-scope sre-database-agent.
- **Verify the fix:** subset check.
- **Cross-examination:** live re-probed 0/3. **KEEP P0**.

### AB-7.5-notion-tools: notion 0/3 invented
- **Priority:** P0
- **Claim:** 7.5
- **Location:** `data/mcp-servers/knowledge-productivity/notion-knowledge-mcp.yaml`
- **Proof:** tools/list vs `npx -y @notionhq/notion-mcp-server@2.5.2`
- **Raw output:** 24 API-* tools; claimed 3 absent
- **Why it matters:** same.
- **Remediation:** real API-* names or switch server.
- **Verify the fix:** subset check.
- **Cross-examination:** re-probed. **KEEP P0**.

### AB-7.5-filesystem-exec: execute_command invented
- **Priority:** P0
- **Claim:** 7.5
- **Location:** `data/mcp-servers/filesystem-shell/filesystem-shell-mcp.yaml`
- **Proof:** tools/list vs `@modelcontextprotocol/server-filesystem@2.0.0`
- **Raw output:** 14 tools, no execute_command
- **Why it matters:** allowlist names nonexistent tool.
- **Remediation:** drop it.
- **Verify the fix:** subset check.
- **Cross-examination:** reproduced 3/4+1. **KEEP P0**.

### AB-7.5-figma-tools: figma 2/3 invented
- **Priority:** P0
- **Claim:** 7.5
- **Location:** `data/mcp-servers/design-ui/figma-design-mcp.yaml`
- **Proof:** `FIGMA_API_KEY=dummy ... npx -y figma-mcp-server@3.1.2` tools/list
- **Raw output:** 50 tools incl. list_components but no get_design_context/get_screenshot
- **Why it matters:** same + attribution broken.
- **Remediation:** real equivalents + fix repo.
- **Verify the fix:** subset check.
- **Cross-examination:** re-probed 1/3. **KEEP P0**.

### AB-5.4-content-file-read: unvalidated content_file
- **Priority:** P1
- **Claim:** validator boundary + 5.4
- **Location:** `data/schema.json:79`; `scripts/export-json.js:80-91`; `src/mcp/server.js:245-271`
- **Proof:** `node -e validateEntryObject content_file /etc/passwd` → valid=true; add evil entry → `VALIDATED 64 OK` → export copies; `readBundledContent /etc/hostname` → AtomMan
- **Raw output:** valid=true for ../../etc/passwd, /etc/passwd, /tmp/..., https://evil...; SECRET_SENTINEL_CONTENT in bundle
- **Why it matters:** merged entry → host-file disclosure + bundle delivery. Latent (0 entries use it).
- **Remediation:**
```diff
-    "content_file": { "type": "string", "minLength": 1 },
+    "content_file": { "type": "string", "pattern": "^(?!/)(?!.*\\.\\.)[A-Za-z0-9_][A-Za-z0-9_./-]*\\.md$" },
```
plus containment in export/build/read.
- **Verify the fix:** corpus invalid; export skips; read returns null.
- **Cross-examination:** re-ran full cycle. **KEEP P1**.

### AB-5.4-targetdir-unrestricted: install root unconstrained
- **Priority:** P1
- **Claim:** 5.4
- **Location:** `src/server/local-server.js:380-402`
- **Proof:** `POST /api/install {"recipe":{"slug":"t","prompt":"p"},"targetDir":"/etc/gamma-pwn"}` etc.
- **Raw output:** `/etc` → `EACCES mkdir` (attempted, OS stopped); `..` → 200 with 7 files
- **Why it matters:** plant 7 files anywhere user-writable via loopback/website.
- **Remediation:** sandbox targetDir or per-boot token; reject absolute over HTTP.
- **Verify the fix:** absolute/.. → 400.
- **Cross-examination:** re-ran; rel-layer holds (slug ../ → 400), root is hole. **KEEP P1**.

### AB-5.5-ssrf-private-range: no destination boundary
- **Priority:** P1
- **Claim:** 5.5
- **Location:** `src/server/local-server.js:136-211`
- **Proof:** `POST /api/llm/chat {"baseUrl":"http://10.255.255.1:9",...}`; userinfo variant with fake upstream
- **Raw output:** file/ftp → 400; 10.x → `upstream timed out` (dialed); userinfo → 200 forwarded Bearer DUMMY; redirect 302 relayed not followed
- **Why it matters:** cloud-metadata/proxy-bypass primitive with response relay cross-origin.
- **Remediation:** deny 10/8,172.16/12,192.168/16,169.254/16,127/8 unless --allow-loopback-llm; reject userinfo.
- **Verify the fix:** → `400 baseUrl target not permitted`.
- **Cross-examination:** exfil proven. **KEEP P1**.

### AB-1.3-untested-invariant: dup-id untested
- **Priority:** P1
- **Claim:** 1.3 [S]
- **Location:** `scripts/utils/catalog.js:129-133`
- **Proof:** `sed -i 's/if (seenIds.has(doc.id))/if (false)/' scripts/utils/catalog.js; npm test`
- **Raw output:** `pass 43 / fail 0`
- **Why it matters:** uniqueness silently regressable; tuple check dead code.
- **Remediation:** negative fixtures asserting /duplicate id/.
- **Verify the fix:** sabotage → RED.
- **Cross-examination:** reproduced. **KEEP P1**.

### AB-7.5-postgres-ungrounded: postgres ungrounded
- **Priority:** P1
- **Claim:** 7.5
- **Location:** `data/mcp-servers/databases/postgres-mcp-connector.yaml`
- **Proof:** `npm view @example/postgres-mcp version`
- **Raw output:** `E404`
- **Why it matters:** security-story tools unverifiable.
- **Remediation:** real postgres server or synthetic mark.
- **Verify the fix:** package + subset check.
- **Cross-examination:** reproduced. **KEEP P1**.

### AB-7.4-hyphen-normalization-divergence: hyphen stripping fail-open
- **Priority:** P1
- **Claim:** 7.4 + 2.1/2.5 (merges AB-2.5-claude-tool-naming)
- **Location:** `src/core/compiler.js:36-38`; `src/core/importer.js:45-47`
- **Proof:** upstream `tool/mcp.ts:16-17` preserves -; repo strips; `compile --recipe postgres-prod` emits postgres_prod_*; Claude docs preserve -; replica Wildcard.match miss → default allow/ask
- **Raw output:** repo `replace(/[^a-zA-Z0-9]+/g,'_')` vs upstream `/[^a-zA-Z0-9_-]/g`; emitted `mcp__postgres_prod__query` vs `mcp__plugin_my-plugin_database-tools__query`
- **Why it matters:** deny rules miss real actions fail-open; Claude allowlists name nonexistent tools.
- **Remediation:** `replace(/[^a-zA-Z0-9-]+/g,'_')`; update README/fixture/tests.
- **Verify the fix:** recompile → postgres-prod_query; suite green.
- **Cross-examination:** both sides reproduced; worse than stated. **KEEP P1 merged**.

### AB-6.2-engines-eol-floor: EOL floor
- **Priority:** P1
- **Claim:** 6.2
- **Location:** `package.json:28-30`
- **Proof:** `curl nodejs Release schedule.json`; engines + matrix grep
- **Raw output:** v18 end 2025-04-30, v20 end 2026-04-30; engines >=18.20.0; matrix [22.x,24.x]
- **Why it matters:** floor admits two EOL majors.
- **Remediation:** `>=22.12.0`.
- **Verify the fix:** install warns on 18.
- **Cross-examination:** verified. **KEEP P1**.

### AB-7.2-ci-hardening: supply-chain hardening
- **Priority:** P1
- **Claim:** 7.2 (merges Beta stale-majors + Gamma hardening, not double-counted)
- **Location:** `.github/workflows/*.yml`
- **Proof:** `rg -o "actions/[a-z-]+@v[0-9]+"`; `gh api repos/<action>/releases/latest`
- **Raw output:** checkout@v4 vs v7.0.1, setup-node@v4 vs v7.1.0, upload-pages-artifact@v5 current, deploy-pages@v4 vs v5.0.1, git-auto-commit@v5 vs v7.2.0; floating [22.x,24.x]; fetch-depth:0 + pull-requests:write; triple-write dry-run-only; no CODEOWNERS
- **Why it matters:** tag-move, auto-push, exfil surface, creep.
- **Remediation:** bump + SHA-pin, pin matrix, fetch-depth:1, minimal scopes, CODEOWNERS.
- **Verify the fix:** rg current majors/SHAs; workflows green.
- **Cross-examination:** version table verified exactly. **KEEP P1 merged**.

### AB-1.3-check-pr-scope-bypass: PR gate bypass (unwired)
- **Priority:** P1
- **Claim:** check-pr gate
- **Location:** `scripts/check-pr.js:67-69`
- **Proof:** neuter validator, commit, `node scripts/check-pr.js --base HEAD~1` → CHECK_PR_OK; `npm test` 43/43; `rg check-pr .github/` → no workflow
- **Raw output:** `CHECK_PR_OK: no data/**/*.yaml files changed`; `VALIDATED 63 OK`
- **Why it matters:** scripts-only PRs bypass gate; suite green with dead guard; gate unwired.
- **Remediation:** fail-closed on scripts/** + canary negative test.
- **Verify the fix:** probe → RED.
- **Cross-examination:** strengthened (unwired). **KEEP P1**.

### AB-1.2-sst-opencode-redirect: stale org URL
- **Priority:** P2 (DOWNGRADE P1→P2)
- **Claim:** 1.2
- **Location:** plugin entries + README/docs
- **Proof:** `curl -L https://github.com/sst/opencode`; `curl https://api.github.com/orgs/sst`
- **Raw output:** `200 https://github.com/anomalyco/opencode`; org: We've moved to anomalyco; target archived:false
- **Why it matters:** dead-org docs-drift; strengthens OpenCode proofs (official rename, not hijack).
- **Remediation:** update to successor + pin.
- **Verify the fix:** 200 + archived:false.
- **Cross-examination:** hijack refuted. **DOWNGRADE P1→P2**.

### AB-5.3-nojekyll-hygiene: stale _site masks regression
- **Priority:** P2 (DOWNGRADE P1→P2)
- **Claim:** 5.3 [S]
- **Location:** `scripts/build-site.js:114`
- **Proof:** neutralize .nojekyll; `rm -rf _site && npm run site && npm test` vs stale
- **Raw output:** clean → `42/1 FAIL missing _site/.nojekyll`; stale → 43/43 PASS
- **Why it matters:** incremental rebuilds ship broken Pages; tested from clean incl. CI.
- **Remediation:** clean _site/ at build start.
- **Verify the fix:** sabotage → RED incremental.
- **Cross-examination:** partially refuted (test exists). **DOWNGRADE P1→P2**.

### AB-5.2-install-slug: wrong install command
- **Priority:** P2
- **Claim:** 5.2
- **Location:** `site/app.js:474-475`
- **Proof:** `node bin/agent-builder.js install --slug my-agent`
- **Raw output:** `ERROR: install: unknown argument "--slug"`
- **Why it matters:** pasted WebUI command fails (all else works, zero JS errors).
- **Remediation:** emit --recipe base64url command.
- **Verify the fix:** pasted exits 0.
- **Cross-examination:** exact. **KEEP P2**.

### AB-7.3-reviewer-dead-allows: dead reviewer rules
- **Priority:** P2
- **Claim:** 7.3
- **Location:** `.opencode/agents/catalog-reviewer.md:4-13`
- **Proof:** upstream migrate.ts + Wildcard.match replica; tool name read
- **Raw output:** read_* vs read → false; trailing *:deny denies all
- **Why it matters:** reviewer nonfunctional (fail-closed safe).
- **Remediation:** bare read/glob/grep.
- **Verify the fix:** decode asserts allow.
- **Cross-examination:** source-determinative. **KEEP P2**.

### AB-ai-review-no-enforcement: rubric prose-only
- **Priority:** P2
- **Claim:** ai-review rubric
- **Location:** `scripts/ai-review.js:48-68`
- **Proof:** evil entry `mcp.tools:[totally-invented-tool-xyz]` → VALIDATED 64 OK + REVIEW_OK
- **Raw output:** `REVIEW_OK entries=64 mcp_tools=29`
- **Why it matters:** cannot catch invented facts.
- **Remediation:** enforce harness/kind/tools/deny-first; non-zero exit.
- **Verify the fix:** evil → REVIEW FAILED.
- **Cross-examination:** re-ran 3 cycles. **KEEP P2**.

### AB-7.4-claude-transport-key: non-spec key
- **Priority:** P3 (DOWNGRADE P2→P3)
- **Claim:** 7.4
- **Location:** `src/core/compiler.js:449-451`
- **Proof:** `compile --harness claude-code` → transport:stdio; docs stdio={command,args,env}; live `claude mcp add-json`
- **Raw output:** `Added stdio MCP server` (tolerated)
- **Why it matters:** tolerated; masks type for future url entries (none use url).
- **Remediation:** drop transport; add type mapping.
- **Verify the fix:** no transport; url→type.
- **Cross-examination:** tolerance proven live. **DOWNGRADE P2→P3**.

### AB-6.2-deps-placement: ajv misplaced
- **Priority:** P3
- **Claim:** 6.2
- **Location:** `package.json:47-51`
- **Proof:** `rg require ajv`; `npm pack --dry-run`; tarball has no scripts/
- **Raw output:** ajv only via unshipped scripts/; fallback → []
- **Why it matters:** harmless bloat.
- **Remediation:** move to devDependencies.
- **Verify the fix:** pack unchanged; omit=dev still runs.
- **Cross-examination:** confirmed. **KEEP P3**.

### AB-5.3-registry-idempotency: timestamp breaks identical claim
- **Priority:** P3
- **Claim:** 5.3
- **Location:** `scripts/build-site.js`
- **Proof:** two `npm run site`; `md5sum` + diff
- **Raw output:** index.html identical; registry.json 1-line generated_at diff
- **Why it matters:** wording overclaims.
- **Remediation:** wording except generated_at or SOURCE_DATE_EPOCH.
- **Verify the fix:** md5 equal with fixed timestamp.
- **Cross-examination:** exact. **KEEP P3**.

### AB-2.1-question-wildcard: ? divergence
- **Priority:** P3
- **Claim:** 2.1
- **Location:** `src/core/compiler.js:38-44`
- **Proof:** `evaluateV2Permission([{action:'a?c'}],'abc')`
- **Raw output:** ? literal; compiler never emits ?
- **Why it matters:** simulator-only.
- **Remediation:** ?→. or document.
- **Verify the fix:** evaluates effect.
- **Cross-examination:** confirmed. **KEEP P3**.

### AB-5.1-favicon: missing favicon
- **Priority:** P3
- **Claim:** 5.1
- **Location:** `site/index.html`
- **Proof:** `fetch(.../favicon.ico)` → 404; grep → zero refs
- **Raw output:** `FAVICON_STATUS=404`
- **Why it matters:** log noise.
- **Remediation:** inline SVG or 204.
- **Verify the fix:** no 404.
- **Cross-examination:** confirmed. **KEEP P3**.

### AB-3.3-silent-default: empty defaults
- **Priority:** P3
- **Claim:** 3.3
- **Location:** `src/core/importer.js`
- **Proof:** `parseUploadedConfig {agents:{a:{description:'d'}}}` → OK empty; `{mcpServers:{}}` → OK; empty compiles deny-only
- **Raw output:** empty-but-valid recipes; deny-closed outcome
- **Why it matters:** advisory.
- **Remediation:** reject-or-warn.
- **Verify the fix:** throw/warn.
- **Cross-examination:** confirmed correct arg order. **KEEP P3**.

## Claim Ledger

| Claim | Status | Evidence |
|-------|--------|----------|
| 1.1 | VERIFIED | validate 63 OK; leaf/harness checks |
| 1.2 | BROKEN | AB-1.2-example-repos, AB-1.2-dead-mcp-repos |
| 1.3 | PARTIAL | data holds but AB-1.3-untested-invariant |
| 1.4 | VERIFIED | generate-readme byte-faithful |
| 1.5 | VERIFIED | 1.0.0/63/sorted/stats + _site parity |
| 2.1 | PARTIAL | hyphen fail-open + ? P3; sabotage caught |
| 2.2 | VERIFIED | deny-first + last-match-wins; sabotage caught; enforcement unverifiable (billing) |
| 2.3 | VERIFIED | wildcard/explicit/skills[]; sabotage caught |
| 2.4 | VERIFIED | resource deny/allow live + sabotage caught |
| 2.5 | PARTIAL | opencode/claude OK but AB-2.5-codex-transport P0 |
| 2.6 | VERIFIED | SPIKE_VERIFY_OK byte-equal |
| 3.1 | VERIFIED | stripJsonComments + jsonc import |
| 3.2 | VERIFIED | round-trips byte-equal |
| 3.3 | VERIFIED | rejects unknown; P3 silent-default |
| 3.4 | VERIFIED | UMD node:vm dependency-free |
| 4.1 | VERIFIED | 2024-11-05 + Inspector 2.11.0 4 tools |
| 4.2 | VERIFIED | exactly 4 tools |
| 4.3 | VERIFIED | filters + limit clamp |
| 4.4 | VERIFIED | compile deny-first + details |
| 4.5 | VERIFIED | -32601/-32602/-32600/-32700 + no logs |
| 5.1 | VERIFIED | Chromium relative + 63 + zero errors |
| 5.2 | PARTIAL | full pass except AB-5.2 P2 |
| 5.3 | PARTIAL | SITE_BUILT 63/9654B but P2+P3 |
| 5.4 | PARTIAL | rel-hold but P1+P1+P0 |
| 5.5 | PARTIAL | scheme-hold but P1+P0 |
| 5.6 | PARTIAL | argv-hold but P0+P0 |
| 6.1 | BROKEN | AB-6.1 P0 |
| 6.2 | PARTIAL | current+clean but EOL floor P1 + placement P3 |
| 6.3 | PARTIAL | sound + live 200 but deploy-pages stale |
| 6.4 | VERIFIED | SPDX + spot-checks + 7 rows |
| 7.1 | VERIFIED | order + sabotage caught |
| 7.2 | PARTIAL | pinned but AB-7.2 P1 |
| 7.3 | VERIFIED | 119 files/no creep/no secrets + P2 dead allows |
| 7.4 | PARTIAL | v2/v1/codex verified but hyphen P1 + transport P3 |
| 7.5 | BROKEN | 3 servers real but 4 P0 + 1 P1 invented |

## Sabotage Results

| Invariant | One-line sabotage (file:line, before -> after) | Suite result | Caught? |
|-----------|-----------------------------------------------|--------------|---------|
| 1.3 dup-id | scripts/utils/catalog.js:129 `if (seenIds.has(doc.id))` -> `if (false)` | 43/43 PASS | NO (P1) |
| 2.1 normalize | src/core/compiler.js:35 `_` -> `-` | 28/15 fail | YES |
| 2.2 deny-first | src/core/compiler.js:310 deny -> allow | 39/4 FAIL | YES |
| 2.3 tool-deny | src/core/compiler.js:335 `sel.deniedTools.forEach` -> `[].forEach` | 40/3 FAIL | YES |
| 2.4 resource-deny | compiler.js:347-349 deny block -> comment / deny->allow | RED fixture diff | YES |
| 4.1 protocol | src/mcp/server.js:27 2024-11-05 -> 2025-06-18 | 42/1 FAIL | YES |
| 4.5 errcode | src/mcp/server.js:489 -32601 -> -32600 | RED exit 1 | YES |
| 5.3 nojekyll | scripts/build-site.js:114 write -> comment | stale 43/43 PASS; clean 42/1 FAIL | PARTIAL (P2 hygiene) |
| 7.1 site artifact | scripts/build-site.js:92 registry.json -> .bak (+rm -rf _site) | RED catalog.test.js:173 | YES |
| 7.1 ordering | rm -rf _site && npm test | RED 42/43 :171 (incident reproduced) | YES |
| 5.4 traversal weak | local-server.js:367-376 false -> true | 43/43 GREEN | NO (P0) |
| 5.4 traversal strong | local-server.js:375 `!includes('..')` -> `return true` | 43/43 GREEN | NO (P0) |
| 5.5 baseUrl | local-server.js:153 https? gate -> if(false) | 43/43 GREEN | NO (P0) |
| 5.6 shell | local-server.js:247 + shell:true | 43/43 GREEN | NO (P0) |
| validator neuter | scripts/utils/catalog.js validate -> true | 43/43 GREEN | NO (P1) |

## Regression Ledger

| Previous finding ID | Previous priority | Status now | Evidence |
|---|---|---|---|
| First run | — | — | No previous report; nothing to re-verify. |

## Not Audited / Unverifiable

- Node 18/20/22 matrix (6.2): only Node 26 + 24 present; 18/20 EOL. Needs 18/20/22 runners.
- Live OpenCode enforcement (2.2/2.3/2.5): Insufficient Balance (no keys). Needs funded account.
- Hyphen runtime normalization: unobservable without execution. Needs funded run.
- Pages deploy + fallback-trigger (5.1/6.3): no deploys allowed. Needs deploy rights.
- Issue submit (5.2): href only. No GH writes allowed.
- claude -p execution: handshake only.
- Archived-flag sweep (~40 URLs): status only. Needs gh api sweep.
- cursor/windsurf/copilot/gemini binaries (7.4): names only. Needs harness installs.
- websocket enum, dist/content emptiness, js-yaml lag: cosmetic/by-design/below-bar (see Beta).
- Full fetch-depth exploit + auto-commit abuse: static only. No CI runs allowed.
- Upstream license full sweep (6.4): spot-checks only. Needs upstream access.
- Notion count 25→24 drift: upstream churn; pin exact versions.
