// scripts/export-json.js
// Compiles data/**/*.yaml -> dist/registry.json (CommonJS).
const fs = require('fs');
const path = require('path');
const { loadCatalog } = require('./utils/catalog');

const VERSION = '1.0.0';
const REPOSITORY = 'https://github.com/Heretek-AI/Agent-Builder';
const REGISTRY_URL = 'https://heretek-ai.github.io/Agent-Builder/registry.json';

function parseArgs(argv) {
  const args = { pretty: false, output: 'dist/registry.json' };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--pretty') {
      args.pretty = true;
    } else if (a === '--output') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        console.error('ERROR: --output requires a <filepath> argument');
        process.exit(1);
      }
      args.output = next;
      i += 1;
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/export-json.js [--pretty] [--output <filepath>]');
      process.exit(0);
    } else {
      console.error(`ERROR: unknown argument '${a}'`);
      process.exit(1);
    }
  }
  return args;
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const { pretty, output } = parseArgs(process.argv);

  const { entries, errors } = loadCatalog(rootDir);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`ERROR: ${err}`);
    }
    console.error(`EXPORT FAILED: ${errors.length} error(s)`);
    process.exit(1);
  }

  // Raw taxonomy object for output.
  const taxonomyPath = path.join(rootDir, 'data', 'taxonomy.json');
  const taxonomy = JSON.parse(fs.readFileSync(taxonomyPath, 'utf8'));

  const sorted = entries.map((w) => w.entry).sort((a, b) => {
    if (a.category < b.category) return -1;
    if (a.category > b.category) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });

  const byKind = {};
  const byCategory = {};
  const byHarness = {};
  for (const e of sorted) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    for (const h of e.harnesses || []) {
      byHarness[h] = (byHarness[h] || 0) + 1;
    }
  }
  const stats = { total: sorted.length, by_kind: byKind, by_category: byCategory, by_harness: byHarness };

  // Content bundler: copy local markdown files referenced by content_file.
  const outputAbs = path.isAbsolute(output) ? output : path.join(rootDir, output);
  const distDir = path.dirname(outputAbs);
  const contentDir = path.join(distDir, 'content');
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(contentDir, { recursive: true });

  for (const e of sorted) {
    if (!e.content_file) continue;
    const srcAbs = path.isAbsolute(e.content_file)
      ? e.content_file
      : path.join(rootDir, e.content_file);
    const destAbs = path.join(contentDir, `${e.id}.md`);
    if (fs.existsSync(srcAbs) && fs.statSync(srcAbs).isFile()) {
      fs.copyFileSync(srcAbs, destAbs);
    } else {
      console.warn(`WARNING: content_file '${e.content_file}' for entry '${e.id}' not found; skipping.`);
    }
  }

  const registry = {
    version: VERSION,
    repository: REPOSITORY,
    registry_url: REGISTRY_URL,
    generated_at: new Date().toISOString(),
    stats,
    taxonomy,
    entries: sorted,
  };

  const json = pretty ? JSON.stringify(registry, null, 2) : JSON.stringify(registry);
  fs.writeFileSync(outputAbs, `${json}\n`, 'utf8');
  const rel = path.relative(rootDir, outputAbs);
  console.log(`EXPORTED ${sorted.length} ENTRIES -> ${rel}`);
}

main();
