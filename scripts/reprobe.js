// scripts/reprobe.js
// Re-checks held/pending catalog entries (CommonJS).
// Currently reports entries whose compat/scope look pending; exits 0 on success.
const path = require('path');
const { loadCatalog } = require('./utils/catalog');

function printUsage() {
  console.log('Usage: node scripts/reprobe.js [--dry-run] [--help]');
}

function parseArgs(argv) {
  const args = { dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    console.error(`ERROR: unknown argument '${a}' (see --help)`);
    process.exit(1);
  }
  return args;
}

function isPending(entry) {
  const c = entry.compat;
  const s = entry.scope;
  if (typeof c === 'string' && /pending|hold|tbd/i.test(c)) return true;
  if (typeof s === 'string' && /pending|hold|tbd/i.test(s)) return true;
  if (c !== undefined && typeof c === 'object' && c !== null) {
    if (String(c.status || '').match(/pending|hold|tbd/i)) return true;
  }
  return false;
}

function main() {
  const rootDir = path.join(__dirname, '..');
  parseArgs(process.argv);
  const { entries, errors } = loadCatalog(rootDir);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`ERROR: ${err}`);
    }
    console.error(`REPROBE FAILED: ${errors.length} catalog error(s)`);
    process.exit(1);
  }
  const pending = entries.filter(({ entry }) => isPending(entry));
  if (pending.length > 0) {
    for (const { file, entry } of pending) {
      console.log(`PENDING ${entry.id} (${entry.category}) <- ${file}`);
    }
  }
  console.log(`REPROBE_OK entries=${entries.length} pending=${pending.length}`);
}

main();
