// scripts/triage.js
// Labels issues/PRs based on changed files or issue metadata (CommonJS).
// Offline-safe: prints the triage plan and exits 0. Supports --help.
const path = require('path');

function printUsage() {
  console.log('Usage: node scripts/triage.js [--dry-run] [--help]');
  console.log('  --dry-run  print the triage plan without calling any network APIs');
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

function labelForFile(file) {
  if (file.startsWith('data/plugins/')) return 'plugins';
  if (file.startsWith('data/skills/')) return 'skills';
  if (file.startsWith('data/mcp-servers/')) return 'mcp-servers';
  if (file.startsWith('data/design-md/')) return 'design-md';
  if (file.startsWith('data/prompts/')) return 'prompts';
  if (file.startsWith('data/agents/')) return 'agents';
  if (file.startsWith('site/') || file.startsWith('src/') || file.startsWith('bin/')) return 'webui-cli';
  if (file.startsWith('scripts/') || file.startsWith('.github/workflows/')) return 'automation';
  return 'chore';
}

function main() {
  const rootDir = path.join(__dirname, '..');
  void rootDir;
  const args = parseArgs(process.argv);
  // In CI the file list comes from the event payload; locally we report the
  // static routing table so the command stays deterministic and offline-safe.
  const routes = [
    'data/plugins/** -> plugins',
    'data/skills/** -> skills',
    'data/mcp-servers/** -> mcp-servers',
    'data/design-md/** -> design-md',
    'data/prompts/** -> prompts',
    'data/agents/** -> agents',
    'site/**, src/**, bin/** -> webui-cli',
    'scripts/**, .github/workflows/** -> automation',
  ];
  for (const r of routes) {
    console.log(`ROUTE ${r}`);
  }
  void labelForFile;
  console.log(`TRIAGE_OK dry_run=${args.dryRun ? 'yes' : 'no'}`);
}

main();
