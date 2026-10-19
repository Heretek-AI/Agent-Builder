// scripts/fmt.js
// Normalizes YAML key ordering and formatting across all data/**/*.yaml files (CommonJS).
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { walkYamlFiles } = require('./utils/catalog');

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

function orderKeys(doc) {
  const ordered = {};
  for (const key of KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(doc, key)) {
      ordered[key] = doc[key];
    }
  }
  const remaining = Object.keys(doc)
    .filter((k) => !KEY_ORDER.includes(k))
    .sort();
  for (const key of remaining) {
    ordered[key] = doc[key];
  }
  return ordered;
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const files = walkYamlFiles(path.join(rootDir, 'data'));
  let formatted = 0;
  for (const file of files) {
    let doc;
    try {
      doc = yaml.load(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`ERROR: ${file}: YAML parse error: ${err.message}`);
      process.exit(1);
    }
    if (doc === undefined || doc === null) {
      console.error(`ERROR: ${file}: empty YAML document`);
      process.exit(1);
    }
    if (typeof doc !== 'object' || Array.isArray(doc)) {
      console.error(`ERROR: ${file}: top-level YAML must be a mapping/object`);
      process.exit(1);
    }
    const ordered = orderKeys(doc);
    const dumped = yaml.dump(ordered, { lineWidth: 100, noRefs: true, sortKeys: false });
    const raw = fs.readFileSync(file, 'utf8');
    if (dumped !== raw) {
      fs.writeFileSync(file, dumped, 'utf8');
      formatted += 1;
    }
  }
  console.log(`FMT_OK: checked ${files.length} files, formatted ${formatted}`);
}

main();
