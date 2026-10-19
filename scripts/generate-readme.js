// scripts/generate-readme.js
// Renders README.md from data/taxonomy.json + data/**/*.yaml (CommonJS).
const fs = require('fs');
const path = require('path');
const { loadCatalog } = require('./utils/catalog');

const WEBUI_URL = 'https://heretek-ai.github.io/Agent-Builder/';
const REGISTRY_URL = 'https://heretek-ai.github.io/Agent-Builder/registry.json';
const REPO_URL = 'https://github.com/Heretek-AI/Agent-Builder';

function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-');
}

function escapeCell(value) {
  return String(value == null ? '' : value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function harnessBadges(entry) {
  return (entry.harnesses || []).map((h) => `[${h}]`).join(' ');
}

function langPlatformCell(entry) {
  const parts = [...(entry.languages || []), ...(entry.platforms || [])];
  return parts.length > 0 ? escapeCell(parts.join(', ')) : '—';
}

function toolsCell(entry) {
  if (entry.kind === 'mcp-server') {
    const count = entry.mcp && Array.isArray(entry.mcp.tools) ? entry.mcp.tools.length : 0;
    return `${count} tool${count === 1 ? '' : 's'}`;
  }
  return '—';
}

function renderToc(categories, depth, lines) {
  for (const cat of categories || []) {
    const indent = '  '.repeat(depth);
    lines.push(`${indent}- [${cat.title}](#${slugify(cat.title)})`);
    if (Array.isArray(cat.children) && cat.children.length > 0) {
      renderToc(cat.children, depth + 1, lines);
    }
  }
  return lines;
}

function renderSections(categories, byCategory, depth, lines) {
  for (const cat of categories || []) {
    const level = Math.min(2 + depth, 6);
    lines.push(`${'#'.repeat(level)} ${cat.title}`);
    lines.push('');
    lines.push(`\`${cat.id}\``);
    lines.push('');
    if (cat.description) {
      lines.push(cat.description);
      lines.push('');
    }
    const entries = (byCategory.get(cat.id) || []).slice().sort((a, b) => {
      if (a.id < b.id) return -1;
      if (a.id > b.id) return 1;
      return 0;
    });
    if (entries.length > 0) {
      lines.push('| Name | Tagline | Harnesses | Languages/Platforms | Tools |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const e of entries) {
        const name = `[${escapeCell(e.name)}](${e.repo})`;
        lines.push(
          `| ${name} | ${escapeCell(e.tagline)} | ${escapeCell(harnessBadges(e))} | ${langPlatformCell(e)} | ${escapeCell(toolsCell(e))} |`
        );
      }
      lines.push('');
    } else if (!cat.children || cat.children.length === 0) {
      lines.push('_No entries yet — contributions welcome (see Contributing below)._');
      lines.push('');
    }
    if (Array.isArray(cat.children) && cat.children.length > 0) {
      renderSections(cat.children, byCategory, depth + 1, lines);
    }
  }
  return lines;
}

function main() {
  const rootDir = path.join(__dirname, '..');

  const taxonomyPath = path.join(rootDir, 'data', 'taxonomy.json');
  const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));

  const { entries, errors } = loadCatalog(rootDir);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`ERROR: ${err}`);
    }
    console.error(`GENERATE FAILED: ${errors.length} error(s)`);
    process.exit(1);
  }

  const byCategory = new Map();
  for (const { entry } of entries) {
    if (!byCategory.has(entry.category)) byCategory.set(entry.category, []);
    byCategory.get(entry.category).push(entry);
  }

  const byKind = {};
  for (const { entry } of entries) {
    byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
  }

  const lines = [];
  lines.push('# Agent-Builder');
  lines.push('');
  lines.push(
    'A curated, machine-validated multi-harness AI Agent Registry & Awesome List — Plugins, Skills, MCP Servers, Prompts, `DESIGN.md` systems, and Agent Presets for OpenCode, Claude Code, Codex, and more.'
  );
  lines.push('');
  lines.push(
    `[![Awesome](https://awesome.re/badge.svg)](https://awesome.re) [![Registry JSON](https://img.shields.io/badge/registry-registry.json-blue)](${REGISTRY_URL}) [![WebUI](https://img.shields.io/badge/webui-agent--builder-green)](${WEBUI_URL}) [![NPM](https://img.shields.io/npm/v/@heretek-ai/agent-builder)](https://www.npmjs.com/package/@heretek-ai/agent-builder)`
  );
  lines.push('');
  lines.push('## Quick Start');
  lines.push('');
  lines.push(`- 🌐 **Agent Builder WebUI:** ${WEBUI_URL}`);
  lines.push('- 💻 **CLI:** `node bin/agent-builder.js serve` (from a local checkout; `npm pack` for a tarball — the package is not published to npm yet, see note below)');
  lines.push(`- 📦 **Machine-readable registry:** ${REGISTRY_URL} ([repository](${REPO_URL}))`);
  lines.push('');
  lines.push('```bash');
  lines.push('node bin/agent-builder.js serve');
  lines.push('# then open the printed local URL, or use the hosted WebUI above');
  lines.push('```');
  lines.push('');
  lines.push(
    '> **Note:** `@heretek-ai/agent-builder` is not published on the npm registry yet (`npm view` still 404s — a known gap, AB-6.1). Do not use `npx @heretek-ai/agent-builder`; run from source as above or `npm pack` until `npm publish` lands.'
  );
  lines.push('');
  lines.push(
    `**Registry stats:** ${entries.length} entries (${Object.entries(byKind)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')}) across the taxonomy below.`
  );
  lines.push('');
  lines.push('## Table of Contents');
  lines.push('');
  renderToc(taxonomy.categories, 0, lines);
  lines.push('');
  renderSections(taxonomy.categories, byCategory, 0, lines);
  lines.push('## Per-Agent Skill & MCP Scoping');
  lines.push('');
  lines.push(
    'Every agent compiled by the Agent Builder WebUI and CLI follows **deny-first context hygiene**: permissions start by denying everything (`deny "*"` first), then explicitly allow only the skills and MCP tools that agent needs. OpenCode evaluates permission rules in order and **the last matching rule wins**, so the deny-all rule must come first.'
  );
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "agents": {');
  lines.push('    "my-agent": {');
  lines.push('      "permissions": [');
  lines.push('        { "action": "skill", "resource": "*", "effect": "deny" },');
  lines.push('        { "action": "skill", "resource": "rust-secure-coding", "effect": "allow" },');
  lines.push('        { "action": "postgres-prod_*", "resource": "*", "effect": "deny" },');
  lines.push('        { "action": "postgres-prod_execute_query", "resource": "*", "effect": "allow" }');
  lines.push('      ]');
  lines.push('    }');
  lines.push('  }');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push(
    'MCP tool names are normalized as `<serverName>_<toolName>` preserving hyphens and underscores (matching upstream OpenCode/Claude Code `mcp__plugin_my-plugin_database-tools__query` style); every other run of non-alphanumeric characters becomes `_` (e.g. server `postgres-prod` + tool `execute_query` → `postgres-prod_execute_query`).'
  );
  lines.push('');
  lines.push('## Contributing');
  lines.push('');
  lines.push('1. Scaffold a new entry:');
  lines.push('   ```bash');
  lines.push(
    '   node scripts/new-entry.js --id my-skill --name "My Skill" --kind skill --category skills/coding/rust --repo https://github.com/org/repo --tagline "Short summary"'
  );
  lines.push('   ```');
  lines.push('2. Validate, export, and regenerate docs:');
  lines.push('   ```bash');
  lines.push('   npm run validate');
  lines.push('   npm run export');
  lines.push('   npm run generate');
  lines.push('   ```');
  lines.push('3. Normalize YAML formatting with `npm run fmt` and open a pull request.');
  lines.push('');
  lines.push(
    '_This README is generated from `data/taxonomy.json` + `data/**/*.yaml` — do not edit by hand; run `npm run generate`._'
  );
  lines.push('');

  fs.writeFileSync(path.join(rootDir, 'README.md'), `${lines.join('\n')}`, 'utf8');
  console.log(`GENERATED README.md with ${entries.length} entries`);
}

main();
