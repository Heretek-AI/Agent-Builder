// scripts/utils/catalog.js
// Recursive YAML loader, validator, and taxonomy resolver (CommonJS).
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Ajv = require('ajv');

function collectCategoryIds(categories, out) {
  for (const cat of categories || []) {
    if (cat && typeof cat.id === 'string') {
      out.set(cat.id, cat);
    }
    if (Array.isArray(cat.children)) {
      collectCategoryIds(cat.children, out);
    }
  }
  return out;
}

// Reads data/taxonomy.json and returns { ids: Set, map: Map }.
// ids contains every valid branch and leaf category ID.
function loadTaxonomy(rootDir) {
  const taxonomyPath = path.join(rootDir, 'data', 'taxonomy.json');
  const raw = fs.readFileSync(taxonomyPath, 'utf8');
  const taxonomy = JSON.parse(raw);
  const map = collectCategoryIds(taxonomy.categories, new Map());
  const ids = new Set(map.keys());
  return { ids, map, taxonomy };
}

// Recursively finds all .yaml / .yml files under dir.
function walkYamlFiles(dir) {
  const out = [];
  function walk(current) {
    if (!fs.existsSync(current)) return;
    const stat = fs.statSync(current);
    if (stat.isFile()) {
      if (current.endsWith('.yaml') || current.endsWith('.yml')) out.push(current);
      return;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
        out.push(full);
      }
    }
  }
  walk(dir);
  return out.sort();
}

function buildValidator(rootDir) {
  const schemaPath = path.join(rootDir, 'data', 'schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  try {
    const addFormats = require('ajv-formats');
    addFormats(ajv);
  } catch (_e) {
    // ajv-formats unavailable; fall through to regex fallback below.
  }
  try {
    ajv.addFormat('uri', /^https?:\/\/[^\s/$.?#].[^\s]*$/i);
  } catch (_e) {
    // Format already registered; ignore.
  }
  const validate = ajv.compile(schema);
  return validate;
}

// Validates a single plain-object entry against data/schema.json.
// Returns { valid: boolean, errors: Array }.
function validateEntryObject(obj, rootDir) {
  const root = rootDir || path.join(__dirname, '..', '..');
  const validate = buildValidator(root);
  const valid = validate(obj);
  return { valid: !!valid, errors: validate.errors ? validate.errors.slice() : [] };
}

// Parses every YAML file, validates against schema, checks category
// membership, global id uniqueness, and duplicate (repo, path, kind, id) tuples.
// Returns { entries: Array<{ file, entry }>, errors: Array<string> }.
function loadCatalog(rootDir, targetFiles) {
  const { ids } = loadTaxonomy(rootDir);
  const validate = buildValidator(rootDir);
  const files = Array.isArray(targetFiles)
    ? targetFiles.slice().sort()
    : walkYamlFiles(path.join(rootDir, 'data'));

  const entries = [];
  const errors = [];
  const seenIds = new Map();
  const seenTuples = new Set();

  for (const file of files) {
    let doc;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      doc = yaml.load(raw);
    } catch (err) {
      errors.push(`${file}: YAML parse error: ${err.message}`);
      continue;
    }
    if (doc === undefined || doc === null) {
      errors.push(`${file}: empty YAML document`);
      continue;
    }
    if (typeof doc !== 'object' || Array.isArray(doc)) {
      errors.push(`${file}: top-level YAML must be a mapping/object`);
      continue;
    }

    const valid = validate(doc);
    if (!valid) {
      const details = (validate.errors || [])
        .map((e) => `${e.instancePath || '(root)'} ${e.message}`)
        .join('; ');
      errors.push(`${file}: schema validation failed: ${details}`);
      continue;
    }

    if (!ids.has(doc.category)) {
      errors.push(`${file}: unknown category '${doc.category}' (not in data/taxonomy.json)`);
      continue;
    }

    if (seenIds.has(doc.id)) {
      errors.push(`${file}: duplicate id '${doc.id}' (first seen in ${seenIds.get(doc.id)})`);
      continue;
    }
    seenIds.set(doc.id, file);

    const tupleKey = JSON.stringify([doc.repo || '', doc.path || '', doc.kind || '', doc.id || '']);
    if (seenTuples.has(tupleKey)) {
      errors.push(`${file}: duplicate (repo, path, kind, id) tuple ${tupleKey}`);
      continue;
    }
    seenTuples.add(tupleKey);

    entries.push({ file, entry: doc });
  }

  return { entries, errors };
}

module.exports = {
  loadTaxonomy,
  walkYamlFiles,
  loadCatalog,
  validateEntryObject,
};
