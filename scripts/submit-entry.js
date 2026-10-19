// scripts/submit-entry.js
// Parses GitHub issue-form JSON (add-entry + publish-agent) into data/**/*.yaml (CommonJS).
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { loadTaxonomy } = require('./utils/catalog');

const KIND_TO_FOLDER = {
  plugin: 'plugins',
  skill: 'skills',
  'mcp-server': 'mcp-servers',
  'design-md': 'design-md',
  prompt: 'prompts',
  agent: 'agents',
  'agent-preset': 'agents',
};

const KEY_ORDER = [
  'id', 'name', 'repo', 'path', 'npm', 'homepage', 'tagline', 'description',
  'kind', 'category', 'harnesses', 'languages', 'platforms', 'mcp',
  'agent_preset', 'content_file', 'tags', 'compat', 'scope', 'min_version',
  'installation', 'license', 'source_attribution',
];

function printUsage() {
  console.log('Usage: node scripts/submit-entry.js --issue <file.json> [--dry-run] [--help]');
  console.log('  --issue <file>  GitHub issue JSON ({ title, body }) with form fields');
  console.log('  --dry-run       validate + print the YAML without writing files');
}

function parseArgs(argv) {
  const args = { issue: null, dryRun: false };
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

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function slugify(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'entry';
}

// Parses "### Label\n\nvalue" GitHub issue-form body sections into { label: value }.
function parseIssueBody(body) {
  const fields = {};
  const lines = String(body || '').split('\n');
  let current = null;
  let buf = [];
  function flush() {
    if (current !== null) {
      fields[current] = buf.join('\n').trim().replace(/^_No response_$/m, '').trim();
    }
  }
  for (const line of lines) {
    const m = line.match(/^###\s+(.+)\s*$/);
    if (m) {
      flush();
      current = m[1].trim().toLowerCase();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return fields;
}

function get(fields, ...names) {
  for (const n of names) {
    if (fields[n] !== undefined && String(fields[n]).trim() !== '') return String(fields[n]).trim();
  }
  return '';
}

function parseCheckboxList(raw) {
  // Form checkboxes render as "- [x] Label" lines; map labels to harness ids.
  const out = [];
  const labelToId = {
    opencode: 'opencode', 'claude code': 'claude-code', 'claude-code': 'claude-code',
    'codex cli': 'codex', codex: 'codex', 'gemini cli': 'gemini-cli', 'gemini-cli': 'gemini-cli',
    cursor: 'cursor', windsurf: 'windsurf', 'github copilot': 'copilot', copilot: 'copilot',
    'universal / multi-harness': 'universal', universal: 'universal',
  };
  for (const line of String(raw || '').split('\n')) {
    const m = line.match(/^-\s*\[[xX]\]\s*(.+)$/);
    if (!m) continue;
    let label = m[1].trim();
    const paren = label.match(/^(.*)\(([^)]+)\)\s*$/);
    if (paren) label = paren[2].trim();
    const id = labelToId[label.toLowerCase()];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function parseMcpSelections(raw) {
  if (!raw || String(raw).trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (err) {
    fail(`invalid MCP selections JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) fail('MCP selections JSON must be an array');
  return parsed.map((sel, i) => {
    if (typeof sel === 'string') return { server: sel.trim(), tools: ['*'] };
    if (sel && typeof sel === 'object' && typeof sel.server === 'string') {
      const out = { server: sel.server.trim() };
      if (sel.tools !== undefined) out.tools = sel.tools;
      if (sel.deniedTools !== undefined) out.deniedTools = sel.deniedTools;
      if (sel.allowResources !== undefined) out.allowResources = sel.allowResources;
      void i;
      return out;
    }
    fail(`MCP selections entry at index ${i} must be a string or { server, ... } object`);
    return null;
  });
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const args = parseArgs(process.argv);
  if (!args.issue) fail('missing required argument --issue <file.json> (see --help)');
  const issueAbs = path.isAbsolute(args.issue) ? args.issue : path.join(rootDir, args.issue);
  if (!fs.existsSync(issueAbs)) fail(`issue file not found: '${args.issue}'`);
  let issue;
  try {
    issue = JSON.parse(fs.readFileSync(issueAbs, 'utf8'));
  } catch (err) {
    fail(`unable to parse issue JSON: ${err.message}`);
  }
  const fields = parseIssueBody(issue.body || '');
  const { ids } = loadTaxonomy(rootDir);

  // Detect publish-agent form (has system prompt / agent name) vs add-entry form.
  const isAgentForm = get(fields, 'system prompt', 'agent name / slug', 'recipe yaml') !== ''
    || /\[agent\]/.test(String(issue.title || ''));

  let doc;
  if (isAgentForm) {
    const agentName = get(fields, 'agent name / slug', 'agent name', 'entry name') || get(fields, 'title');
    const id = slugify(agentName);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail(`derived agent id '${id}' is invalid`);
    const description = get(fields, 'description') || 'Agent preset submitted via publish-agent form.';
    const harness = get(fields, 'target harness', 'harness').toLowerCase() || 'universal';
    const skills = get(fields, 'skills').split(',').map((s) => s.trim()).filter(Boolean);
    const mcpSelections = parseMcpSelections(get(fields, 'mcp selections (json)', 'mcp selections'));
    const recipeYaml = get(fields, 'recipe yaml', 'recipe');
    let recipePrompt = get(fields, 'system prompt', 'prompt');
    if (recipeYaml) {
      try {
        const recipe = yaml.load(recipeYaml);
        if (recipe && typeof recipe === 'object') {
          if (recipe.prompt) recipePrompt = String(recipe.prompt);
          if (Array.isArray(recipe.skills) && skills.length === 0) {
            for (const s of recipe.skills) skills.push(String(s));
          }
        }
      } catch (err) {
        fail(`invalid recipe YAML: ${err.message}`);
      }
    }
    if (!recipePrompt) fail('publish-agent issue is missing the system prompt');
    doc = {
      id,
      name: agentName,
      repo: 'https://github.com/Heretek-AI/Agent-Builder',
      tagline: description.slice(0, 120),
      description,
      kind: 'agent',
      category: 'agents/security-auditors',
      harnesses: [harness || 'universal'],
      agent_preset: {
        mode: 'subagent',
        ...(get(fields, 'model') ? { model: get(fields, 'model') } : {}),
        prompt: recipePrompt,
        skills,
        mcp_selections: mcpSelections,
      },
      license: 'MIT',
    };
  } else {
    const name = get(fields, 'entry name', 'name') || String(issue.title || '').replace(/^\[entry\]\s*/i, '').trim();
    const kind = get(fields, 'kind').toLowerCase();
    const category = get(fields, 'category');
    const repo = get(fields, 'repository url', 'repo', 'repository');
    const tagline = get(fields, 'tagline');
    const description = get(fields, 'description') || tagline;
    if (!name) fail('add-entry issue is missing the entry name');
    if (!Object.prototype.hasOwnProperty.call(KIND_TO_FOLDER, kind)) {
      fail(`invalid kind '${kind || '(missing)'}': must be one of ${Object.keys(KIND_TO_FOLDER).join(', ')}`);
    }
    if (!ids.has(category)) fail(`unknown category '${category || '(missing)'}' (not in data/taxonomy.json)`);
    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(repo)) fail(`invalid repo URL '${repo || '(missing)'}'`);
    if (!tagline) fail('add-entry issue is missing the tagline');
    let harnesses = parseCheckboxList(get(fields, 'supported harnesses', 'harnesses'));
    if (harnesses.length === 0) harnesses = ['universal'];
    const languages = get(fields, 'languages').split(',').map((s) => s.trim()).filter(Boolean);
    doc = {
      id: slugify(name),
      name,
      repo,
      tagline,
      description,
      kind,
      category,
      harnesses,
      ...(languages.length > 0 ? { languages } : {}),
      license: get(fields, 'license') || 'MIT',
    };
  }

  const folder = KIND_TO_FOLDER[doc.kind];
  let subpath = doc.category;
  if (subpath === folder) subpath = '';
  else if (subpath.startsWith(`${folder}/`)) subpath = subpath.slice(folder.length + 1);
  const outAbs = subpath
    ? path.join(rootDir, 'data', folder, subpath, `${doc.id}.yaml`)
    : path.join(rootDir, 'data', folder, `${doc.id}.yaml`);

  const ordered = {};
  for (const key of KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(doc, key)) ordered[key] = doc[key];
  }
  const text = yaml.dump(ordered, { lineWidth: 100, noRefs: true, sortKeys: false });
  if (args.dryRun) {
    console.log(text);
    console.log(`SUBMIT_OK (dry-run): would write ${path.relative(rootDir, outAbs)}`);
    return;
  }
  if (fs.existsSync(outAbs)) fail(`refusing to overwrite existing file '${path.relative(rootDir, outAbs)}'`);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, text, 'utf8');
  console.log(`SUBMIT_OK: wrote ${path.relative(rootDir, outAbs)}`);
}

main();
