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
  '4. MCP tool names: mcp.tools must be exact exported tool names; compiled ids use <normServer>_<normTool> normalization (hyphens/underscores preserved, other non-alphanumeric runs -> _).',
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

const KIND_FOLDERS = {
  plugin: 'data/plugins',
  skill: 'data/skills',
  'mcp-server': 'data/mcp-servers',
  'design-md': 'data/design-md',
  prompt: 'data/prompts',
  agent: 'data/agents',
  'agent-preset': 'data/agents',
};

// Fail-closed catalog audit (AB-ai-review-no-enforcement). Beyond schema
// validity this enforces the reviewer rubric as machine checks:
//   - every claimed harness exists in data/taxonomy.json,
//   - kind matches the data/ folder the file lives in,
//   - agent mcp_selections reference a real registry server_name and only
//     tools that server actually exports (invented tools fail),
//   - agent presets compile to deny-first v2 permissions (first rule denies).
// Returns { findings: Array<string> }; empty findings means REVIEW_OK.
function auditCatalogEntries(rootDir, wrappedEntries, taxonomy) {
  const findings = [];
  const harnessIds = new Set((taxonomy.harnesses || []).map((h) => h.id));
  const serverTools = new Map();
  for (const { entry } of wrappedEntries) {
    if (entry.kind === 'mcp-server' && entry.mcp && typeof entry.mcp.server_name === 'string') {
      serverTools.set(entry.mcp.server_name, Array.isArray(entry.mcp.tools) ? entry.mcp.tools : []);
    }
  }
  const mcpRegistry = wrappedEntries
    .map((w) => w.entry)
    .filter((e) => e.kind === 'mcp-server');
  let compileAgentRecipe = null;
  try {
    ({ compileAgentRecipe } = require('../src/core/compiler'));
  } catch (_e) {
    findings.push('compiler unavailable: cannot verify deny-first scoping');
    compileAgentRecipe = null;
  }

  for (const { file, entry } of wrappedEntries) {
    const rel = path.relative(rootDir, file).replace(/\\/g, '/');
    const wantDir = KIND_FOLDERS[entry.kind];
    if (!wantDir) {
      findings.push(`${rel}: unknown kind '${entry.kind}'`);
    } else if (!rel.startsWith(`${wantDir}/`)) {
      findings.push(`${rel}: kind '${entry.kind}' must live under ${wantDir}/ (kind/folder mismatch)`);
    }
    for (const h of entry.harnesses || []) {
      if (!harnessIds.has(h)) {
        findings.push(`${rel}: unknown harness '${h}' (not in data/taxonomy.json harnesses)`);
      }
    }
    const sels =
      entry.agent_preset && Array.isArray(entry.agent_preset.mcp_selections)
        ? entry.agent_preset.mcp_selections
        : [];
    for (const sel of sels) {
      if (!sel || typeof sel.server !== 'string' || !serverTools.has(sel.server)) {
        findings.push(
          `${rel}: unknown mcp server '${sel && sel.server}' (no mcp-server entry defines it)`
        );
        continue;
      }
      const known = new Set(serverTools.get(sel.server).map((t) => String(t)));
      for (const t of sel.tools || []) {
        if (String(t).trim() === '*') continue;
        if (!known.has(String(t))) {
          findings.push(
            `${rel}: invented tool '${t}' for server '${sel.server}' (not in that server's mcp.tools)`
          );
        }
      }
    }
    const isAgent = entry.kind === 'agent' || entry.kind === 'agent-preset' || sels.length > 0;
    if (isAgent && compileAgentRecipe) {
      let perms;
      try {
        const recipe = {
          slug: entry.id,
          description: entry.description || '',
          mode: (entry.agent_preset && entry.agent_preset.mode) || 'subagent',
          skills: (entry.agent_preset && entry.agent_preset.skills) || [],
          mcp: sels.map((s) => ({ server: s.server, tools: s.tools || ['*'] })),
        };
        const compiled = compileAgentRecipe(recipe, mcpRegistry);
        const agent = compiled.opencodeV2 && compiled.opencodeV2.agents[entry.id];
        perms = agent && agent.permissions;
      } catch (err) {
        findings.push(`${rel}: agent preset does not compile: ${err.message}`);
        continue;
      }
      if (!Array.isArray(perms) || perms.length === 0 || perms[0].effect !== 'deny') {
        findings.push(`${rel}: agent preset is not deny-first (first v2 permission must deny)`);
      }
    }
  }
  return { findings };
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
  let taxonomy;
  try {
    taxonomy = JSON.parse(
      require('fs').readFileSync(path.join(rootDir, 'data', 'taxonomy.json'), 'utf8')
    );
  } catch (err) {
    console.error(`ERROR: unable to load data/taxonomy.json: ${err.message}`);
    console.error('REVIEW FAILED: taxonomy unreadable');
    process.exit(1);
  }
  const { findings } = auditCatalogEntries(rootDir, entries, taxonomy);
  if (findings.length > 0) {
    for (const f of findings) {
      console.error(`ERROR: ${f}`);
    }
    console.error(`REVIEW FAILED: ${findings.length} rubric violation(s)`);
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
    execFileSync(process.execPath, [path.join(rootDir, 'scripts', 'build-site.js')], { stdio: 'inherit' });
  } catch (_e) {
    console.error('ERROR: selftest site step failed');
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

if (require.main === module) {
  main();
}

module.exports = {
  REVIEW_RUBRIC,
  KIND_FOLDERS,
  auditCatalogEntries,
  cmdCollect,
  cmdRun,
  cmdSelftest,
  cmdApply,
};
