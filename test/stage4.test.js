// test/stage4.test.js
// Stage 4 (P2/P3 polish) regression tests: install --recipe command,
// SOURCE_DATE_EPOCH idempotency, `?` single-char wildcard, inline favicon,
// and empty-permission (deny-only) warnings. Fail-closed: every assertion
// checks the remediated behavior, not just the absence of the old string.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const { evaluateV2Permission } = require('../src/core/compiler');
const { parseUploadedConfig } = require('../src/core/importer');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

describe('AB-5.2 install tab emits --recipe base64url (no --slug)', () => {
  it('site/app.js builds an install --recipe command via base64UrlEncode', () => {
    const app = fs.readFileSync(path.join(ROOT, 'site', 'app.js'), 'utf8');
    assert.ok(app.includes('install --recipe '), 'app.js must emit install --recipe');
    assert.ok(app.includes('base64UrlEncode(JSON.stringify('), 'recipe must be base64url-encoded JSON');
    assert.ok(!app.includes('install --slug'), 'app.js must not emit the rejected install --slug command');
  });

  it('the pasted --recipe command is accepted by bin install (exit 0)', () => {
    // Replicates the WebUI base64UrlEncode for this ASCII recipe.
    const recipe = {
      slug: 'stage4-probe',
      description: 'stage4 install probe',
      mode: 'subagent',
      prompt: 'Probe prompt.',
      skills: [],
      mcpSelections: [],
    };
    const b64url = Buffer.from(JSON.stringify(recipe), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-stage4-install-'));
    const out = execFileSync(
      process.execPath,
      [path.join(ROOT, 'bin', 'agent-builder.js'), 'install', '--recipe', b64url, '--dry-run', '--target-dir', target],
      { encoding: 'utf8' }
    );
    assert.match(out, /DRY_RUN install stage4-probe/);
    fs.rmSync(target, { recursive: true, force: true });
  });
});

describe('AB-5.3 registry idempotency (generated_at excluded / SOURCE_DATE_EPOCH)', () => {
  it('build-site.js honors SOURCE_DATE_EPOCH and documents the generated_at exception', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'build-site.js'), 'utf8');
    assert.ok(src.includes('SOURCE_DATE_EPOCH'), 'build-site.js must support SOURCE_DATE_EPOCH');
    assert.ok(
      src.includes('generated_at') && /except.*generated_at|generated_at.*except/i.test(src),
      'build-site.js header must state the generated_at exception'
    );
  });

  it('two builds with SOURCE_DATE_EPOCH set are byte-identical', () => {
    const env = { ...process.env, SOURCE_DATE_EPOCH: '1234567890' };
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-site.js')], { env, stdio: 'pipe' });
    const first = sha256(path.join(ROOT, '_site', 'registry.json'));
    const firstIndex = sha256(path.join(ROOT, '_site', 'index.html'));
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-site.js')], { env, stdio: 'pipe' });
    assert.equal(sha256(path.join(ROOT, '_site', 'registry.json')), first, 'registry.json must be byte-identical under fixed SOURCE_DATE_EPOCH');
    assert.equal(sha256(path.join(ROOT, '_site', 'index.html')), firstIndex, 'index.html must be byte-identical across runs');
    const registry = JSON.parse(fs.readFileSync(path.join(ROOT, '_site', 'registry.json'), 'utf8'));
    assert.equal(registry.generated_at, new Date(1234567890 * 1000).toISOString());
  });
});

describe('AB-2.1 ? is a single-char wildcard (simulator)', () => {
  it("evaluateV2Permission treats ? as exactly-one-char (a?c matches abc, not abbc)", () => {
    const denyQ = [{ action: 'a?c', resource: '*', effect: 'deny' }];
    assert.equal(evaluateV2Permission(denyQ, 'abc', '*'), 'deny');
    assert.equal(evaluateV2Permission(denyQ, 'axc', '*'), 'deny');
    assert.equal(evaluateV2Permission(denyQ, 'ac', '*'), 'allow');
    assert.equal(evaluateV2Permission(denyQ, 'abbc', '*'), 'allow');
    assert.equal(evaluateV2Permission(denyQ, 'a/c', '*'), 'deny');
  });

  it('? composes with * and still enforces last-match-wins', () => {
    const perms = [
      { action: '*', resource: '*', effect: 'deny' },
      { action: 'a?c', resource: '*', effect: 'allow' },
    ];
    assert.equal(evaluateV2Permission(perms, 'abc', '*'), 'allow');
    assert.equal(evaluateV2Permission(perms, 'abbc', '*'), 'deny');
  });
});

describe('AB-5.1 inline favicon (no /favicon.ico 404)', () => {
  it('site/index.html carries an inline data-URI icon link', () => {
    const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
    assert.ok(html.includes('rel="icon"'), 'index.html must declare rel="icon"');
    assert.ok(html.includes('href="data:'), 'icon must be an inline data: URI (no network fetch, no 404)');
  });
});

describe('AB-3.3 empty-permission shapes warn deny-only (fail-closed)', () => {
  function captureWarn(fn) {
    const orig = console.warn;
    const lines = [];
    console.warn = (...args) => { lines.push(args.join(' ')); };
    try {
      return { result: fn(), lines };
    } finally {
      console.warn = orig;
    }
  }

  it('empty v2 agent warns and stays deny-only', () => {
    const { result, lines } = captureWarn(() =>
      parseUploadedConfig('opencode.json', JSON.stringify({ agents: { lonely: { description: 'd' } } }))
    );
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].skills, []);
    assert.deepEqual(result[0].mcpSelections, []);
    assert.ok(lines.some((l) => /deny-only/.test(l)), `expected a deny-only warning, got: ${lines.join(' | ')}`);
  });

  it('empty v1 agent warns and stays deny-only', () => {
    const { result, lines } = captureWarn(() =>
      parseUploadedConfig('opencode.json', JSON.stringify({ agent: { lonely: { description: 'd' } } }))
    );
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].mcpSelections, []);
    assert.ok(lines.some((l) => /deny-only/.test(l)), `expected a deny-only warning, got: ${lines.join(' | ')}`);
  });

  it('empty mcpServers warns (nothing to scope)', () => {
    const { result, lines } = captureWarn(() =>
      parseUploadedConfig('claude.json', JSON.stringify({ mcpServers: {} }))
    );
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].mcpSelections, []);
    assert.ok(lines.some((l) => /deny-only/.test(l)), `expected a deny-only warning, got: ${lines.join(' | ')}`);
  });

  it('non-empty recipes do not warn', () => {
    const { lines } = captureWarn(() =>
      parseUploadedConfig(
        'opencode.json',
        JSON.stringify({
          agents: {
            ok: {
              description: 'd',
              permissions: [
                { action: 'skill', resource: '*', effect: 'deny' },
                { action: 'skill', resource: 'a-skill', effect: 'allow' },
              ],
            },
          },
        })
      )
    );
    assert.ok(!lines.some((l) => /deny-only/.test(l)), 'deny-only warning must not fire when an allow rule exists');
  });
});

describe('AB-7.4 claude transport key stays absent (Stage 4 re-verification)', () => {
  it('claudeCodeMcp JSON never contains a transport key', () => {
    const { compileAgentRecipe } = require('../src/core/compiler');
    const out = compileAgentRecipe(
      {
        slug: 't',
        description: 'd',
        prompt: 'p',
        skills: [],
        mcpSelections: [{ server: 'postgres-prod', tools: ['query'] }],
      },
      [
        {
          id: 'pg',
          kind: 'mcp-server',
          mcp: { server_name: 'postgres-prod', transport: 'stdio', command: 'npx', args: ['-y', 'mcp-postgres'], tools: ['query'] },
        },
      ]
    );
    assert.ok(!JSON.stringify(out.claudeCodeMcp).includes('"transport"'), 'claude output must not emit the non-spec transport key');
  });
});
