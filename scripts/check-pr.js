// scripts/check-pr.js
// Validates data/**/*.yaml files changed in the current PR/branch (CommonJS).
// Fail-closed (AB-1.3-check-pr-scope-bypass): changes under scripts/** trigger
// a FULL catalog validation plus a validator canary (negative control), so a
// neutered validator on a scripts-only PR can never report CHECK_PR_OK.
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const path = require('path');
const { loadCatalog, loadTaxonomy } = require('./utils/catalog');

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

function classifyChangedFiles(changed) {
  const yamlChanged = changed.filter(
    (f) => f.startsWith('data/') && (f.endsWith('.yaml') || f.endsWith('.yml'))
  );
  const scriptsChanged = changed.filter(
    (f) => f === 'scripts' || f.startsWith('scripts/')
  );
  return { yamlChanged, scriptsChanged };
}

// Negative control for the validator itself: two entries sharing one id must
// be rejected with /duplicate id/. Returns true when the validator is alive,
// false when it has been neutered (fail-closed signal for the caller).
function runValidatorCanary(rootDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-pr-canary-'));
  try {
    const { ids } = loadTaxonomy(rootDir);
    const category = Array.from(ids)[0];
    if (!category) return false;
    const base = {
      id: 'check-pr-canary',
      name: 'Check-PR canary',
      repo: 'https://example.com/check-pr-canary',
      tagline: 'canary entry',
      description: 'Negative-control entry for the check-pr validator canary.',
      kind: 'skill',
      category,
      harnesses: ['opencode'],
    };
    const fa = path.join(dir, 'a.yaml');
    const fb = path.join(dir, 'b.yaml');
    const yaml = require('js-yaml');
    fs.writeFileSync(fa, yaml.dump(base));
    fs.writeFileSync(fb, yaml.dump({ ...base, name: 'Check-PR canary duplicate' }));
    const { errors } = loadCatalog(rootDir, [fa, fb]);
    return errors.some((e) => /duplicate id/.test(e));
  } catch (_e) {
    return false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fail(errors, context) {
  for (const err of errors) {
    console.error(`ERROR: ${err}`);
  }
  console.error(`CHECK_PR FAILED: ${context}`);
  process.exit(1);
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const args = parseArgs(process.argv);
  const changed = getChangedFiles(args.base);
  const { yamlChanged, scriptsChanged } = classifyChangedFiles(changed);
  if (yamlChanged.length === 0 && scriptsChanged.length === 0) {
    console.log('CHECK_PR_OK: no data/**/*.yaml or scripts/** files changed');
    return;
  }
  if (yamlChanged.length > 0) {
    const absFiles = yamlChanged.map((f) => path.join(rootDir, f));
    const { entries, errors } = loadCatalog(rootDir, absFiles);
    if (errors.length > 0) {
      fail(errors, `${errors.length} error(s) in ${yamlChanged.length} changed file(s)`);
    }
    console.log(`CHECK_PR_OK: ${entries.length} changed entr${entries.length === 1 ? 'y' : 'ies'} valid`);
  }
  if (scriptsChanged.length > 0) {
    // Validator/gate code itself changed: validate the whole catalog (not just
    // the diff) and require the negative-control canary to fire.
    const { entries, errors } = loadCatalog(rootDir);
    if (errors.length > 0) {
      fail(errors, `full catalog invalid after scripts/** change (${errors.length} error(s))`);
    }
    if (!runValidatorCanary(rootDir)) {
      fail(
        ['validator canary did not reject a duplicate id (validator may be neutered)'],
        'validator canary failed after scripts/** change; run the full suite before merging'
      );
    }
    console.log(
      `CHECK_PR_OK: scripts changed (${scriptsChanged.length} file(s)); ` +
      `full catalog valid (${entries.length} entries) + validator canary passed`
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  getChangedFiles,
  classifyChangedFiles,
  runValidatorCanary,
};
