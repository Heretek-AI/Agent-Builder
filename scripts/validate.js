// scripts/validate.js
// Validates all data/**/*.yaml entries against data/schema.json & data/taxonomy.json.
const path = require('path');
const { loadCatalog } = require('./utils/catalog');

function main() {
  const rootDir = path.join(__dirname, '..');
  const { entries, errors } = loadCatalog(rootDir);
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`ERROR: ${err}`);
    }
    console.error(`VALIDATION FAILED: ${errors.length} error(s) in ${entries.length} valid entries`);
    process.exit(1);
  }
  console.log(`VALIDATED ${entries.length} ENTRIES OK`);
}

main();
