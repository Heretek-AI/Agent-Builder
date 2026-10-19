// scripts/run-tests.js
// Cross-platform Node test runner: recursively discovers *.test.js under test/
// and executes them via execFileSync without quoted glob patterns.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function collectTestFiles(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const testDir = path.join(__dirname, '..', 'test');
  if (!fs.existsSync(testDir)) {
    console.log('run-tests: no test/ directory found, nothing to run.');
    process.exit(0);
  }
  const files = collectTestFiles(testDir, []).sort();
  if (files.length === 0) {
    console.log('run-tests: no *.test.js files found, nothing to run.');
    process.exit(0);
  }
  execFileSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
}

main();
