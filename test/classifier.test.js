// test/classifier.test.js
// Stage 2: 4-tier weighted classifier (src/core/classifier.js) + scout classify CLI.
// Covers: return contract, confidence range, human-readable breakdown,
// runner-up categories, word-boundary safety (go/ui never false-trigger),
// Tier-1/Tier-2 signals, Pi detection, taxonomy-leaf validity (56 leaves).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const {
  classifyManifest,
  scoreBestSkillCategory,
  scoreBestMcpCategory,
  suggestTopics,
} = require('../src/core/classifier');
const scout = require('../scripts/scout.js');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function collectLeaves(categories, out) {
  for (const cat of categories || []) {
    if (Array.isArray(cat.children) && cat.children.length > 0) {
      collectLeaves(cat.children, out);
    } else {
      out.push(cat.id);
    }
  }
  return out;
}

function leaves() {
  return collectLeaves(readJson('data/taxonomy.json').categories, []);
}

describe('classifier return contract', () => {
  it('returns all documented fields with confidence in 0..100', () => {
    const res = classifyManifest(
      { name: 'x', description: 'y' },
      { name: 'x', description: 'y', keywords: [], dependencies: {} },
    );
    for (const field of ['harnesses', 'kind', 'category', 'topics', 'signal', 'confidence', 'reasons', 'alternativeCategories']) {
      assert.ok(Object.prototype.hasOwnProperty.call(res, field), `missing field ${field}`);
    }
    assert.ok(Array.isArray(res.harnesses) && res.harnesses.length > 0);
    assert.ok(Number.isInteger(res.confidence), 'confidence must be an integer');
    assert.ok(res.confidence >= 0 && res.confidence <= 100, `confidence out of range: ${res.confidence}`);
  });

  it('produces a human-readable weighted breakdown', () => {
    const res = classifyManifest(
      { name: 'my-mcp', description: 'Postgres MCP server' },
      {
        name: 'my-mcp',
        description: 'Postgres MCP server',
        keywords: ['mcp-server', 'postgres'],
        dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      },
    );
    assert.ok(res.reasons.length > 0);
    for (const reason of res.reasons) {
      assert.match(reason, /^\[\+\d+\] /, `breakdown line must carry a weight: ${reason}`);
    }
  });

  it('no-signal input fails closed with low confidence and universal harness', () => {
    const res = classifyManifest(
      { name: 'dotenv', description: 'Loads environment variables from .env' },
      { name: 'dotenv', description: 'Loads environment variables from .env', keywords: ['dotenv', 'env'], dependencies: {} },
    );
    assert.equal(res.signal, false);
    assert.deepEqual(res.harnesses, ['universal']);
    assert.ok(res.confidence <= 35, `no-signal confidence must stay low, got ${res.confidence}`);
  });
});

describe('classifier Tier-1 manifest/dependency markers', () => {
  it('Tier-1 @opencode/plugin dependency routes to opencode harness', () => {
    const res = classifyManifest(
      { name: 'demo', description: 'demo' },
      { name: 'demo', description: 'demo', keywords: [], dependencies: { '@opencode/plugin': '^1.0.0' } },
    );
    assert.ok(res.harnesses.includes('opencode'));
    assert.equal(res.kind, 'plugin');
    assert.equal(res.category, 'plugins/opencode');
  });

  it('Tier-1 MCP SDK dependency forces mcp-server kind', () => {
    const res = classifyManifest(
      { name: 'pg-mcp', description: 'Postgres database connector' },
      {
        name: 'pg-mcp',
        description: 'Postgres database connector',
        keywords: ['postgres'],
        dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      },
    );
    assert.equal(res.kind, 'mcp-server');
    assert.equal(res.category, 'mcp-servers/databases');
    assert.ok(res.confidence > 50);
  });

  it('detects Pi ecosystem packages without breaking the 8-harness taxonomy', () => {
    const res = classifyManifest(
      { name: 'pi-thing', description: 'pi-coding-agent helper' },
      { name: 'pi-thing', description: 'pi-coding-agent helper', keywords: ['pi-package'], dependencies: {} },
    );
    assert.equal(res.isPiPackage, true);
    assert.ok(res.harnesses.includes('universal'));
  });
});

describe('classifier Tier-2 keyword/package signals', () => {
  it('golang keyword routes to the Go leaf', () => {
    const res = classifyManifest(
      { name: 'x', description: 'skill playbook' },
      { name: 'x', description: 'skill playbook for services', keywords: ['golang'], dependencies: {} },
    );
    assert.equal(res.kind, 'skill');
    assert.equal(res.category, 'skills/coding/go');
  });
});

describe('classifier Tier-3 word-boundary domain matching', () => {
  it('never classifies "go" from substrings like ergonomic/algorithms/category', () => {
    const res = classifyManifest(
      { name: 'ergonomic-catalog', description: 'ergonomic algorithms for category management skill playbook' },
      {
        name: 'ergonomic-catalog',
        description: 'ergonomic algorithms for category management skill playbook',
        keywords: [],
        dependencies: {},
      },
    );
    assert.equal(res.kind, 'skill');
    assert.notEqual(res.category, 'skills/coding/go');
  });

  it('never routes to design-ui from "guided"/"liquid"/"equip" substrings', () => {
    const res = classifyManifest(
      { name: 'guided-liquid', description: 'guided liquid equip workflow' },
      {
        name: 'guided-liquid',
        description: 'guided liquid equip workflow',
        keywords: [],
        dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      },
    );
    assert.equal(res.kind, 'mcp-server');
    assert.notEqual(res.category, 'mcp-servers/design-ui');
  });

  it('still matches a real standalone "ui" token', () => {
    const res = classifyManifest(
      { name: 'figma-mcp', description: 'figma design ui toolkit' },
      {
        name: 'figma-mcp',
        description: 'figma design ui toolkit',
        keywords: ['mcp-server'],
        dependencies: { '@modelcontextprotocol/sdk': '^1.0.0' },
      },
    );
    assert.equal(res.category, 'mcp-servers/design-ui');
  });

  it('never routes keyword "javascript"/"axios" to jvm-dotnet/mobile-ios via substring', () => {
    // Regression: Tier-2 keyword matching was substring-based, so keyword
    // "javascript" contained "java" (-> skills/coding/jvm-dotnet) and
    // "axios" contained "ios" (-> skills/design/mobile-ios). Keywords are
    // discrete tokens and must match exactly.
    const res = classifyManifest(
      { name: 'axios-har-client', description: 'promise http client skill playbook' },
      {
        name: 'axios-har-client',
        description: 'promise http client skill playbook',
        keywords: ['axios', 'javascript'],
        dependencies: {},
      },
    );
    assert.equal(res.kind, 'skill');
    assert.equal(res.category, 'skills/coding/typescript-js');
  });

  it('score helpers rank runner-up leaf categories', () => {
    const out = scoreBestSkillCategory('kubernetes helm service mesh docker skill playbook', 'kubernetes');
    assert.equal(out.bestId, 'skills/devops-cloud/containers-k8s');
    assert.ok(out.bestScore > 0);
    assert.ok(Array.isArray(out.runnerUps));
  });

  it('every best + runner-up id is one of the 56 taxonomy leaves', () => {
    const valid = new Set(leaves());
    assert.equal(valid.size, 56);
    const probes = [
      classifyManifest({ name: 'a', description: 'kubernetes skill playbook' }, { name: 'a', description: 'kubernetes skill playbook', keywords: [], dependencies: {} }),
      classifyManifest({ name: 'b', description: 'postgres mcp server' }, { name: 'b', description: 'postgres mcp server', keywords: ['mcp-server'], dependencies: { '@modelcontextprotocol/sdk': '1' } }),
      classifyManifest({ name: 'c', description: 'react frontend skill playbook' }, { name: 'c', description: 'react frontend skill playbook', keywords: [], dependencies: {} }),
      classifyManifest({ name: 'd', description: 'system prompt persona' }, { name: 'd', description: 'system prompt persona', keywords: [], dependencies: {} }),
      classifyManifest({ name: 'e', description: 'subagent team' }, { name: 'e', description: 'subagent team', keywords: [], dependencies: {} }),
      classifyManifest({ name: 'f', description: 'saas dashboard design.md' }, { name: 'f', description: 'saas dashboard design.md system', keywords: [], dependencies: {} }),
    ];
    for (const res of probes) {
      assert.ok(valid.has(res.category), `unknown leaf category: ${res.category}`);
      for (const alt of res.alternativeCategories) {
        assert.ok(valid.has(alt.category), `unknown runner-up category: ${alt.category}`);
        assert.ok(Number.isFinite(alt.score) && alt.score > 0);
      }
    }
  });
});

describe('classifier Tier-4 context + topics', () => {
  it('suggestTopics caps at 5 lowercase vocabulary hits', () => {
    const topics = suggestTopics('Postgres RAG skill for opencode and claude-code with docker testing and browser git docs');
    assert.ok(topics.length <= 5);
    assert.ok(topics.includes('opencode'));
  });
});

describe('scout classify CLI wiring', () => {
  it('parses positional <pkg|dir> plus flags and --json', () => {
    const parsed = scout.parseClassifyArgs(['node', 'scout.js', 'classify', 'dotenv', '--json']);
    assert.equal(parsed.target, 'dotenv');
    assert.equal(parsed.json, true);
    const flagged = scout.parseClassifyArgs(['node', 'scout.js', 'classify', '--name', 'x', '--keywords', 'a,b', '--deps', 'd1,d2']);
    assert.equal(flagged.name, 'x');
    assert.deepEqual(flagged.keywords, ['a', 'b']);
    assert.deepEqual(flagged.deps, ['d1', 'd2']);
  });

  it('formats a human-readable breakdown with confidence and runner-ups', () => {
    const res = classifyManifest(
      { name: 'pg-mcp', description: 'Postgres MCP server' },
      { name: 'pg-mcp', description: 'Postgres MCP server', keywords: ['mcp-server'], dependencies: { '@modelcontextprotocol/sdk': '1' } },
    );
    const text = scout.formatClassifyHuman('pg-mcp', res);
    assert.match(text, /Confidence: \d+%/);
    assert.match(text, /Breakdown:/);
    assert.match(text, /Runner-up categories:/);
    assert.match(text, new RegExp(res.category.replace(/[./]/g, (c) => `\\${c}`)));
  });

  it('scout still exposes the discovery contract (classifyManifest delegation)', () => {
    assert.equal(typeof scout.classifyManifest, 'function');
    const res = scout.classifyManifest({ name: 'dotenv' }, { name: 'dotenv', description: 'env', keywords: ['dotenv'], dependencies: {} });
    assert.ok(Number.isInteger(res.confidence));
  });
});
