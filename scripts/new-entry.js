// scripts/new-entry.js
// Scaffolds a new catalog YAML entry from CLI arguments (CommonJS).
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
  'id',
  'name',
  'repo',
  'path',
  'npm',
  'homepage',
  'tagline',
  'description',
  'kind',
  'category',
  'harnesses',
  'languages',
  'platforms',
  'mcp',
  'agent_preset',
  'content_file',
  'tags',
  'compat',
  'scope',
  'min_version',
  'installation',
  'license',
  'source_attribution',
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      console.error(`ERROR: unexpected positional argument '${a}'`);
      process.exit(1);
    }
    const key = a.slice(2);
    if (key === 'help' || key === 'h') {
      printUsage();
      process.exit(0);
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      console.error(`ERROR: --${key} requires a value`);
      process.exit(1);
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function printUsage() {
  console.log(
    'Usage: node scripts/new-entry.js --id <id> --name "<name>" --kind <kind> --category <category> --repo <url> --tagline "<summary>" [--description "<desc>"] [--harnesses opencode,claude-code] [--output <path>]'
  );
  console.log('Kinds: plugin, skill, mcp-server, design-md, prompt, agent, agent-preset');
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const args = parseArgs(process.argv);

  const required = ['id', 'name', 'kind', 'category', 'repo', 'tagline'];
  for (const key of required) {
    if (!args[key] || String(args[key]).trim() === '') {
      fail(`missing required argument --${key} (see --help)`);
    }
  }

  const id = String(args.id).trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    fail(`invalid --id '${args.id}': must match ^[a-z0-9][a-z0-9-]*$ (lowercase kebab-case)`);
  }

  const kind = String(args.kind).trim();
  if (!Object.prototype.hasOwnProperty.call(KIND_TO_FOLDER, kind)) {
    fail(`invalid --kind '${args.kind}': must be one of ${Object.keys(KIND_TO_FOLDER).join(', ')}`);
  }

  const category = String(args.category).trim();
  const { ids } = loadTaxonomy(rootDir);
  if (!ids.has(category)) {
    fail(`unknown --category '${args.category}' (not in data/taxonomy.json)`);
  }

  const repo = String(args.repo).trim();
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(repo)) {
    fail(`invalid --repo '${args.repo}': must be an http(s) URL`);
  }

  const harnesses = args.harnesses
    ? String(args.harnesses)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
    : ['universal'];
  if (harnesses.length === 0) {
    fail('--harnesses must list at least one harness (comma-separated)');
  }

  const tagline = String(args.tagline).trim();
  const description =
    args.description && String(args.description).trim() !== ''
      ? String(args.description).trim()
      : tagline;

  const folder = KIND_TO_FOLDER[kind];
  let subpath = category;
  if (category === folder) {
    subpath = '';
  } else if (category.startsWith(`${folder}/`)) {
    subpath = category.slice(folder.length + 1);
  }

  let outAbs;
  if (args.output) {
    outAbs = path.isAbsolute(args.output)
      ? args.output
      : path.join(rootDir, args.output);
  } else {
    outAbs = subpath
      ? path.join(rootDir, 'data', folder, subpath, `${id}.yaml`)
      : path.join(rootDir, 'data', folder, `${id}.yaml`);
  }

  if (fs.existsSync(outAbs)) {
    fail(`refusing to overwrite existing file '${path.relative(rootDir, outAbs)}'`);
  }

  const doc = {
    id,
    name: String(args.name).trim(),
    repo,
    tagline,
    description,
    kind,
    category,
    harnesses,
    license: 'MIT',
  };

  const ordered = {};
  for (const key of KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(doc, key)) {
      ordered[key] = doc[key];
    }
  }

  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, yaml.dump(ordered, { lineWidth: 100, noRefs: true, sortKeys: false }), 'utf8');
  console.log(`CREATED ${path.relative(rootDir, outAbs)}`);
}

main();
