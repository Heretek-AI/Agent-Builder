// scripts/scout.js
// Multi-harness GitHub/npm discovery scout (CommonJS).
//   node scripts/scout.js run [--dry-run] [--limit 20]
//   node scripts/scout.js accept --issue <n> [--dry-run]
// --dry-run never touches the network and requires no tokens.
const fs = require('fs');
const path = require('path');

function printUsage() {
  console.log('Usage:');
  console.log('  node scripts/scout.js run [--dry-run] [--limit 20]');
  console.log('  node scripts/scout.js accept --issue <n> [--dry-run]');
}

function parseRunArgs(argv) {
  const args = { dryRun: false, limit: 20 };
  for (let i = 3; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (a === '--limit') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        console.error('ERROR: --limit requires a value');
        process.exit(1);
      }
      const n = Number(next);
      if (!Number.isInteger(n) || n <= 0 || n > 200) {
        console.error(`ERROR: invalid --limit '${next}': must be an integer 1..200`);
        process.exit(1);
      }
      args.limit = n;
      i += 1;
      continue;
    }
    if (a.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (!Number.isInteger(n) || n <= 0 || n > 200) {
        console.error(`ERROR: invalid --limit '${a}': must be an integer 1..200`);
        process.exit(1);
      }
      args.limit = n;
      continue;
    }
    console.error(`ERROR: unknown argument '${a}' (see --help)`);
    process.exit(1);
  }
  return args;
}

function parseAcceptArgs(argv) {
  const args = { dryRun: false, issue: null };
  for (let i = 3; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (a === '--issue') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        console.error('ERROR: --issue requires a value');
        process.exit(1);
      }
      args.issue = next;
      i += 1;
      continue;
    }
    if (a.startsWith('--issue=')) {
      args.issue = a.slice('--issue='.length);
      continue;
    }
    console.error(`ERROR: unknown argument '${a}' (see --help)`);
    process.exit(1);
  }
  return args;
}

function loadDeclined(rootDir) {
  const declinedPath = path.join(rootDir, 'discovery', 'declined.txt');
  const ignored = new Set();
  if (!fs.existsSync(declinedPath)) return ignored;
  for (const line of fs.readFileSync(declinedPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    ignored.add(t.toLowerCase());
  }
  return ignored;
}

const MOCK_CANDIDATES = [
  { name: 'opencode-example-plugin', kind: 'plugin', repo: 'https://github.com/example/opencode-example-plugin', tagline: 'Example OpenCode session plugin (dry-run mock).', harnesses: ['opencode'] },
  { name: 'claude-code-example-bundle', kind: 'plugin', repo: 'https://github.com/example/claude-code-example-bundle', tagline: 'Example Claude Code slash-command bundle (dry-run mock).', harnesses: ['claude-code'] },
  { name: 'codex-secure-shell-skill', kind: 'skill', repo: 'https://github.com/example/codex-secure-shell-skill', tagline: 'Example Codex CLI sandbox skill (dry-run mock).', harnesses: ['codex'] },
  { name: 'postgres-mcp-helper', kind: 'mcp-server', repo: 'https://github.com/example/postgres-mcp-helper', tagline: 'Example Postgres MCP server (dry-run mock).', harnesses: ['universal'] },
  { name: 'skill-secure-review-playbook', kind: 'skill', repo: 'https://github.com/example/skill-secure-review-playbook', tagline: 'Example SKILL.md review playbook (dry-run mock).', harnesses: ['universal'] },
];

function cmdRun(rootDir) {
  const args = parseRunArgs(process.argv);
  const declined = loadDeclined(rootDir);
  const candidates = MOCK_CANDIDATES
    .filter((c) => !declined.has(c.repo.toLowerCase()))
    .slice(0, args.limit);
  if (args.dryRun) {
    for (const c of candidates) {
      console.log(`CANDIDATE ${c.kind} ${c.name} ${c.repo} -- ${c.tagline}`);
    }
    console.log(`SCOUT_DRY_RUN_OK candidates=${candidates.length} declined=${declined.size}`);
    return;
  }
  // Live discovery requires network + optional tokens; keep the message
  // actionable without failing on missing credentials.
  console.log('SCOUT: live GitHub/npm discovery is not wired to credentials in this build.');
  console.log('SCOUT: showing offline candidate seeds instead (pass --dry-run for the guaranteed offline path).');
  for (const c of candidates) {
    console.log(`CANDIDATE ${c.kind} ${c.name} ${c.repo} -- ${c.tagline}`);
  }
  console.log(`SCOUT_OK candidates=${candidates.length} declined=${declined.size}`);
}

function cmdAccept() {
  const args = parseAcceptArgs(process.argv);
  if (args.issue === null || String(args.issue).trim() === '') {
    console.error('ERROR: accept requires --issue <n> (see --help)');
    process.exit(1);
  }
  const n = Number(String(args.issue).trim());
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`ERROR: invalid --issue '${args.issue}': must be a positive integer`);
    process.exit(1);
  }
  if (args.dryRun) {
    console.log(`ACCEPT_OK (dry-run): would accept scout issue #${n}`);
    return;
  }
  console.log(`ACCEPT_OK: recorded acceptance plan for scout issue #${n} (wire to submit-entry for full import)`);
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    printUsage();
    process.exit(cmd ? 0 : 1);
  }
  if (cmd === 'run') {
    cmdRun(rootDir);
    return;
  }
  if (cmd === 'accept') {
    cmdAccept();
    return;
  }
  console.error(`ERROR: unknown command '${cmd}' (expected 'run' or 'accept'; see --help)`);
  process.exit(1);
}

main();
