#!/usr/bin/env node
// bin/agent-builder.js
// Local CLI for @heretek-ai/agent-builder (CommonJS).
//
// Subcommands:
//   serve   [--port 4173] [--host 127.0.0.1]   serve the WebUI + bridge APIs
//   compile --recipe <file.json> [--harness <id>]  print compiled config
//   install --recipe <file.json|base64> [--target-dir .] [--harness id] [--dry-run]
//   mcp                                     start the stdio MCP server (M9)
//
// Fail-closed: unknown commands/flags, missing files, bad recipes, and path
// escapes all exit non-zero. Never logs API keys. Spawns use argv arrays only.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VALID_HARNESSES = [
  'opencode-v2',
  'opencode-v1',
  'opencode-md',
  'claude-code',
  'codex',
  'pi',
  'gemini-cli',
  'cursor',
  'windsurf',
  'copilot'
];

function loadVersion() {
  try {
    return require('../package.json').version;
  } catch (_e) {
    return '0.0.0';
  }
}

function printUsage() {
  console.log(`agent-builder v${loadVersion()} — local WebUI + compiler + installer + MCP bridge

Usage:
  agent-builder serve [--port 4173] [--host 127.0.0.1]
    Serve the WebUI and registry.json locally with bridge APIs:
      GET  /api/status          { mode: "local-cli", version, mcpBridge: true }
      POST /api/llm/chat        CORS-free OpenAI-compatible chat proxy
      POST /api/mcp/introspect  live stdio MCP tool discovery (5s timeout)
      POST /api/install         write compiled agent bundle into a directory

  agent-builder compile --recipe <file.json> [--harness <id>]
    Print the compiled configuration to stdout.
    Harness: ${VALID_HARNESSES.join('|')} (default: opencode-v2)

  agent-builder install --recipe <file.json|base64> [--target-dir .] [--harness opencode-v2] [--dry-run]
    Write (or preview with --dry-run) the agent config and skill files
    into the target workspace directory.

  agent-builder mcp
    Start the stdio JSON-RPC 2.0 MCP server (Milestone 9).

Options:
  -h, --help     Show this help and exit 0.
`);
}

function fail(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}

function parseServeArgs(argv) {
  let port = 4173;
  let host = '127.0.0.1';
  let allowLoopbackLlm = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a.startsWith('--port=')) {
      const val = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (val === undefined || val === '') {
        fail('serve: --port requires a value');
      }
      port = Number(val);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        fail('serve: --port must be an integer 1-65535, got ' + JSON.stringify(val));
      }
    } else if (a === '--host' || a.startsWith('--host=')) {
      const val = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
      if (val === undefined || val === '') {
        fail('serve: --host requires a value');
      }
      host = val;
    } else if (a === '--allow-loopback-llm') {
      allowLoopbackLlm = true;
    } else {
      fail('serve: unknown argument ' + JSON.stringify(a) + ' (see --help)');
    }
  }
  return { port, host, allowLoopbackLlm };
}

function loadRegistryEntries() {
  const rootDir = path.join(__dirname, '..');
  const candidates = [
    path.join(rootDir, 'dist', 'registry.json'),
    path.join(rootDir, '_site', 'registry.json')
  ];
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(parsed.entries)) {
          return parsed.entries;
        }
      }
    } catch (_e) {
      // Try next candidate.
    }
  }
  return [];
}

function decodeBase64Url(s) {
  const norm = String(s).trim().replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function loadRecipe(spec) {
  if (typeof spec !== 'string' || spec.trim().length === 0) {
    fail('--recipe <file.json|base64> is required');
  }
  const trimmed = spec.trim();
  if (fs.existsSync(trimmed) && fs.statSync(trimmed).isFile()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(trimmed, 'utf8'));
      return unwrapRecipe(parsed);
    } catch (e) {
      fail('cannot parse recipe file ' + JSON.stringify(trimmed) + ': ' + e.message);
    }
  }
  const candidates = [];
  try {
    candidates.push(decodeBase64Url(trimmed));
  } catch (_e) {
    // Not base64; fall through to raw JSON below.
  }
  candidates.push(trimmed);
  for (const text of candidates) {
    try {
      return unwrapRecipe(JSON.parse(text));
    } catch (_e) {
      // Try next candidate.
    }
  }
  fail('--recipe is neither an existing JSON file, base64url JSON, nor inline JSON');
  return null;
}

function unwrapRecipe(parsed) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.recipe && typeof parsed.recipe === 'object') {
    return parsed.recipe;
  }
  return parsed;
}

function renderCompiled(compiled, harness) {
  switch (harness) {
    case 'opencode-v2':
      return JSON.stringify(compiled.opencodeV2, null, 2) + '\n';
    case 'opencode-v1':
      return JSON.stringify(compiled.opencodeV1, null, 2) + '\n';
    case 'opencode-md':
      return compiled.opencodeMarkdown;
    case 'claude-code':
      return JSON.stringify({
        mcpServers: compiled.claudeCodeMcp.mcpServers,
        agentMd: compiled.claudeCodeAgentMd
      }, null, 2) + '\n';
    case 'codex':
      return compiled.codexConfigToml;
    case 'pi':
      return JSON.stringify({
        settings: compiled.piSettingsJson,
        mcp: compiled.piMcpJson,
        agentsMd: compiled.piAgentsMd
      }, null, 2) + '\n';
    case 'gemini-cli':
      return JSON.stringify({
        settings: compiled.geminiSettingsJson,
        geminiMd: compiled.geminiMd
      }, null, 2) + '\n';
    case 'cursor':
      return JSON.stringify({
        mcp: compiled.cursorMcpJson,
        ruleMdc: compiled.cursorRuleMdc
      }, null, 2) + '\n';
    case 'windsurf':
      return JSON.stringify({
        mcp: compiled.windsurfMcpJson,
        windsurfRules: compiled.windsurfRules
      }, null, 2) + '\n';
    case 'copilot':
      return JSON.stringify({
        vscodeMcp: compiled.vscodeMcpJson,
        copilotInstructionsMd: compiled.copilotInstructionsMd
      }, null, 2) + '\n';
    default:
      fail('unknown harness ' + JSON.stringify(harness) + ' (expected one of ' + VALID_HARNESSES.join('|') + ')');
      return '';
  }
}

function cmdCompile(argv) {
  let recipeSpec = null;
  let harness = 'opencode-v2';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--recipe' || a.startsWith('--recipe=')) {
      recipeSpec = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
    } else if (a === '--harness' || a.startsWith('--harness=')) {
      harness = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
    } else {
      fail('compile: unknown argument ' + JSON.stringify(a) + ' (see --help)');
    }
  }
  if (!recipeSpec) {
    fail('compile: --recipe <file.json> is required');
  }
  if (!VALID_HARNESSES.includes(harness)) {
    fail('compile: unknown harness ' + JSON.stringify(harness) + ' (expected one of ' + VALID_HARNESSES.join('|') + ')');
  }
  const recipe = loadRecipe(recipeSpec);
  const compiler = require('../src/core/compiler');
  let compiled;
  try {
    compiled = compiler.compileAgentRecipe(recipe, loadRegistryEntries());
  } catch (e) {
    fail('compile: ' + e.message);
  }
  process.stdout.write(renderCompiled(compiled, harness));
}

function cmdInstall(argv) {
  let recipeSpec = null;
  let targetDir = '.';
  let harness = 'opencode-v2';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--recipe' || a.startsWith('--recipe=')) {
      recipeSpec = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
    } else if (a === '--target-dir' || a.startsWith('--target-dir=')) {
      targetDir = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
    } else if (a === '--harness' || a.startsWith('--harness=')) {
      harness = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i];
    } else if (a === '--dry-run') {
      dryRun = true;
    } else {
      fail('install: unknown argument ' + JSON.stringify(a) + ' (see --help)');
    }
  }
  if (!recipeSpec) {
    fail('install: --recipe <file.json|base64> is required');
  }
  if (!VALID_HARNESSES.includes(harness)) {
    fail('install: unknown harness ' + JSON.stringify(harness) + ' (expected one of ' + VALID_HARNESSES.join('|') + ')');
  }
  const recipe = loadRecipe(recipeSpec);
  const compiler = require('../src/core/compiler');
  let compiled;
  try {
    compiled = compiler.compileAgentRecipe(recipe, loadRegistryEntries());
  } catch (e) {
    fail('install: ' + e.message);
  }
  const root = path.resolve(targetDir);
  for (const file of compiled.bundleFiles) {
    if (path.isAbsolute(file.path) || file.path.split(/[\\/]/).includes('..')) {
      fail('install: refusing unsafe bundle path ' + JSON.stringify(file.path));
    }
    const dest = path.resolve(root, file.path);
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      fail('install: path traversal blocked for ' + JSON.stringify(file.path));
    }
  }
  if (dryRun) {
    console.log(`DRY_RUN install ${compiled.slug} -> ${root} [${harness}]`);
    for (const file of compiled.bundleFiles) {
      console.log('  would write: ' + file.path);
    }
    return;
  }
  for (const file of compiled.bundleFiles) {
    const dest = path.resolve(root, file.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.content, 'utf8');
  }
  console.log(`INSTALL_OK ${compiled.slug}: wrote ${compiled.bundleFiles.length} files -> ${root} [${harness}]`);
}

function cmdMcp() {
  const serverFile = path.join(__dirname, '..', 'src', 'mcp', 'server.js');
  if (!fs.existsSync(serverFile)) {
    console.error('ERROR: MCP server not yet implemented (Milestone 9): src/mcp/server.js missing');
    process.exit(1);
  }
  try {
    execFileSync(process.execPath, [serverFile], { stdio: 'inherit' });
  } catch (e) {
    process.exit(typeof e.status === 'number' ? e.status : 1);
  }
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    printUsage();
    process.exit(0);
  }
  const cmd = argv[0];
  const rest = argv.slice(1);
  if (rest.includes('--help') || rest.includes('-h')) {
    printUsage();
    process.exit(0);
  }
  if (cmd === 'serve') {
    const { port, host, allowLoopbackLlm } = parseServeArgs(rest);
    const { startLocalServer } = require('../src/server/local-server');
    startLocalServer({ port, host, allowLoopbackLlm }).then((server) => {
      const addr = server.address();
      const where = addr && typeof addr === 'object' ? `http://${addr.address}:${addr.port}` : `http://${host}:${port}`;
      console.log(`AGENT_BUILDER_SERVE ${where}`);
    }).catch((e) => {
      fail('serve: ' + e.message);
    });
    return;
  }
  if (cmd === 'compile') {
    cmdCompile(rest);
    return;
  }
  if (cmd === 'install') {
    cmdInstall(rest);
    return;
  }
  if (cmd === 'mcp') {
    cmdMcp();
    return;
  }
  console.error('ERROR: unknown command ' + JSON.stringify(cmd) + ' (expected serve|compile|install|mcp; see --help)');
  process.exit(1);
}

main();
