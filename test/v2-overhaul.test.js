// test/v2-overhaul.test.js
// Tests for the v2.0 overhaul:
//   - Multi-client compilation (Pi, Gemini CLI, Cursor, Windsurf, Copilot)
//   - Permission trace simulator (`traceV2Permission`)
//   - Multi-client config importing (Pi settings.json/mcp.json, Gemini, Cursor .mdc, VS Code)
//   - Weighted multi-signal classifier (`src/core/classifier.js` & `scripts/scout.js`)
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { compileAgentRecipe, traceV2Permission } = require('../src/core/compiler');
const { parseUploadedConfig } = require('../src/core/importer');
const { classifyManifest } = require('../src/core/classifier');

const SAMPLE_REGISTRY = [
  {
    id: 'postgres-mcp-connector',
    kind: 'mcp-server',
    tagline: 'Read/write PostgreSQL MCP server',
    mcp: {
      server_name: 'postgres-prod',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@example/postgres-mcp'],
      tools: ['query', 'list-tables', 'drop-table']
    }
  }
];

describe('v2 multi-client compilation (Pi, Gemini CLI, Cursor, Windsurf, Copilot)', () => {
  it('compiles Pi .pi/settings.json and .pi/mcp.json with per-tool toolExposure', () => {
    const out = compileAgentRecipe(
      {
        slug: 'pi-auditor',
        description: 'Pi SQL auditor',
        mode: 'subagent',
        model: 'anthropic/claude-sonnet-4-5',
        prompt: 'Audit SQL queries safely.',
        skills: ['rust-secure-coding'],
        mcpSelections: [
          { server: 'postgres-prod', tools: ['query', 'list-tables'], deniedTools: ['drop-table'] }
        ],
        piOptions: {
          thinkingLevel: 'high',
          mcpExposure: 'codemode',
          defaultTools: ['+codemode', '+tool_search']
        }
      },
      SAMPLE_REGISTRY
    );

    assert.equal(out.piSettingsJson.$schema, 'https://pi.dev/schemas/settings.schema.json');
    assert.equal(out.piSettingsJson.defaultProvider, 'anthropic');
    assert.equal(out.piSettingsJson.defaultModel, 'claude-sonnet-4-5');
    assert.equal(out.piSettingsJson.defaultThinkingLevel, 'high');
    assert.deepEqual(out.piSettingsJson.defaultTools, ['+codemode', '+tool_search']);
    assert.deepEqual(out.piSettingsJson.skills, ['.pi/skills/rust-secure-coding']);

    const pg = out.piMcpJson.mcpServers['postgres-prod'];
    assert.ok(pg, 'expected postgres-prod in piMcpJson.mcpServers');
    assert.equal(pg.exposure, 'hidden');
    assert.deepEqual(pg.toolExposure, {
      query: 'codemode',
      'list-tables': 'codemode',
      'drop-table': 'hidden'
    });
    assert.ok(out.piAgentsMd.includes('# Agent: pi-auditor'));
  });

  it('compiles Gemini CLI, Cursor .mdc, Windsurf, and Copilot outputs', () => {
    const out = compileAgentRecipe(
      {
        slug: 'polyglot-dev',
        description: 'Cross-client developer agent',
        prompt: 'Write clean, tested code.',
        skills: ['typescript-strict-patterns'],
        mcpSelections: [{ server: 'postgres-prod', tools: ['query'], deniedTools: ['drop-table'] }]
      },
      SAMPLE_REGISTRY
    );

    // Gemini CLI
    assert.deepEqual(out.geminiSettingsJson.mcpServers['postgres-prod'].includeTools, ['query']);
    assert.deepEqual(out.geminiSettingsJson.mcpServers['postgres-prod'].excludeTools, ['drop-table']);
    assert.ok(out.geminiMd.includes('polyglot-dev'));

    // Cursor
    assert.ok(out.cursorRuleMdc.includes('alwaysApply: true'));
    assert.ok(out.cursorMcpJson.mcpServers['postgres-prod']);

    // Windsurf & Copilot
    assert.ok(out.windsurfRules.includes('typescript-strict-patterns'));
    assert.ok(out.vscodeMcpJson.servers['postgres-prod']);
    assert.ok(out.copilotInstructionsMd.includes('polyglot-dev'));
  });

  it('traceV2Permission returns winning rule index and trace', () => {
    const out = compileAgentRecipe(
      {
        slug: 'trace-agent',
        description: 'd',
        prompt: 'p',
        skills: ['s1'],
        mcpSelections: [{ server: 'postgres-prod', tools: ['*'], deniedTools: ['drop-table'] }]
      },
      SAMPLE_REGISTRY
    );
    const perms = out.opencodeV2.agents['trace-agent'].permissions;
    const trAllow = traceV2Permission(perms, 'postgres-prod_query', '*');
    assert.equal(trAllow.decision, 'allow');
    assert.ok(trAllow.matchedIndex >= 0);

    const trDeny = traceV2Permission(perms, 'postgres-prod_drop-table', '*');
    assert.equal(trDeny.decision, 'deny');
    assert.equal(trDeny.matchedRule.action, 'postgres-prod_drop-table');
  });
});

describe('v2 multi-client importer (Pi, Gemini, VS Code, Cursor .mdc)', () => {
  it('imports Pi settings.json and Pi mcp.json toolExposure', () => {
    const piSettings = JSON.stringify({
      $schema: 'https://pi.dev/schemas/settings.schema.json',
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-5',
      defaultTools: ['+codemode'],
      skills: ['.pi/skills/rust-secure-coding']
    });
    const r1 = parseUploadedConfig('settings.json', piSettings);
    assert.equal(r1[0].model, 'anthropic/claude-sonnet-4-5');
    assert.deepEqual(r1[0].skills, ['rust-secure-coding']);

    const piMcp = JSON.stringify({
      mcpServers: {
        'postgres-prod': {
          command: 'npx',
          args: ['-y', '@example/postgres-mcp'],
          exposure: 'hidden',
          toolExposure: {
            query: 'codemode',
            'drop-table': 'hidden'
          }
        }
      }
    });
    const r2 = parseUploadedConfig('mcp.json', piMcp);
    assert.deepEqual(r2[0].mcpSelections, [
      { server: 'postgres-prod', tools: ['query'], deniedTools: ['drop-table'], allowResources: false }
    ]);
  });

  it('imports Cursor .mdc rule files', () => {
    const mdc = [
      '---',
      'description: "Cursor rule agent"',
      'alwaysApply: true',
      '---',
      '',
      'Follow strict TypeScript patterns.'
    ].join('\n');
    const r = parseUploadedConfig('.cursor/rules/ts-agent.mdc', mdc);
    assert.equal(r[0].slug, 'ts-agent');
    assert.equal(r[0].description, 'Cursor rule agent');
    assert.ok(r[0].prompt.includes('Follow strict TypeScript patterns.'));
  });
});

describe('v2 multi-signal classifier (src/core/classifier.js)', () => {
  it('scores Ghidra reverse-engineering MCP server with high confidence and reasons', () => {
    const res = classifyManifest(
      { name: 'ghidra-re-mcp', description: 'Ghidra reverse engineering MCP server for binary disassembly' },
      { keywords: ['mcp-server', 'ghidra', 'reverse-engineering'], dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' } }
    );
    assert.equal(res.kind, 'mcp-server');
    assert.equal(res.category, 'mcp-servers/security-re');
    assert.ok(res.confidence >= 60, `expected confidence >= 60, got ${res.confidence}`);
    assert.ok(Array.isArray(res.reasons) && res.reasons.length >= 2);
  });

  it('detects Pi packages via keywords/dependencies and keeps taxonomy-valid harnesses', () => {
    const res = classifyManifest(
      { name: '@earendil-works/pi-review', description: 'Code review workflow extension for Pi' },
      { keywords: ['pi-package'], peerDependencies: { '@earendil-works/pi-coding-agent': '*' } }
    );
    assert.equal(res.isPiPackage, true);
    assert.equal(res.kind, 'plugin');
    assert.equal(res.category, 'plugins/cross-harness');
    assert.ok(res.topics.includes('pi'));
  });

  it('avoids short-word false positives (e.g. "go" inside "good" or "category")', () => {
    const res = classifyManifest(
      { name: 'python-good-fastapi-skill', description: 'A good SKILL.md playbook for Python FastAPI services and Pydantic models' },
      { keywords: ['skill', 'python', 'fastapi'] }
    );
    assert.equal(res.kind, 'skill');
    assert.equal(res.category, 'skills/coding/python');
  });
});

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const yaml = require("js-yaml");
const ROOT = path.join(__dirname, "..");
const { parseIssueBody, buildEntryFromIssue } = require("../scripts/submit-entry");
const { buildEntryYaml } = require("../scripts/scout");
const { loadTaxonomy, validateEntryObject } = require("../scripts/utils/catalog");

describe("submit-entry.js GitHub Issue Form parser (required-field asterisks)", () => {
  it("parses add-entry.yml Issue Form headings with trailing * asterisks", () => {
    const body = [
      "### Entry name *",
      "",
      "Cargo Audit Supply Chain Skill",
      "",
      "### Kind *",
      "",
      "skill",
      "",
      "### Category *",
      "",
      "skills/coding/rust",
      "",
      "### Repository URL *",
      "",
      "https://github.com/rustsec/rustsec",
      "",
      "### Tagline *",
      "",
      "Audit Cargo.lock dependencies for security advisories.",
      "",
      "### Description *",
      "",
      "Comprehensive Rust supply-chain auditing skill using cargo-audit and cargo-deny.",
      "",
      "### Supported harnesses *",
      "",
      "- [x] OpenCode (opencode)",
      "- [x] Claude Code (claude-code)",
      "- [ ] Codex CLI (codex)",
      "",
      "### Languages",
      "",
      "rust, toml",
      "",
      "### License",
      "",
      "MIT"
    ].join("\n");

    const fields = parseIssueBody(body);
    assert.equal(fields["entry name"], "Cargo Audit Supply Chain Skill");
    assert.equal(fields.kind, "skill");
    assert.equal(fields.category, "skills/coding/rust");

    const built = buildEntryFromIssue({ number: 42, title: "[entry] Cargo Audit Supply Chain Skill", body }, ROOT);
    assert.equal(built.doc.id, "cargo-audit-supply-chain-skill");
    assert.equal(built.doc.kind, "skill");
    assert.equal(built.doc.category, "skills/coding/rust");
    assert.deepEqual(built.doc.harnesses, ["opencode", "claude-code"]);
    assert.deepEqual(built.doc.languages, ["rust", "toml"]);
    assert.equal(built.relPath, "data/skills/coding/rust/cargo-audit-supply-chain-skill.yaml");
    const valid = validateEntryObject(built.doc, ROOT);
    assert.equal(valid.valid, true);
  });

  it("parses publish-agent.yml Issue Form headings with trailing * and normalizes mcp_selections", () => {
    const body = [
      "### Agent name / slug *",
      "",
      "rust-postgres-sentinel",
      "",
      "### Description *",
      "",
      "Read-only Postgres and Rust security auditor.",
      "",
      "### Model",
      "",
      "anthropic/claude-sonnet-4-5",
      "",
      "### System prompt *",
      "",
      "Audit SQL queries and Rust database drivers for injection flaws.",
      "",
      "### Skills",
      "",
      "rust-secure-coding, postgres-query-tuning",
      "",
      "### MCP selections (JSON)",
      "",
      "[{\"server\": \"postgres-prod\", \"tools\": [\"execute_query\", \"list_tables\", \"drop_table\"], \"deniedTools\": [\"drop_table\"]}]",
      "",
      "### Target harness",
      "",
      "opencode"
    ].join("\n");

    const built = buildEntryFromIssue({ number: 43, title: "[agent] rust-postgres-sentinel", body }, ROOT);
    assert.equal(built.isAgentForm, true);
    assert.equal(built.doc.id, "rust-postgres-sentinel");
    assert.equal(built.doc.kind, "agent");
    assert.equal(built.doc.synthetic, true);
    assert.deepEqual(built.doc.agent_preset.skills, ["rust-secure-coding", "postgres-query-tuning"]);
    assert.deepEqual(built.doc.agent_preset.mcp_selections, [
      { server: "postgres-prod", tools: ["execute_query", "list_tables"] }
    ]);
    const valid = validateEntryObject(built.doc, ROOT);
    assert.equal(valid.valid, true);
  });

  it("extracts fenced yaml recipe blocks from WebUI markdown issues", () => {
    const body = [
      "Agent crafted in the Agent Builder WebUI.",
      "",
      "```yaml",
      "slug: webui-shared-agent",
      "description: \"Shared from WebUI\"",
      "mode: subagent",
      "model: \"anthropic/claude-sonnet-4-5\"",
      "prompt: \"Inspect code safely.\"",
      "skills:",
      "  - rust-secure-coding",
      "mcp_selections:",
      "  - server: github",
      "    tools: [get_pull_request, list_commits]",
      "```"
    ].join("\n");

    const built = buildEntryFromIssue({ number: 44, title: "Publish agent: webui-shared-agent", body }, ROOT);
    assert.equal(built.doc.id, "webui-shared-agent");
    assert.equal(built.doc.agent_preset.prompt, "Inspect code safely.");
    assert.deepEqual(built.doc.agent_preset.skills, ["rust-secure-coding"]);
    assert.deepEqual(built.doc.agent_preset.mcp_selections, [
      { server: "github", tools: ["get_pull_request", "list_commits"] }
    ]);
  });

  it("CLI --dry-run succeeds on an asterisk-labeled issue JSON file", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "submit-entry-test-"));
    try {
      const issueFile = path.join(tmpDir, "issue.json");
      fs.writeFileSync(
        issueFile,
        JSON.stringify({
          number: 99,
          title: "[entry] Test Dry Run Skill",
          body: "### Entry name *\n\nTest Dry Run Skill\n\n### Kind *\n\nskill\n\n### Category *\n\nskills/coding/rust\n\n### Repository URL *\n\nhttps://github.com/rust-lang/rust\n\n### Tagline *\n\nDry run test skill."
        }),
        "utf8"
      );
      const out = execFileSync(
        process.execPath,
        [path.join(ROOT, "scripts", "submit-entry.js"), "--issue", issueFile, "--dry-run"],
        { encoding: "utf8" }
      );
      assert.match(out, /SUBMIT_OK \(dry-run\): would write data\/skills\/coding\/rust\/test-dry-run-skill\.yaml/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("workflows and scout PR conversion hardening", () => {
  it("issues.yml convert job uses --open-pr with write permissions (not --dry-run)", () => {
    const wf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "issues.yml"), "utf8");
    const parsed = yaml.load(wf);
    assert.ok(parsed.jobs && parsed.jobs.convert, "issues.yml must define convert job");
    assert.equal(parsed.jobs.convert.permissions.contents, "write");
    assert.equal(parsed.jobs.convert.permissions["pull-requests"], "write");
    assert.equal(parsed.jobs.convert.permissions.issues, "write");
    assert.ok(wf.includes("submit-entry.js --issue issue.json --open-pr"), "convert job must pass --open-pr");
    assert.ok(!wf.includes("submit-entry.js --issue issue.json --dry-run"), "convert job must not use --dry-run in CI");
  });

  it("ocr-review.yml exists and is valid YAML for ocr.yml workflow_call", () => {
    const ocrReviewPath = path.join(ROOT, ".github", "workflows", "ocr-review.yml");
    assert.ok(fs.existsSync(ocrReviewPath), ".github/workflows/ocr-review.yml must exist");
    const parsed = yaml.load(fs.readFileSync(ocrReviewPath, "utf8"));
    assert.ok(parsed.on && parsed.on.workflow_call !== undefined, "ocr-review.yml must support workflow_call");
  });

  it("scout.js clears persisted extraheader before push and uses --force on scout branches", () => {
    const scoutSrc = fs.readFileSync(path.join(ROOT, "scripts", "scout.js"), "utf8");
    assert.ok(scoutSrc.includes("--unset-all"), "scout.js must clear persisted extraheader to prevent duplicate Authorization headers");
    assert.ok(scoutSrc.includes("'--force'"), "scout.js must force-push scout/<id> branches so retries never fail on non-fast-forward");
    const { ids } = loadTaxonomy(ROOT);
    const res = buildEntryYaml(
      {
        name: "pi-sample-ext",
        repo: "https://github.com/earendil-works/pi",
        kind: "plugin",
        category: "plugins/cross-harness",
        harnesses: ["pi", "opencode"],
        tagline: "Sample Pi extension",
        license: "MIT"
      },
      ids
    );
    assert.equal(res.ok, true);
    const doc = yaml.load(res.text);
    assert.deepEqual(doc.harnesses, ["opencode"]);
    assert.ok(doc.source_attribution.includes("Discovered by Agent-Builder scout"));
  });
});
