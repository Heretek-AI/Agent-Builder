#!/usr/bin/env node
// src/mcp/server.js
// Stdio JSON-RPC 2.0 MCP server for @heretek-ai/agent-builder (CommonJS,
// zero-dependency: `readline` over `process.stdin` / `process.stdout`).
//
// Protocol: line-delimited JSON (one JSON-RPC 2.0 message per line; NOT
// Content-Length framed). `protocolVersion: "2024-11-05"`.
//
// Exposes 4 tools:
//   search_registry      search dist/registry.json by query/kind/category/
//                        harness/language/platform
//   get_entry_details    full registry record + bundled markdown for an id
//   compile_agent_config compile { name, description, harness, model, prompt,
//                        skills, mcp, plugins } with deny-first scoping rules
//   install_agent_bundle dry-run (default) or write the compiled bundle into
//                        a workspace directory (path-traversal validated)
//
// Fail-closed: malformed JSON -> -32700, bad envelopes -> -32600, unknown
// methods -> -32601, bad tool args -> -32602. Never logs secrets.

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = '@heretek-ai/agent-builder';
const ROOT_DIR = path.join(__dirname, '..', '..');

function loadVersion() {
  try {
    const pkg = require('../../package.json');
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch (_e) {
    return '0.0.0';
  }
}

function loadRegistryEntries() {
  const candidates = [
    path.join(ROOT_DIR, 'dist', 'registry.json'),
    path.join(ROOT_DIR, '_site', 'registry.json')
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) {
        continue;
      }
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed.entries)) {
        return parsed.entries;
      }
    } catch (_e) {
      // Try next candidate / fallback.
    }
  }
  try {
    const catalog = require('../../scripts/utils/catalog');
    if (catalog && typeof catalog.loadCatalog === 'function') {
      const out = catalog.loadCatalog(ROOT_DIR);
      if (out && Array.isArray(out.entries)) {
        return out.entries;
      }
    }
  } catch (_e) {
    // Fall through to empty list.
  }
  return [];
}

const VERSION = loadVersion();
const ENTRIES = loadRegistryEntries();
const compiler = require('../core/compiler');

const TOOL_DEFS = [
  {
    name: 'search_registry',
    description: 'Search the Agent-Builder registry (dist/registry.json) by free-text query and exact kind/category/harness/language/platform filters.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive substring matched against id, name, tagline, and description.' },
        kind: { type: 'string', description: 'Exact kind match (plugin|skill|mcp-server|design-md|prompt|agent|agent-preset).' },
        category: { type: 'string', description: 'Exact category id match (e.g. skills/coding/rust).' },
        harness: { type: 'string', description: 'Exact harness id match against the entry harnesses array (e.g. opencode).' },
        language: { type: 'string', description: 'Exact language match against the entry languages array (e.g. rust).' },
        platform: { type: 'string', description: 'Exact platform match against the entry platforms array.' },
        limit: { type: 'integer', description: 'Max entries to return (1-200, default 50).', minimum: 1, maximum: 200 }
      },
      additionalProperties: false
    }
  },
  {
    name: 'get_entry_details',
    description: 'Return the full registry record plus bundled markdown (SKILL.md / DESIGN.md / prompt body) for an entry id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Exact registry entry id.' }
      },
      required: ['id'],
      additionalProperties: false
    }
  },
  {
    name: 'compile_agent_config',
    description: 'Compile an agent recipe { name, description, harness, model, prompt, skills, mcp, plugins } into OpenCode v2/v1/Markdown, Claude Code, and Codex configs with deny-first scoping rules.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent slug (required, non-empty).' },
        description: { type: 'string', description: 'Agent description.' },
        harness: { type: 'string', description: 'Target harness label echoed back (default opencode-v2).' },
        model: { type: 'string', description: 'Model id (e.g. anthropic/claude-sonnet-4-5).' },
        prompt: { type: 'string', description: 'System prompt body.' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Allowed skill ids.' },
        mcp: {
          type: 'array',
          description: 'MCP selections: [{ server, tools?, deniedTools?, allowResources? }] or server-name strings.',
          items: {}
        },
        plugins: { type: 'array', items: { type: 'string' }, description: 'Plugin/design ids (merged into skill allows).' }
      },
      required: ['name'],
      additionalProperties: false
    }
  },
  {
    name: 'install_agent_bundle',
    description: 'Dry-run (default) or write the compiled agent configuration and skill files into a workspace directory. Writes are path-traversal validated.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent slug (required, non-empty).' },
        description: { type: 'string', description: 'Agent description.' },
        harness: { type: 'string', description: 'Harness label echoed back (default opencode-v2).' },
        model: { type: 'string', description: 'Model id.' },
        prompt: { type: 'string', description: 'System prompt body.' },
        skills: { type: 'array', items: { type: 'string' }, description: 'Allowed skill ids.' },
        mcp: {
          type: 'array',
          description: 'MCP selections: [{ server, tools?, deniedTools?, allowResources? }] or server-name strings.',
          items: {}
        },
        plugins: { type: 'array', items: { type: 'string' }, description: 'Plugin/design ids (merged into skill allows).' },
        targetDir: { type: 'string', description: 'Workspace directory to write into (default ".").' },
        dryRun: { type: 'boolean', description: 'When true (default) only return the install plan; when false, write files.' }
      },
      required: ['name'],
      additionalProperties: false
    }
  }
];

function invalidParams(message) {
  const err = new Error(String(message));
  err.code = -32602;
  throw err;
}

function assertArgsObject(args, tool) {
  if (args === undefined) {
    return {};
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    invalidParams(tool + ': arguments must be an object');
  }
  return args;
}

function assertOptionalString(args, field, tool) {
  if (args[field] === undefined) {
    return undefined;
  }
  if (typeof args[field] !== 'string') {
    invalidParams(tool + ': field "' + field + '" must be a string');
  }
  return args[field];
}

function assertOptionalStringArray(args, field, tool) {
  if (args[field] === undefined) {
    return undefined;
  }
  if (!Array.isArray(args[field]) || !args[field].every((v) => typeof v === 'string')) {
    invalidParams(tool + ': field "' + field + '" must be an array of strings');
  }
  return args[field].slice();
}

function searchRegistry(rawArgs) {
  const args = assertArgsObject(rawArgs, 'search_registry');
  const query = assertOptionalString(args, 'query', 'search_registry');
  const kind = assertOptionalString(args, 'kind', 'search_registry');
  const category = assertOptionalString(args, 'category', 'search_registry');
  const harness = assertOptionalString(args, 'harness', 'search_registry');
  const language = assertOptionalString(args, 'language', 'search_registry');
  const platform = assertOptionalString(args, 'platform', 'search_registry');
  let limit = 50;
  if (args.limit !== undefined) {
    if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 200) {
      invalidParams('search_registry: field "limit" must be an integer 1-200');
    }
    limit = args.limit;
  }
  const q = query !== undefined ? query.toLowerCase() : null;
  const filtered = ENTRIES.filter((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false;
    }
    if (q !== null && q.length > 0) {
      const haystack = [entry.id, entry.name, entry.tagline, entry.description]
        .filter((v) => typeof v === 'string')
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) {
        return false;
      }
    }
    if (kind !== undefined && entry.kind !== kind) {
      return false;
    }
    if (category !== undefined && entry.category !== category) {
      return false;
    }
    if (harness !== undefined && !(Array.isArray(entry.harnesses) && entry.harnesses.includes(harness))) {
      return false;
    }
    if (language !== undefined && !(Array.isArray(entry.languages) && entry.languages.includes(language))) {
      return false;
    }
    if (platform !== undefined && !(Array.isArray(entry.platforms) && entry.platforms.includes(platform))) {
      return false;
    }
    return true;
  });
  return {
    count: Math.min(filtered.length, limit),
    total: ENTRIES.length,
    entries: filtered.slice(0, limit)
  };
}

function isSafeContentFileRef(cf) {
  if (typeof cf !== 'string' || cf.length === 0) {
    return false;
  }
  if (path.isAbsolute(cf)) {
    return false;
  }
  if (cf.startsWith('/') || cf.startsWith('\\')) {
    return false;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cf)) {
    return false; // URL scheme (http:, https:, file:, data:, ...).
  }
  if (cf.includes('..')) {
    return false;
  }
  if (!cf.endsWith('.md')) {
    return false;
  }
  if (!/^[A-Za-z0-9_]/.test(cf)) {
    return false;
  }
  if (!/^(?!\/)(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9_./-]*\.md$/.test(cf)) {
    return false;
  }
  const abs = path.resolve(ROOT_DIR, cf);
  if (abs !== ROOT_DIR && !abs.startsWith(ROOT_DIR + path.sep)) {
    return false;
  }
  return true;
}

function readBundledContent(entry) {
  const candidates = [];
  if (typeof entry.content_file === 'string' && entry.content_file.length > 0) {
    if (isSafeContentFileRef(entry.content_file)) {
      candidates.push({
        abs: path.resolve(ROOT_DIR, entry.content_file),
        rel: entry.content_file
      });
    }
    // Unsafe content_file refs are fail-closed: skipped entirely (null
    // unless a dist/_site fallback exists). Never resolve absolute,
    // traversal, URL, or non-.md refs against the host filesystem.
  }
  candidates.push({
    abs: path.join(ROOT_DIR, 'dist', 'content', entry.id + '.md'),
    rel: path.join('dist', 'content', entry.id + '.md')
  });
  candidates.push({
    abs: path.join(ROOT_DIR, '_site', 'content', entry.id + '.md'),
    rel: path.join('_site', 'content', entry.id + '.md')
  });
  for (const cand of candidates) {
    try {
      if (fs.existsSync(cand.abs) && fs.statSync(cand.abs).isFile()) {
        return { content: fs.readFileSync(cand.abs, 'utf8'), content_path: cand.rel };
      }
    } catch (_e) {
      // Try next candidate.
    }
  }
  return { content: null, content_path: null };
}

function getEntryDetails(rawArgs) {
  const args = assertArgsObject(rawArgs, 'get_entry_details');
  if (typeof args.id !== 'string' || args.id.trim().length === 0) {
    invalidParams('get_entry_details: field "id" must be a non-empty string');
  }
  const found = ENTRIES.find((e) => e && e.id === args.id.trim());
  if (!found) {
    invalidParams('get_entry_details: unknown entry id ' + JSON.stringify(args.id));
  }
  const bundled = readBundledContent(found);
  return {
    entry: found,
    content: bundled.content,
    content_path: bundled.content_path
  };
}

function buildRecipe(rawArgs, tool) {
  const args = assertArgsObject(rawArgs, tool);
  const nameRaw = args.name !== undefined ? args.name : args.slug;
  if (typeof nameRaw !== 'string' || nameRaw.trim().length === 0) {
    invalidParams(tool + ': field "name" must be a non-empty string');
  }
  const description = assertOptionalString(args, 'description', tool);
  const harness = assertOptionalString(args, 'harness', tool);
  const model = assertOptionalString(args, 'model', tool);
  const prompt = assertOptionalString(args, 'prompt', tool);
  const skills = assertOptionalStringArray(args, 'skills', tool);
  const plugins = assertOptionalStringArray(args, 'plugins', tool);
  let mcp = [];
  if (args.mcp !== undefined) {
    if (!Array.isArray(args.mcp)) {
      invalidParams(tool + ': field "mcp" must be an array');
    }
    mcp = args.mcp.slice();
  }
  const recipe = {
    slug: nameRaw.trim(),
    description: description === undefined ? '' : description,
    prompt: prompt === undefined ? '' : prompt,
    skills: (skills || []).concat(plugins || []),
    mcpSelections: mcp
  };
  if (model !== undefined) {
    recipe.model = model;
  }
  return { recipe, harness: harness === undefined ? 'opencode-v2' : harness };
}

function compileAgentConfig(rawArgs) {
  const built = buildRecipe(rawArgs, 'compile_agent_config');
  let compiled;
  try {
    compiled = compiler.compileAgentRecipe(built.recipe, ENTRIES);
  } catch (e) {
    invalidParams('compile_agent_config: ' + e.message);
  }
  return {
    slug: compiled.slug,
    harness: built.harness,
    opencodeV2: compiled.opencodeV2,
    opencodeV1: compiled.opencodeV1,
    opencodeMarkdown: compiled.opencodeMarkdown,
    claudeCodeMcp: compiled.claudeCodeMcp,
    claudeCodeAgentMd: compiled.claudeCodeAgentMd,
    codexConfigToml: compiled.codexConfigToml,
    bundleFiles: compiled.bundleFiles
  };
}

function isSafeRelPath(rel) {
  if (typeof rel !== 'string' || rel.length === 0) {
    return false;
  }
  if (path.isAbsolute(rel)) {
    return false;
  }
  return !rel.split(/[\\/]/).includes('..');
}

function installAgentBundle(rawArgs) {
  const args = assertArgsObject(rawArgs, 'install_agent_bundle');
  const built = buildRecipe(args, 'install_agent_bundle');
  let targetDir = '.';
  if (args.targetDir !== undefined) {
    if (typeof args.targetDir !== 'string' || args.targetDir.trim().length === 0) {
      invalidParams('install_agent_bundle: field "targetDir" must be a non-empty string');
    }
    targetDir = args.targetDir;
  }
  let dryRun = true;
  if (args.dryRun !== undefined) {
    if (typeof args.dryRun !== 'boolean') {
      invalidParams('install_agent_bundle: field "dryRun" must be a boolean');
    }
    dryRun = args.dryRun;
  }
  let compiled;
  try {
    compiled = compiler.compileAgentRecipe(built.recipe, ENTRIES);
  } catch (e) {
    invalidParams('install_agent_bundle: ' + e.message);
  }
  const root = path.resolve(targetDir);
  for (const file of compiled.bundleFiles) {
    if (!isSafeRelPath(file.path)) {
      invalidParams('install_agent_bundle: refusing unsafe bundle path ' + JSON.stringify(file.path));
    }
    const dest = path.resolve(root, file.path);
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      invalidParams('install_agent_bundle: path traversal blocked for ' + JSON.stringify(file.path));
    }
  }
  if (dryRun) {
    return {
      slug: compiled.slug,
      harness: built.harness,
      dryRun: true,
      targetDir: root,
      files: compiled.bundleFiles.map((f) => ({
        path: f.path,
        bytes: Buffer.byteLength(f.content, 'utf8')
      }))
    };
  }
  const written = [];
  for (const file of compiled.bundleFiles) {
    const dest = path.resolve(root, file.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.content, 'utf8');
    written.push(path.relative(root, dest));
  }
  return {
    slug: compiled.slug,
    harness: built.harness,
    dryRun: false,
    targetDir: root,
    written
  };
}

function success(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function failure(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message: String(message) } };
}

function handleMessage(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return failure(null, -32600, 'Invalid request: message must be an object');
  }
  const hasId = msg.id !== undefined;
  const id = hasId ? msg.id : null;
  if (typeof msg.method !== 'string') {
    if (!hasId) {
      return null;
    }
    return failure(id, -32600, 'Invalid request: missing method');
  }
  const method = msg.method;

  if (!hasId) {
    // Notifications never receive a response.
    return null;
  }

  if (method === 'initialize') {
    return success(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: VERSION }
    });
  }
  if (method === 'tools/list') {
    return success(id, { tools: TOOL_DEFS });
  }
  if (method === 'tools/call') {
    const params = msg.params;
    if (params === null || typeof params !== 'object' || Array.isArray(params)) {
      return failure(id, -32602, 'Invalid params: tools/call params must be an object with { name, arguments? }');
    }
    if (typeof params.name !== 'string') {
      return failure(id, -32602, 'Invalid params: tools/call requires a string "name"');
    }
    const toolArgs = params.arguments === undefined ? {} : params.arguments;
    let result;
    try {
      switch (params.name) {
        case 'search_registry':
          result = searchRegistry(toolArgs);
          break;
        case 'get_entry_details':
          result = getEntryDetails(toolArgs);
          break;
        case 'compile_agent_config':
          result = compileAgentConfig(toolArgs);
          break;
        case 'install_agent_bundle':
          result = installAgentBundle(toolArgs);
          break;
        default:
          return failure(id, -32602, 'Invalid params: unknown tool ' + JSON.stringify(params.name));
      }
    } catch (e) {
      if (e && e.code === -32602) {
        return failure(id, -32602, 'Invalid params: ' + e.message);
      }
      return failure(id, -32603, 'Internal error: ' + (e && e.message ? e.message : String(e)));
    }
    return success(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
  }
  if (method === 'ping') {
    return success(id, {});
  }
  return failure(id, -32601, 'Method not found: ' + method);
}

function main() {
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    if (line.trim().length === 0) {
      return;
    }
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (_e) {
      process.stdout.write(JSON.stringify(failure(null, -32700, 'Parse error: invalid JSON')) + '\n');
      return;
    }
    let res;
    try {
      res = handleMessage(msg);
    } catch (e) {
      const id = msg && msg.id !== undefined ? msg.id : null;
      res = failure(id, -32603, 'Internal error: ' + (e && e.message ? e.message : String(e)));
    }
    if (res) {
      process.stdout.write(JSON.stringify(res) + '\n');
    }
  });
}

if (require.main === module) {
  main();
}

module.exports = {
  PROTOCOL_VERSION,
  SERVER_NAME,
  TOOL_DEFS,
  searchRegistry,
  getEntryDetails,
  compileAgentConfig,
  installAgentBundle,
  handleMessage,
  readBundledContent,
  isSafeContentFileRef
};
