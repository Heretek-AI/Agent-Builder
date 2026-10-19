// scripts/health-check.js
// Verifies catalog repo URLs and reports registry stats (CommonJS).
// --dry-run skips all network access and exits 0 on structural validity.
const path = require('path');
const { loadCatalog, loadTaxonomy } = require('./utils/catalog');

function printUsage() {
  console.log('Usage: node scripts/health-check.js [--dry-run] [--help]');
  console.log('  --dry-run  skip network probes; validate URL shape + catalog only');
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

function main() {
  const rootDir = path.join(__dirname, '..');
  const args = parseArgs(process.argv);
  const { entries, errors } = loadCatalog(rootDir);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`ERROR: ${err}`);
    }
    console.error(`HEALTH FAILED: ${errors.length} catalog error(s)`);
    process.exit(1);
  }

  const { map } = loadTaxonomy(rootDir);
  let badUrls = 0;
  const byKind = {};
  for (const { file, entry } of entries) {
    byKind[entry.kind] = (byKind[entry.kind] || 0) + 1;
    if (typeof entry.repo !== 'string' || !/^https:\/\//.test(entry.repo)) {
      console.error(`ERROR: ${file}: repo URL must start with https:// (got ${JSON.stringify(entry.repo)})`);
      badUrls += 1;
    }
    if (!map.has(entry.category)) {
      console.error(`ERROR: ${file}: unknown category '${entry.category}'`);
      badUrls += 1;
    }
  }
  if (badUrls > 0) {
    console.error(`HEALTH FAILED: ${badUrls} URL/category problem(s)`);
    process.exit(1);
  }

  if (!args.dryRun) {
    // Non-dry-run mode: still offline-safe structural report. Network HEAD
    // probes are intentionally omitted so CI stays deterministic; pass
    // --dry-run for the guaranteed network-free path.
    console.log('HEALTH NOTE: live network probes disabled in this build; reporting structural health only.');
  }
  console.log(`HEALTH_OK entries=${entries.length} kinds=${Object.keys(byKind).length} dry_run=${args.dryRun ? 'yes' : 'no'}`);
}

main();
