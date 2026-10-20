// scripts/build-site.js
// Assembles _site/ for GitHub Pages (CommonJS).
//
// Steps (idempotent except for `generated_at` timestamps, which advance on
// every run unless SOURCE_DATE_EPOCH is set — see below):
//   1. mkdir _site/ (and _site/core/, _site/content/).
//   2. Copy site/index.html, site/styles.css, site/app.js -> _site/.
//   3. Copy src/core/compiler.js, src/core/importer.js, src/core/classifier.js -> _site/core/.
//   4. Regenerate _site/registry.json from the validated catalog
//      (same deterministic output as scripts/export-json.js).
//   5. Copy dist/content/*.md -> _site/content/ when present.
//   6. Copy dist/health.json -> _site/health.json when present,
//      otherwise write a fresh { status: "ok", generated_at } file.
//   7. Write empty _site/.nojekyll.
// Prints SITE_BUILT on success; fail-closed (exit 1) on any error.
//
// Reproducibility (AB-5.3-registry-idempotency): every build stamps
// `generated_at` with the current time, so two consecutive runs differ by
// that one timestamp line and are otherwise byte-identical. When the
// `SOURCE_DATE_EPOCH` environment variable is set (seconds since the Unix
// epoch, per https://reproducible-builds.org/specs/source-date-epoch/),
// it is used as the timestamp source instead, making two runs fully
// byte-identical: `SOURCE_DATE_EPOCH=$(date +%s) npm run site` twice ->

const fs = require('fs');
const path = require('path');
const { loadCatalog } = require('./utils/catalog');

const VERSION = '1.0.0';
const REPOSITORY = 'https://github.com/Heretek-AI/Agent-Builder';
const REGISTRY_URL = 'https://heretek-ai.github.io/Agent-Builder/registry.json';

function resolveGeneratedAt() {
  const raw = process.env.SOURCE_DATE_EPOCH;
  if (raw === undefined || raw === '') {
    return new Date().toISOString();
  }
  const trimmed = String(raw).trim();
  let ms;
  if (/^-?\d+$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    ms = Date.parse(trimmed);
  }
  if (!Number.isFinite(ms)) {
    console.error(`ERROR: invalid SOURCE_DATE_EPOCH=${JSON.stringify(raw)} (expected integer seconds since epoch)`);
    process.exit(1);
  }
  return new Date(ms).toISOString();
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) {
    console.error(`ERROR: required source file missing: ${path.relative(process.cwd(), src)}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const siteDir = path.join(rootDir, 'site');
  const outDir = path.join(rootDir, '_site');

  if (!fs.existsSync(siteDir)) {
    console.error('ERROR: site/ directory missing; nothing to build');
    process.exit(1);
  }

  try {
    if (fs.existsSync(outDir)) {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error(`ERROR: unable to clean _site/: ${err.message}`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, 'core'), { recursive: true });
  fs.mkdirSync(path.join(outDir, 'content'), { recursive: true });

  // 1. WebUI shell.
  copyFile(path.join(siteDir, 'index.html'), path.join(outDir, 'index.html'));
  copyFile(path.join(siteDir, 'styles.css'), path.join(outDir, 'styles.css'));
  copyFile(path.join(siteDir, 'app.js'), path.join(outDir, 'app.js'));

  // 2. Shared core (UMD: works via plain <script> tags, no bundler).
  copyFile(path.join(rootDir, 'src', 'core', 'compiler.js'), path.join(outDir, 'core', 'compiler.js'));
  copyFile(path.join(rootDir, 'src', 'core', 'importer.js'), path.join(outDir, 'core', 'importer.js'));
  copyFile(path.join(rootDir, 'src', 'core', 'classifier.js'), path.join(outDir, 'core', 'classifier.js'));

  // 3. Registry JSON (regenerated from catalog so _site is never stale).
  const { entries, errors } = loadCatalog(rootDir);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`ERROR: ${err}`);
    }
    console.error(`SITE BUILD FAILED: ${errors.length} catalog error(s)`);
    process.exit(1);
  }
  const taxonomy = JSON.parse(fs.readFileSync(path.join(rootDir, 'data', 'taxonomy.json'), 'utf8'));
  const sorted = entries.map((w) => w.entry).sort((a, b) => {
    if (a.category < b.category) return -1;
    if (a.category > b.category) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  const byKind = {};
  const byCategory = {};
  const byHarness = {};
  for (const e of sorted) {
    byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    for (const h of e.harnesses || []) {
      byHarness[h] = (byHarness[h] || 0) + 1;
    }
  }
  const registry = {
    version: VERSION,
    repository: REPOSITORY,
    registry_url: REGISTRY_URL,
    generated_at: resolveGeneratedAt(),
    stats: { total: sorted.length, by_kind: byKind, by_category: byCategory, by_harness: byHarness },
    taxonomy,
    entries: sorted,
  };
  fs.writeFileSync(path.join(outDir, 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);

  // 4. Bundled markdown previews.
  const distContent = path.join(rootDir, 'dist', 'content');
  if (fs.existsSync(distContent)) {
    for (const f of fs.readdirSync(distContent)) {
      if (f.endsWith('.md')) {
        fs.copyFileSync(path.join(distContent, f), path.join(outDir, 'content', f));
      }
    }
  }

  // 5. Health file.
  const distHealth = path.join(rootDir, 'dist', 'health.json');
  if (fs.existsSync(distHealth)) {
    fs.copyFileSync(distHealth, path.join(outDir, 'health.json'));
  } else {
    const health = { status: 'ok', generated_at: resolveGeneratedAt() };
    fs.writeFileSync(path.join(outDir, 'health.json'), `${JSON.stringify(health, null, 2)}\n`);
  }

  // 6. Disable Jekyll processing on GitHub Pages.
  fs.writeFileSync(path.join(outDir, '.nojekyll'), '');

  console.log(`SITE_BUILT _site/ with ${sorted.length} registry entries`);
}

main();
