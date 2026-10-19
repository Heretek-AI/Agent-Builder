// test/catalog.test.js
// Milestone 12: taxonomy/schema integrity, validator, registry export,
// README generation, and site build artifacts.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { loadCatalog } = require('../scripts/utils/catalog');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function collectTaxonomyIds(categories, out) {
  for (const cat of categories || []) {
    out.ids.push(cat.id);
    out.titles.push(cat.title);
    if (Array.isArray(cat.children) && cat.children.length > 0) {
      collectTaxonomyIds(cat.children, out);
    } else {
      out.leaves.push(cat.id);
    }
  }
  return out;
}

describe('data/taxonomy.json', () => {
  it('declares version 1.0.0 with 8 harnesses and 6 top-level categories', () => {
    const taxonomy = readJson('data/taxonomy.json');
    assert.equal(taxonomy.version, '1.0.0');
    assert.equal(taxonomy.harnesses.length, 8);
    assert.deepEqual(
      taxonomy.harnesses.map((h) => h.id),
      ['opencode', 'claude-code', 'codex', 'gemini-cli', 'cursor', 'windsurf', 'copilot', 'universal']
    );
    assert.equal(taxonomy.categories.length, 6);
    assert.deepEqual(
      taxonomy.categories.map((c) => c.id),
      ['plugins', 'skills', 'mcp-servers', 'design-md', 'prompts', 'agents']
    );
  });

  it('uses valid leaf ids (lowercase, no spaces, only a-z0-9/slashes/dashes)', () => {
    const taxonomy = readJson('data/taxonomy.json');
    const { ids } = collectTaxonomyIds(taxonomy.categories, { ids: [], titles: [], leaves: [] });
    assert.ok(ids.length > 50, `expected 50+ category ids, got ${ids.length}`);
    for (const id of ids) {
      assert.ok(!/\s/.test(id), `category id must not contain spaces: ${id}`);
      assert.ok(id === id.toLowerCase(), `category id must be lowercase: ${id}`);
      assert.match(id, /^[a-z0-9][a-z0-9/-]*$/, `invalid category id: ${id}`);
    }
  });

  it('every data entry category exists in the taxonomy', () => {
    const taxonomy = readJson('data/taxonomy.json');
    const { ids } = collectTaxonomyIds(taxonomy.categories, { ids: [], titles: [], leaves: [] });
    const valid = new Set(ids);
    const harnessIds = new Set(taxonomy.harnesses.map((h) => h.id));
    const { entries, errors } = loadCatalog(ROOT);
    assert.deepEqual(errors, []);
    assert.ok(entries.length >= 60, `expected 60+ entries, got ${entries.length}`);
    for (const { entry, file } of entries) {
      assert.ok(valid.has(entry.category), `${file}: unknown category ${entry.category}`);
      for (const h of entry.harnesses || []) {
        assert.ok(harnessIds.has(h), `${file}: unknown harness ${h}`);
      }
    }
  });
});

describe('data/schema.json', () => {
  it('is Draft-07 with the required fields and additionalProperties false', () => {
    const schema = readJson('data/schema.json');
    assert.equal(schema.$schema, 'http://json-schema.org/draft-07/schema#');
    assert.deepEqual(
      schema.required,
      ['id', 'name', 'repo', 'tagline', 'description', 'kind', 'category', 'harnesses']
    );
    assert.equal(schema.additionalProperties, false);
  });
});

describe('scripts/validate.js (via loadCatalog)', () => {
  it('loads 60+ entries with zero errors', () => {
    const { entries, errors } = loadCatalog(ROOT);
    assert.deepEqual(errors, []);
    assert.ok(entries.length >= 60, `expected 60+ entries, got ${entries.length}`);
  });

  it('enforces global id uniqueness and duplicate (repo, path, kind, id) tuples', () => {
    const { entries } = loadCatalog(ROOT);
    const ids = entries.map(({ entry }) => entry.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate entry ids found');
    const tuples = entries.map(({ entry }) =>
      [entry.repo, entry.path || '', entry.kind, entry.id].join('\0')
    );
    assert.equal(new Set(tuples).size, tuples.length, 'duplicate (repo, path, kind, id) tuples found');
  });

  it('validator scripts exist on disk', () => {
    for (const rel of ['scripts/validate.js', 'scripts/export-json.js', 'scripts/generate-readme.js', 'scripts/build-site.js']) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing script: ${rel}`);
    }
  });
});

describe('scripts/export-json.js (dist/registry.json)', () => {
  it('emits version/taxonomy/entries/stats with sorted entries and matching stats', () => {
    const registryPath = path.join(ROOT, 'dist', 'registry.json');
    assert.ok(fs.existsSync(registryPath), 'dist/registry.json must exist (run npm run export)');
    const registry = readJson('dist/registry.json');
    assert.equal(registry.version, '1.0.0');
    assert.ok(registry.taxonomy, 'registry must carry taxonomy');
    assert.ok(Array.isArray(registry.entries), 'registry must carry entries[]');
    assert.ok(registry.entries.length >= 60, `expected 60+ entries, got ${registry.entries.length}`);
    assert.ok(registry.stats, 'registry must carry stats');

    // Deterministic order: category, then id.
    const keys = registry.entries.map((e) => `${e.category}\0${e.id}`);
    const sorted = [...keys].sort();
    assert.deepEqual(keys, sorted, 'entries must be sorted by category, then id');

    // Stats counts match the entries.
    const byKind = {};
    const byCategory = {};
    const byHarness = {};
    for (const e of registry.entries) {
      byKind[e.kind] = (byKind[e.kind] || 0) + 1;
      byCategory[e.category] = (byCategory[e.category] || 0) + 1;
      for (const h of e.harnesses || []) {
        byHarness[h] = (byHarness[h] || 0) + 1;
      }
    }
    assert.equal(registry.stats.total, registry.entries.length);
    assert.deepEqual(registry.stats.by_kind, byKind);
    assert.deepEqual(registry.stats.by_category, byCategory);
    assert.deepEqual(registry.stats.by_harness, byHarness);
  });
});

describe('scripts/generate-readme.js (README.md)', () => {
  it('renders header, badges, TOC, taxonomy titles, harness badges, and deny-first overview', () => {
    const readmePath = path.join(ROOT, 'README.md');
    assert.ok(fs.existsSync(readmePath), 'README.md must exist (run npm run generate)');
    const readme = fs.readFileSync(readmePath, 'utf8');
    const taxonomy = readJson('data/taxonomy.json');
    const { titles, ids } = collectTaxonomyIds(taxonomy.categories, { ids: [], titles: [], leaves: [] });

    assert.ok(readme.includes('# Agent-Builder'), 'README must contain the project header');
    assert.ok(readme.includes('awesome.re/badge'), 'README must contain the Awesome badge');
    assert.ok(readme.includes('registry.json'), 'README must link the registry JSON');
    assert.ok(readme.includes('https://heretek-ai.github.io/Agent-Builder/'), 'README must link the WebUI');
    assert.ok(readme.includes('@heretek-ai/agent-builder'), 'README must mention the NPM package');
    assert.ok(readme.includes('## Table of Contents'), 'README must contain the TOC');
    for (const title of titles) {
      assert.ok(readme.includes(title), `README must contain taxonomy title: ${title}`);
    }
    for (const id of ids) {
      assert.ok(readme.includes(id), `README must contain taxonomy id: ${id}`);
    }
    assert.ok(readme.includes('[opencode]'), 'README must render harness badges');
    assert.ok(readme.includes('[claude-code]'), 'README must render harness badges');
    assert.ok(readme.includes('deny'), 'README must document deny-first scoping');
    assert.ok(readme.includes('allow'), 'README must document deny-first scoping');
  });
});

describe('scripts/build-site.js (_site/)', () => {
  it('produces index.html, registry.json, and .nojekyll for GitHub Pages', () => {
    for (const rel of ['_site/index.html', '_site/registry.json', '_site/.nojekyll']) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)), `missing site artifact: ${rel} (run npm run site)`);
    }
    const siteRegistry = readJson('_site/registry.json');
    const distRegistry = readJson('dist/registry.json');
    assert.equal(siteRegistry.entries.length, distRegistry.entries.length);
    assert.equal(siteRegistry.version, '1.0.0');
    const html = fs.readFileSync(path.join(ROOT, '_site', 'index.html'), 'utf8');
    assert.ok(html.length > 1000, 'index.html looks too small to be the WebUI shell');
  });
});
