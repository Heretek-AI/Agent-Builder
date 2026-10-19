// test/compiler.test.js
// Milestone 5: deny-first permission scoping, MCP normalization, resource
// scoping, and config import/export round-trips.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { normalizeMcpId, compileAgentRecipe, evaluateV2Permission } = require('../src/core/compiler');
const { parseUploadedConfig, stripJsonComments } = require('../src/core/importer');

// Registry fixture: known servers order github -> figma -> postgres-prod.
const REGISTRY = [
  { id: 'github-mcp', kind: 'mcp-server', mcp: { server_name: 'github', command: 'npx', args: ['-y', '@example/github-mcp'], tools: ['repo', 'pr'] } },
  { id: 'figma-mcp', kind: 'mcp-server', mcp: { server_name: 'figma', command: 'npx', args: ['-y', '@example/figma-mcp'], tools: ['file'] } },
  {
    id: 'postgres-mcp-connector',
    kind: 'mcp-server',
    mcp: {
      server_name: 'postgres-prod',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@example/postgres-mcp'],
      tools: ['query', 'list-tables', 'describe-table', 'drop-table']
    }
  }
];

// Spike fixture reference (brief Section 4): the exact Markdown that the
// db-security-auditor recipe must compile to.
const FIXTURE_RECIPE = {
  slug: 'db-security-auditor',
  description: 'Database security auditor with Rust/SQL skills and read-only Postgres MCP',
  mode: 'subagent',
  model: 'anthropic/claude-sonnet-4-5',
  prompt: 'Audit SQL queries and schema migrations for injection and privilege escalation.',
  skills: ['rust-secure-coding', 'sql-query-audit'],
  mcpSelections: [{ server: 'postgres-prod', tools: ['query', 'list-tables'], deniedTools: ['drop-table'] }]
};

const FIXTURE_MARKDOWN = [
  '---',
  'description: "Database security auditor with Rust/SQL skills and read-only Postgres MCP"',
  'mode: subagent',
  'model: "anthropic/claude-sonnet-4-5"',
  'permission:',
  '  skill:',
  '    "*": deny',
  '    "rust-secure-coding": allow',
  '    "sql-query-audit": allow',
  '  "github_*": deny',
  '  "figma_*": deny',
  '  "postgres_prod_*": deny',
  '  "postgres_prod_query": allow',
  '  "postgres_prod_list_tables": allow',
  '  "postgres_prod_drop_table": deny',
  '---',
  '',
  'Audit SQL queries and schema migrations for injection and privilege escalation.',
  ''
].join('\n');

describe('normalizeMcpId', () => {
  it('maps postgres-prod + read-query to postgres_prod_read_query', () => {
    assert.equal(normalizeMcpId('postgres-prod'), 'postgres_prod');
    assert.equal(normalizeMcpId('read-query'), 'read_query');
    assert.equal(
      normalizeMcpId('postgres-prod') + '_' + normalizeMcpId('read-query'),
      'postgres_prod_read_query'
    );
  });

  it('trims, collapses runs, and strips edge underscores', () => {
    assert.equal(normalizeMcpId('  read-query '), 'read_query');
    assert.equal(normalizeMcpId('list--tables'), 'list_tables');
    assert.equal(normalizeMcpId('--weird__name--'), 'weird_name');
    assert.equal(normalizeMcpId('a.b/c:d'), 'a_b_c_d');
    assert.equal(normalizeMcpId('---'), '');
  });

  it('compiled actions never contain raw hyphens', () => {
    const out = compileAgentRecipe(
      {
        slug: 'x',
        description: 'd',
        prompt: 'p',
        skills: [],
        mcpSelections: [{ server: 'postgres-prod', tools: ['read-query', 'list-tables'] }]
      },
      []
    );
    const actions = out.opencodeV2.agents.x.permissions.map((r) => r.action);
    assert.ok(actions.includes('postgres_prod_read_query'));
    assert.ok(actions.includes('postgres_prod_list_tables'));
    for (const a of actions) {
      assert.ok(!a.includes('-'), `action ${a} must be normalized`);
    }
  });
});

describe('deny-first skill scoping', () => {
  it('emits deny "*" first, then explicit allows', () => {
    const out = compileAgentRecipe(FIXTURE_RECIPE, REGISTRY);
    const perms = out.opencodeV2.agents['db-security-auditor'].permissions;
    assert.deepEqual(perms.slice(0, 3), [
      { action: 'skill', resource: '*', effect: 'deny' },
      { action: 'skill', resource: 'rust-secure-coding', effect: 'allow' },
      { action: 'skill', resource: 'sql-query-audit', effect: 'allow' }
    ]);
    assert.equal(evaluateV2Permission(perms, 'skill', 'rust-secure-coding'), 'allow');
    assert.equal(evaluateV2Permission(perms, 'skill', 'sql-query-audit'), 'allow');
    assert.equal(evaluateV2Permission(perms, 'skill', 'other-skill'), 'deny');
  });

  it('mirrors deny-first ordering in the v1 object schema', () => {
    const out = compileAgentRecipe(FIXTURE_RECIPE, REGISTRY);
    const perm = out.opencodeV1.agent['db-security-auditor'].permission;
    assert.deepEqual(perm.skill, {
      '*': 'deny',
      'rust-secure-coding': 'allow',
      'sql-query-audit': 'allow'
    });
    assert.deepEqual(Object.keys(perm).slice(0, 4), [
      'skill',
      'github_*',
      'figma_*',
      'postgres_prod_*'
    ]);
    assert.equal(perm['postgres_prod_query'], 'allow');
    assert.equal(perm['postgres_prod_drop_table'], 'deny');
  });

  it('shuts off skills completely when skills is []', () => {
    const out = compileAgentRecipe(
      { slug: 'locked', description: 'd', prompt: 'p', skills: [], mcpSelections: [] },
      []
    );
    const perms = out.opencodeV2.agents.locked.permissions;
    const skillRules = perms.filter((r) => r.action === 'skill');
    assert.deepEqual(skillRules, [{ action: 'skill', resource: '*', effect: 'deny' }]);
    assert.equal(evaluateV2Permission(perms, 'skill', 'anything'), 'deny');
    assert.ok(out.opencodeMarkdown.includes('    "*": deny\n'));
    assert.ok(!out.opencodeMarkdown.includes('allow'), 'shutoff markdown must contain no allow rules');
    const v1skill = out.opencodeV1.agent.locked.permission.skill;
    assert.deepEqual(v1skill, { '*': 'deny' });
  });
});

describe('wildcard vs per-tool vs explicit deny', () => {
  it('wildcard allow opens the server but an explicit tool deny still wins', () => {
    const out = compileAgentRecipe(
      {
        slug: 'w',
        description: 'd',
        prompt: 'p',
        skills: [],
        mcpSelections: [{ server: 'srv-a', tools: ['*'], deniedTools: ['drop'] }]
      },
      []
    );
    const perms = out.opencodeV2.agents.w.permissions;
    assert.equal(evaluateV2Permission(perms, 'srv_a_anything', '*'), 'allow');
    assert.equal(evaluateV2Permission(perms, 'srv_a_drop', '*'), 'deny');
  });

  it('per-tool allow opens only the listed tools', () => {
    const out = compileAgentRecipe(
      {
        slug: 'p',
        description: 'd',
        prompt: 'p',
        skills: [],
        mcpSelections: [{ server: 'srv-b', tools: ['read'] }]
      },
      []
    );
    const perms = out.opencodeV2.agents.p.permissions;
    assert.equal(evaluateV2Permission(perms, 'srv_b_read', '*'), 'allow');
    assert.equal(evaluateV2Permission(perms, 'srv_b_write', '*'), 'deny');
  });
});

describe('MCP resource scoping', () => {
  it('denies resource listing/reading by default, allows per-server with allowResources', () => {
    const out = compileAgentRecipe(
      {
        slug: 'r',
        description: 'd',
        prompt: 'p',
        skills: [],
        mcpSelections: [{ server: 'postgres-prod', tools: ['query'], allowResources: true }]
      },
      []
    );
    const perms = out.opencodeV2.agents.r.permissions;
    assert.ok(perms.some((r) => r.action === 'opencode_list_mcp_resources' && r.resource === '*' && r.effect === 'deny'));
    assert.ok(perms.some((r) => r.action === 'opencode_read_mcp_resource' && r.resource === '*' && r.effect === 'deny'));
    assert.ok(perms.some((r) => r.action === 'opencode_list_mcp_resources' && r.resource === 'postgres-prod' && r.effect === 'allow'));
    assert.ok(perms.some((r) => r.action === 'opencode_read_mcp_resource' && r.resource === 'postgres-prod:*' && r.effect === 'allow'));
    assert.equal(evaluateV2Permission(perms, 'opencode_list_mcp_resources', 'postgres-prod'), 'allow');
    assert.equal(evaluateV2Permission(perms, 'opencode_read_mcp_resource', 'postgres-prod:public.users'), 'allow');
    assert.equal(evaluateV2Permission(perms, 'opencode_list_mcp_resources', 'other-server'), 'deny');
    assert.equal(evaluateV2Permission(perms, 'opencode_read_mcp_resource', '*'), 'deny');
  });

  it('denies resource access when allowResources is not set', () => {
    const out = compileAgentRecipe(
      {
        slug: 'r2',
        description: 'd',
        prompt: 'p',
        skills: [],
        mcpSelections: [{ server: 'postgres-prod', tools: ['query'] }]
      },
      []
    );
    const perms = out.opencodeV2.agents.r2.permissions;
    assert.equal(evaluateV2Permission(perms, 'opencode_list_mcp_resources', 'postgres-prod'), 'deny');
    assert.equal(evaluateV2Permission(perms, 'opencode_read_mcp_resource', 'postgres-prod'), 'deny');
  });
});

describe('spike fixture exact markdown', () => {
  it('matches the verified db-security-auditor markdown byte-for-byte', () => {
    const out = compileAgentRecipe(FIXTURE_RECIPE, REGISTRY);
    assert.strictEqual(out.opencodeMarkdown, FIXTURE_MARKDOWN);
  });

  it('matches the full v2 permission array exactly', () => {
    const out = compileAgentRecipe(FIXTURE_RECIPE, REGISTRY);
    assert.deepEqual(out.opencodeV2.agents['db-security-auditor'].permissions, [
      { action: 'skill', resource: '*', effect: 'deny' },
      { action: 'skill', resource: 'rust-secure-coding', effect: 'allow' },
      { action: 'skill', resource: 'sql-query-audit', effect: 'allow' },
      { action: 'github_*', resource: '*', effect: 'deny' },
      { action: 'figma_*', resource: '*', effect: 'deny' },
      { action: 'postgres_prod_*', resource: '*', effect: 'deny' },
      { action: 'postgres_prod_query', resource: '*', effect: 'allow' },
      { action: 'postgres_prod_list_tables', resource: '*', effect: 'allow' },
      { action: 'postgres_prod_drop_table', resource: '*', effect: 'deny' },
      { action: 'opencode_list_mcp_resources', resource: '*', effect: 'deny' },
      { action: 'opencode_read_mcp_resource', resource: '*', effect: 'deny' }
    ]);
  });
});

describe('recipe flexibility', () => {
  it('accepts name/systemPrompt/mcp aliases', () => {
    const out = compileAgentRecipe(
      {
        name: 'alias-agent',
        description: 'd',
        systemPrompt: 'Do things.',
        skills: ['s1'],
        mcp: [{ server: 'srv', tools: ['t1'] }]
      },
      []
    );
    assert.equal(out.slug, 'alias-agent');
    assert.ok(out.opencodeMarkdown.includes('Do things.'));
    const perms = out.opencodeV2.agents['alias-agent'].permissions;
    assert.equal(evaluateV2Permission(perms, 'srv_t1', '*'), 'allow');
    assert.equal(evaluateV2Permission(perms, 'srv_other', '*'), 'deny');
  });

  it('supports mode primary and emits claude/codex/install/bundle outputs', () => {
    const out = compileAgentRecipe(
      {
        slug: 'full',
        description: 'Full export',
        mode: 'primary',
        model: 'anthropic/claude-sonnet-4-5',
        prompt: 'Body.',
        skills: ['s1'],
        mcpSelections: [{ server: 'postgres-prod', tools: ['query'], deniedTools: ['drop-table'] }]
      },
      REGISTRY
    );
    assert.equal(out.opencodeV2.agents.full.mode, 'primary');
    assert.deepEqual(out.claudeCodeMcp.mcpServers['postgres-prod'], {
      command: 'npx',
      args: ['-y', '@example/postgres-mcp'],
      transport: 'stdio'
    });
    assert.ok(out.claudeCodeAgentMd.includes('name: full'));
    assert.ok(out.claudeCodeAgentMd.includes('mcp__postgres_prod__query'));
    assert.ok(out.claudeCodeAgentMd.includes('.claude/skills/s1/SKILL.md'));
    assert.ok(out.codexConfigToml.includes('[mcp_servers.postgres-prod]'));
    assert.ok(out.codexConfigToml.includes('enabled_tools = ["query"]'));
    assert.ok(out.codexConfigToml.includes('disabled_tools = ["drop-table"]'));
    assert.ok(out.installScriptSh.startsWith('#!/bin/sh'));
    assert.ok(out.installScriptSh.includes('mkdir -p'));
    assert.ok(!out.installScriptSh.includes('sk-ant-') && !out.installScriptSh.includes('SECRET'));
    const paths = out.bundleFiles.map((f) => f.path);
    assert.ok(paths.includes('.opencode/agent/full.md'));
    assert.ok(paths.includes('.claude/agents/full.md'));
    assert.ok(paths.includes('opencode.full.v2.json'));
    for (const f of out.bundleFiles) {
      assert.ok(typeof f.content === 'string' && f.content.length > 0, `${f.path} must have content`);
    }
  });

  it('evaluateV2Permission defaults to allow and fails closed on bad input', () => {
    assert.equal(evaluateV2Permission([], 'anything', 'anything'), 'allow');
    assert.throws(() => evaluateV2Permission({}, 'a', 'b'), /must be an array/);
    assert.throws(
      () => evaluateV2Permission([{ action: 'a', resource: 'b', effect: 'maybe' }], 'a', 'b'),
      /invalid effect/
    );
  });
});

describe('importer: comments, v1, v2, claude, markdown', () => {
  it('strips // and /* */ comments while preserving comment-like strings', () => {
    const raw = '{\n// leading\n"a": "x // not a comment", /* inline */ "b": "y /* still string */"\n}';
    assert.deepEqual(JSON.parse(stripJsonComments(raw)), {
      a: 'x // not a comment',
      b: 'y /* still string */'
    });
  });

  it('imports opencode.jsonc v2 with comments', () => {
    const raw = [
      '{',
      '  // agent registry with comments',
      '  "agents": {',
      '    "demo": {',
      '      "description": "demo agent // kept",',
      '      "mode": "subagent",',
      '      /* permissions block */',
      '      "permissions": [',
      '        { "action": "skill", "resource": "*", "effect": "deny" },',
      '        { "action": "skill", "resource": "a-skill", "effect": "allow" },',
      '        { "action": "postgres_prod_*", "resource": "*", "effect": "deny" },',
      '        { "action": "postgres_prod_query", "resource": "*", "effect": "allow" }',
      '      ]',
      '    }',
      '  }',
      '}'
    ].join('\n');
    const recipes = parseUploadedConfig('opencode.jsonc', raw);
    assert.equal(recipes.length, 1);
    assert.equal(recipes[0].slug, 'demo');
    assert.equal(recipes[0].description, 'demo agent // kept');
    assert.deepEqual(recipes[0].skills, ['a-skill']);
    assert.deepEqual(recipes[0].mcpSelections, [
      { server: 'postgres_prod', tools: ['query'], deniedTools: [], allowResources: false }
    ]);
  });

  it('round-trips opencode.json v2 (import then re-export is identical)', () => {
    const original = compileAgentRecipe(FIXTURE_RECIPE, REGISTRY);
    const json = JSON.stringify(original.opencodeV2, null, 2);
    const recipes = parseUploadedConfig('opencode.json', json);
    assert.equal(recipes.length, 1);
    assert.equal(recipes[0].slug, 'db-security-auditor');
    assert.equal(recipes[0].mode, 'subagent');
    assert.equal(recipes[0].model, 'anthropic/claude-sonnet-4-5');
    assert.deepEqual(recipes[0].skills, ['rust-secure-coding', 'sql-query-audit']);
    assert.deepEqual(recipes[0].mcpSelections, [
      { server: 'postgres_prod', tools: ['query', 'list_tables'], deniedTools: ['drop_table'], allowResources: false }
    ]);
    const recompiled = compileAgentRecipe(recipes[0], REGISTRY);
    assert.deepEqual(recompiled.opencodeV2, original.opencodeV2);
    // v2 JSON carries no prompt body (it lives in the agent .md file), so
    // restoring the prompt must reproduce the fixture markdown exactly.
    const withPrompt = compileAgentRecipe(
      Object.assign({}, recipes[0], { prompt: FIXTURE_RECIPE.prompt }),
      REGISTRY
    );
    assert.strictEqual(withPrompt.opencodeMarkdown, FIXTURE_MARKDOWN);
  });

  it('round-trips opencode.json v1 (permission object form)', () => {
    const original = compileAgentRecipe(FIXTURE_RECIPE, REGISTRY);
    const json = JSON.stringify(original.opencodeV1, null, 2);
    const recipes = parseUploadedConfig('opencode.json', json);
    assert.equal(recipes.length, 1);
    assert.equal(recipes[0].slug, 'db-security-auditor');
    assert.deepEqual(recipes[0].skills, ['rust-secure-coding', 'sql-query-audit']);
    assert.deepEqual(recipes[0].mcpSelections, [
      { server: 'postgres_prod', tools: ['query', 'list_tables'], deniedTools: ['drop_table'], allowResources: false }
    ]);
    const recompiled = compileAgentRecipe(recipes[0], REGISTRY);
    assert.deepEqual(recompiled.opencodeV1, original.opencodeV1);
    assert.deepEqual(recompiled.opencodeV2.agents['db-security-auditor'].permissions, original.opencodeV2.agents['db-security-auditor'].permissions);
  });

  it('round-trips claude.json (.mcp.json mcpServers)', () => {
    const original = compileAgentRecipe(FIXTURE_RECIPE, REGISTRY);
    const json = JSON.stringify(original.claudeCodeMcp, null, 2);
    const recipes = parseUploadedConfig('.mcp.json', json);
    assert.equal(recipes.length, 1);
    assert.deepEqual(recipes[0].mcpSelections, [
      { server: 'postgres-prod', tools: ['*'], deniedTools: [], allowResources: false }
    ]);
    const recompiled = compileAgentRecipe(recipes[0], REGISTRY);
    assert.deepEqual(Object.keys(recompiled.claudeCodeMcp.mcpServers), ['postgres-prod']);
    assert.deepEqual(recompiled.claudeCodeMcp, original.claudeCodeMcp);
  });

  it('round-trips .opencode/agent/<name>.md frontmatter', () => {
    const original = compileAgentRecipe(FIXTURE_RECIPE, REGISTRY);
    const recipes = parseUploadedConfig('.opencode/agent/db-security-auditor.md', original.opencodeMarkdown);
    assert.equal(recipes.length, 1);
    assert.equal(recipes[0].slug, 'db-security-auditor');
    assert.equal(recipes[0].description, FIXTURE_RECIPE.description);
    assert.equal(recipes[0].mode, 'subagent');
    assert.equal(recipes[0].model, 'anthropic/claude-sonnet-4-5');
    assert.equal(recipes[0].prompt, FIXTURE_RECIPE.prompt);
    assert.deepEqual(recipes[0].skills, ['rust-secure-coding', 'sql-query-audit']);
    assert.deepEqual(recipes[0].mcpSelections, [
      { server: 'postgres_prod', tools: ['query', 'list_tables'], deniedTools: ['drop_table'], allowResources: false }
    ]);
    const recompiled = compileAgentRecipe(recipes[0], REGISTRY);
    assert.strictEqual(recompiled.opencodeMarkdown, FIXTURE_MARKDOWN);
  });

  it('imports resource allows into allowResources', () => {
    const out = compileAgentRecipe(
      {
        slug: 'res',
        description: 'd',
        prompt: 'p',
        skills: [],
        mcpSelections: [{ server: 'postgres-prod', tools: ['query'], allowResources: true }]
      },
      []
    );
    const recipes = parseUploadedConfig('opencode.json', JSON.stringify(out.opencodeV2));
    assert.deepEqual(recipes[0].mcpSelections, [
      { server: 'postgres_prod', tools: ['query'], deniedTools: [], allowResources: true }
    ]);
  });

  it('rejects unknown shapes with descriptive errors', () => {
    assert.throws(() => parseUploadedConfig('opencode.json', '{not json'), /not valid JSON/);
    assert.throws(() => parseUploadedConfig('opencode.json', '{"foo": 1}'), /does not look like/);
    assert.throws(() => parseUploadedConfig('agent.md', 'no frontmatter here'), /must start with ---/);
    assert.throws(
      () => parseUploadedConfig('opencode.json', '{"agent": {"a": {"permission": {"x_*": "maybe"}}}}'),
      /invalid permission effect/
    );
  });
});

describe('UMD browser compatibility (no module system)', () => {
  function loadInSandbox(relPath) {
    const file = path.join(__dirname, '..', relPath);
    const code = fs.readFileSync(file, 'utf8');
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: relPath });
    return sandbox;
  }

  it('exposes Compiler on the global scope via script tag', () => {
    const sandbox = loadInSandbox('src/core/compiler.js');
    assert.equal(typeof sandbox.Compiler, 'object');
    assert.equal(sandbox.Compiler.normalizeMcpId('a-b'), 'a_b');
    assert.equal(sandbox.Compiler.evaluateV2Permission([], 'x', 'y'), 'allow');
    const out = sandbox.Compiler.compileAgentRecipe(FIXTURE_RECIPE, []);
    assert.ok(out.opencodeMarkdown.includes('db-security-auditor') || out.slug === 'db-security-auditor');
  });

  it('exposes Importer with fallback frontmatter parser (no js-yaml)', () => {
    const sandbox = loadInSandbox('src/core/importer.js');
    assert.equal(typeof sandbox.Importer, 'object');
    const recipes = sandbox.Importer.parseUploadedConfig(
      '.opencode/agent/db-security-auditor.md',
      FIXTURE_MARKDOWN
    );
    // Normalize out of the vm realm (vm arrays carry a foreign prototype).
    const plain = JSON.parse(JSON.stringify(recipes));
    assert.equal(plain[0].slug, 'db-security-auditor');
    assert.deepEqual(plain[0].skills, ['rust-secure-coding', 'sql-query-audit']);
    assert.deepEqual(plain[0].mcpSelections, [
      { server: 'postgres_prod', tools: ['query', 'list_tables'], deniedTools: ['drop_table'], allowResources: false }
    ]);
  });
});
