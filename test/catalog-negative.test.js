// test/catalog-negative.test.js
// Stage 3 (P1 hardening + validator gates): NEGATIVE fixtures proving the
// validator, PR gate, AI-review rubric, and reviewer allowlist actually
// reject bad input (fail-closed). Each block names the sabotage that must
// turn the suite RED (verified manually, then restored).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const { loadCatalog } = require('../scripts/utils/catalog');
const { auditCatalogEntries } = require('../scripts/ai-review.js');
const { classifyChangedFiles, runValidatorCanary } = require('../scripts/check-pr.js');

// A minimal schema-valid entry. Category 'skills/coding/rust' is a real leaf
// in data/taxonomy.json; harnesses use the real 'opencode' harness id.
function makeEntry(overrides) {
  return {
    id: 'negative-fixture-probe',
    name: 'Negative fixture probe',
    repo: 'https://example.com/negative-fixture-probe',
    tagline: 'probe entry',
    description: 'Negative-control probe entry (test-only, never committed to data/).',
    kind: 'skill',
    category: 'skills/coding/rust',
    harnesses: ['opencode'],
    ...overrides,
  };
}

function writeTmpEntries(docs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-negative-'));
  const files = docs.map((doc, i) => {
    const f = path.join(dir, `entry-${i}.yaml`);
    fs.writeFileSync(f, yaml.dump(doc));
    return f;
  });
  return { dir, files };
}

function rmTmp(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('validator negative fixtures (AB-1.3-untested-invariant)', () => {
  it('rejects two entries sharing one id (/duplicate id/)', () => {
    // SABOTAGE TRIPWIRE: `s/if (seenIds.has(doc.id))/if (false)/` in
    // scripts/utils/catalog.js must turn this test RED (then restore).
    const { dir, files } = writeTmpEntries([
      makeEntry({}),
      makeEntry({ name: 'Duplicate id probe' }),
    ]);
    try {
      const { errors } = loadCatalog(ROOT, files);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /duplicate id 'negative-fixture-probe'/);
    } finally {
      rmTmp(dir);
    }
  });

  it('rejects fully duplicated (repo, path, kind, id) entries', () => {
    // The (repo, path, kind, id) tuple contains the id, so a full duplicate
    // is caught by the id check first; either way it must fail closed with
    // a /duplicate/ error (never silently accepted).
    const { dir, files } = writeTmpEntries([makeEntry({}), makeEntry({})]);
    try {
      const { errors } = loadCatalog(ROOT, files);
      assert.ok(errors.length >= 1, 'expected at least one duplicate error');
      assert.match(errors.join('\n'), /duplicate/);
    } finally {
      rmTmp(dir);
    }
  });

  it('validator canary passes on a healthy validator', () => {
    // Same negative control scripts/check-pr.js runs on scripts/** PRs.
    assert.equal(runValidatorCanary(ROOT), true);
  });
});

describe('check-pr scope gate (AB-1.3-check-pr-scope-bypass)', () => {
  it('classifies scripts/** changes as gate-relevant (not bypassable)', () => {
    // SABOTAGE TRIPWIRE: reverting to the old `data/`-only filter must turn
    // this test RED (scripts-only PRs would bypass the gate again).
    const { yamlChanged, scriptsChanged } = classifyChangedFiles([
      'scripts/utils/catalog.js',
      'scripts/check-pr.js',
    ]);
    assert.deepEqual(yamlChanged, []);
    assert.deepEqual(scriptsChanged, ['scripts/utils/catalog.js', 'scripts/check-pr.js']);
  });

  it('still classifies data/**/*.yaml changes as gate-relevant', () => {
    const { yamlChanged, scriptsChanged } = classifyChangedFiles([
      'data/skills/coding/rust/rust-secure-coding.yaml',
    ]);
    assert.deepEqual(yamlChanged, ['data/skills/coding/rust/rust-secure-coding.yaml']);
    assert.deepEqual(scriptsChanged, []);
  });

  it('ignores unrelated files (docs-only PRs stay green)', () => {
    const { yamlChanged, scriptsChanged } = classifyChangedFiles([
      'README.md',
      'docs/notes.md',
    ]);
    assert.deepEqual(yamlChanged, []);
    assert.deepEqual(scriptsChanged, []);
  });

  it('fails closed (non-zero) when the base ref cannot be diffed', () => {
    // SABOTAGE TRIPWIRE: `process.exit(1)` -> `process.exit(0)` (or a
    // `|| true` swallow) in getChangedFiles must turn this test RED.
    assert.throws(() => {
      execFileSync(
        process.execPath,
        [path.join(ROOT, 'scripts', 'check-pr.js'), '--base', 'refs/nonexistent/ab-audit-probe'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    });
  });

  it('rejects option-like --base values fail-closed (no git option injection)', () => {
    // Sonar jssecurity:S8705: a `base` starting with `-` would be parsed by
    // git as an option, not a revision. Child argv arrays only (no shell).
    for (const evil of ['--output=/tmp/evil-check-pr', '--upload-pack=id', '-evilref']) {
      assert.throws(
        () => {
          execFileSync(
            process.execPath,
            [path.join(ROOT, 'scripts', 'check-pr.js'), '--base', evil],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
          );
        },
        `expected fail-closed rejection for base=${evil}`
      );
    }
    // Same via the --base=<value> spelling.
    assert.throws(() => {
      execFileSync(
        process.execPath,
        [path.join(ROOT, 'scripts', 'check-pr.js'), '--base=--output=/tmp/evil-check-pr'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );
    });
  });

  it('rejects traversal / whitespace / metachar --base values fail-closed', () => {
    for (const evil of ['..', 'a..b', 'a b', 'a;b', 'a|b', 'a$b', 'a`b', '$(id)']) {
      assert.throws(
        () => {
          execFileSync(
            process.execPath,
            [path.join(ROOT, 'scripts', 'check-pr.js'), '--base', evil],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
          );
        },
        `expected fail-closed rejection for base=${evil}`
      );
    }
  });
});

describe('ai-review rubric enforcement (AB-ai-review-no-enforcement)', () => {
  it('accepts the real 63-entry catalog with zero findings (no false positives)', () => {
    const { entries, errors } = loadCatalog(ROOT);
    assert.deepEqual(errors, []);
    const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxonomy.json'), 'utf8'));
    const { findings } = auditCatalogEntries(ROOT, entries, taxonomy);
    assert.deepEqual(findings, []);
  });

  it('rejects an invented MCP tool (totally-invented-tool-xyz) with REVIEW-level finding', () => {
    // SABOTAGE TRIPWIRE: deleting the tool-grounding loop in
    // auditCatalogEntries must turn this test RED (evil entry passes again).
    const { entries } = loadCatalog(ROOT);
    const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxonomy.json'), 'utf8'));
    const evil = entries.map((w) => ({ file: w.file, entry: structuredClone(w.entry) }));
    const agent = evil.find((w) => w.entry.id === 'db-security-auditor');
    assert.ok(agent, 'expected db-security-auditor fixture entry to exist');
    agent.entry.agent_preset.mcp_selections[0].tools.push('totally-invented-tool-xyz');
    const { findings } = auditCatalogEntries(ROOT, evil, taxonomy);
    assert.match(findings.join('\n'), /invented tool 'totally-invented-tool-xyz'/);
  });

  it('rejects an unknown harness id', () => {
    const { entries } = loadCatalog(ROOT);
    const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxonomy.json'), 'utf8'));
    const evil = entries.map((w) => ({ file: w.file, entry: structuredClone(w.entry) }));
    evil[0].entry.harnesses.push('hyperdrive-xyz');
    const { findings } = auditCatalogEntries(ROOT, evil, taxonomy);
    assert.match(findings.join('\n'), /unknown harness 'hyperdrive-xyz'/);
  });

  it('rejects a kind/folder mismatch (skill filed under data/plugins/)', () => {
    const { entries } = loadCatalog(ROOT);
    const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxonomy.json'), 'utf8'));
    const evil = entries.map((w) => ({ file: w.file, entry: structuredClone(w.entry) }));
    const skill = evil.find((w) => w.entry.kind === 'skill');
    skill.file = path.join(ROOT, 'data', 'plugins', 'misfiled.yaml');
    const { findings } = auditCatalogEntries(ROOT, evil, taxonomy);
    assert.match(findings.join('\n'), /kind 'skill' must live under data\/skills\//);
  });

  it('rejects an agent selection referencing an unknown MCP server', () => {
    const { entries } = loadCatalog(ROOT);
    const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxonomy.json'), 'utf8'));
    const evil = entries.map((w) => ({ file: w.file, entry: structuredClone(w.entry) }));
    const agent = evil.find((w) => w.entry.id === 'db-security-auditor');
    agent.entry.agent_preset.mcp_selections.push({ server: 'ghost-server', tools: ['query'] });
    const { findings } = auditCatalogEntries(ROOT, evil, taxonomy);
    assert.match(findings.join('\n'), /unknown mcp server 'ghost-server'/);
  });

  it('requires deny-first compiled permissions for agent presets', () => {
    // SABOTAGE TRIPWIRE: swapping deny->allow at the head of the v2 list in
    // src/core/compiler.js must surface here as a deny-first finding.
    const { entries } = loadCatalog(ROOT);
    const taxonomy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxonomy.json'), 'utf8'));
    const agents = entries.filter(
      (w) => w.entry.kind === 'agent' || w.entry.kind === 'agent-preset'
    );
    assert.ok(agents.length > 0, 'expected agent presets in the catalog');
    const { findings } = auditCatalogEntries(ROOT, entries, taxonomy);
    const denyFindings = findings.filter((f) => /deny-first|does not compile/.test(f));
    assert.deepEqual(denyFindings, []);
  });
});

describe('catalog-reviewer allowlist (AB-7.3-reviewer-dead-allows)', () => {
  // Minimal replica of the OpenCode permission evaluator (deny-first config,
  // last match wins, `*` wildcard): proves bare `read`/`glob`/`grep` decode
  // to allow while everything else stays denied.
  function reviewerAllows(toolName) {
    const text = fs.readFileSync(
      path.join(ROOT, '.opencode', 'agents', 'catalog-reviewer.md'),
      'utf8'
    );
    const frontmatter = text.split('---')[1];
    const rules = [];
    for (const line of frontmatter.split('\n')) {
      const m = line.match(/^\s*"([^"]+)":\s*(allow|deny)\s*$/);
      if (m) rules.push({ pattern: m[1], effect: m[2] });
    }
    assert.ok(rules.length > 0, 'expected permission rules in reviewer frontmatter');
    const toRegExp = (p) =>
      new RegExp(`^${p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    let effect = 'deny';
    for (const r of rules) {
      if (toRegExp(r.pattern).test(toolName)) effect = r.effect;
    }
    return effect;
  }

  it('allows bare read/glob/grep (old read_*/glob_*/grep_* never matched)', () => {
    // SABOTAGE TRIPWIRE: restoring `read_*` (trailing wildcard) must turn
    // this test RED (bare tool name `read` no longer matches -> denied).
    assert.equal(reviewerAllows('read'), 'allow');
    assert.equal(reviewerAllows('glob'), 'allow');
    assert.equal(reviewerAllows('grep'), 'allow');
  });

  it('still denies everything else (fail-closed reviewer)', () => {
    assert.equal(reviewerAllows('bash'), 'deny');
    assert.equal(reviewerAllows('write'), 'deny');
    assert.equal(reviewerAllows('skill'), 'deny');
  });
});
