// scripts/check-pr.js
// Validates data/**/*.yaml files changed in the current PR/branch (CommonJS).
const { execFileSync } = require('child_process');
const path = require('path');
const { loadCatalog } = require('./utils/catalog');

function printUsage() {
  console.log('Usage: node scripts/check-pr.js [--base <ref>] [--help]');
  console.log('  --base <ref>  git ref or range base to diff against (default: origin/main)');
}

function parseArgs(argv) {
  const args = { base: 'origin/main' };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
    if (a === '--base') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        console.error('ERROR: --base requires a value');
        process.exit(1);
      }
      args.base = next;
      i += 1;
      continue;
    }
    if (a.startsWith('--base=')) {
      args.base = a.slice('--base='.length);
      if (args.base.trim() === '') {
        console.error('ERROR: --base requires a value');
        process.exit(1);
      }
      continue;
    }
    console.error(`ERROR: unknown argument '${a}' (see --help)`);
    process.exit(1);
  }
  return args;
}

function getChangedFiles(base) {
  // Never interpolate untrusted refs into a shell string: argv array only.
  const range = `${base}...HEAD`;
  try {
    const out = execFileSync('git', ['diff', '--name-only', range], { encoding: 'utf8' });
    return out.split('\n').map((s) => s.trim()).filter((s) => s !== '');
  } catch (_e) {
    // Fall back to a plain base ref diff (e.g. when HEAD has no upstream range).
    try {
      const out = execFileSync('git', ['diff', '--name-only', base], { encoding: 'utf8' });
      return out.split('\n').map((s) => s.trim()).filter((s) => s !== '');
    } catch (err) {
      console.error(`ERROR: unable to diff against '${base}': ${err.message}`);
      process.exit(1);
    }
  }
  return [];
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const args = parseArgs(process.argv);
  const changed = getChangedFiles(args.base);
  const yamlChanged = changed.filter(
    (f) => f.startsWith('data/') && (f.endsWith('.yaml') || f.endsWith('.yml'))
  );
  if (yamlChanged.length === 0) {
    console.log('CHECK_PR_OK: no data/**/*.yaml files changed');
    return;
  }
  const absFiles = yamlChanged.map((f) => path.join(rootDir, f));
  const { entries, errors } = loadCatalog(rootDir, absFiles);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`ERROR: ${err}`);
    }
    console.error(`CHECK_PR FAILED: ${errors.length} error(s) in ${yamlChanged.length} changed file(s)`);
    process.exit(1);
  }
  console.log(`CHECK_PR_OK: ${entries.length} changed entr${entries.length === 1 ? 'y' : 'ies'} valid`);
}

main();
