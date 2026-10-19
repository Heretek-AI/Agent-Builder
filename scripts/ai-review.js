// scripts/ai-review.js
// 4-stage AI catalog review runner: collect / run / selftest / apply (CommonJS).
const { execFileSync } = require('child_process');
const path = require('path');
const { loadCatalog } = require('./utils/catalog');

function printUsage() {
  console.log('Usage: node scripts/ai-review.js <collect|run|selftest|apply> [options]');
  console.log('  collect            list changed data/**/*.yaml files for review');
  console.log('  run                print the reviewer rubric + catalog findings');
  console.log('  selftest           run validate + compiler/mcp tests');
  console.log('  apply              placeholder: apply reviewer suggestions (dry-run safe)');
}

const REVIEW_RUBRIC = [
  '1. category placement: entry.category must be a leaf id in data/taxonomy.json matching the entry subject.',
  '2. kind/folder match: kind plugin->data/plugins, skill->data/skills, mcp-server->data/mcp-servers, design-md->data/design-md, prompt->data/prompts, agent->data/agents.',
  '3. harnesses compatibility: every claimed harness must be plausible for the entry (opencode/claude-code/codex/etc.).',
  '4. MCP tool names: mcp.tools must be exact exported tool names; compiled ids use <normServer>_<normTool> normalization (non-alphanumerics -> _).',
  '5. deny-first scoping: agent presets must compile to deny "*" first, then explicit allows (last match wins).',
  '6. license/attribution: license SPDX + source_attribution must credit upstream.',
];

function cmdCollect(rootDir) {
  let changed = [];
  try {
    const out = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], { encoding: 'utf8' });
    changed = out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (_e) {
    try {
      const out = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
      changed = out.split('\n').map((l) => l.slice(3).trim()).filter(Boolean);
    } catch (err) {
      console.error(`ERROR: unable to collect changed files: ${err.message}`);
      process.exit(1);
    }
  }
  const yaml = changed.filter((f) => f.startsWith('data/') && (f.endsWith('.yaml') || f.endsWith('.yml')));
  if (yaml.length === 0) {
    console.log('COLLECT_OK: no changed data/**/*.yaml files');
    return;
  }
  for (const f of yaml) console.log(`REVIEW_FILE ${f}`);
  console.log(`COLLECT_OK files=${yaml.length}`);
  void rootDir;
}

function cmdRun(rootDir) {
  const { entries, errors } = loadCatalog(rootDir);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`ERROR: ${err}`);
    }
    console.error(`REVIEW FAILED: ${errors.length} catalog error(s)`);
    process.exit(1);
  }
  console.log('REVIEW RUBRIC (catalog-reviewer):');
  for (const line of REVIEW_RUBRIC) console.log(` - ${line}`);
  const byCategory = {};
  let mcpTools = 0;
  for (const { entry } of entries) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
    if (entry.kind === 'mcp-server' && entry.mcp && Array.isArray(entry.mcp.tools)) {
      mcpTools += entry.mcp.tools.length;
    }
  }
  console.log(`REVIEW_OK entries=${entries.length} categories=${Object.keys(byCategory).length} mcp_tools=${mcpTools}`);
}

function cmdSelftest(rootDir) {
  try {
    execFileSync(process.execPath, [path.join(rootDir, 'scripts', 'validate.js')], { stdio: 'inherit' });
  } catch (_e) {
    console.error('ERROR: selftest validate step failed');
    process.exit(1);
  }
  try {
    execFileSync(process.execPath, [path.join(rootDir, 'scripts', 'run-tests.js')], { stdio: 'inherit' });
  } catch (_e) {
    console.error('ERROR: selftest test step failed');
    process.exit(1);
  }
  console.log('SELFTEST_OK');
}

function cmdApply() {
  console.log('APPLY_OK: no pending reviewer suggestions to apply (placeholder; suggestions are applied via PR edits)');
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    printUsage();
    process.exit(cmd ? 0 : 1);
  }
  if (cmd === 'collect') {
    cmdCollect(rootDir);
    return;
  }
  if (cmd === 'run') {
    cmdRun(rootDir);
    return;
  }
  if (cmd === 'selftest') {
    cmdSelftest(rootDir);
    return;
  }
  if (cmd === 'apply') {
    cmdApply();
    return;
  }
  console.error(`ERROR: unknown command '${cmd}' (expected collect|run|selftest|apply; see --help)`);
  process.exit(1);
}

main();
