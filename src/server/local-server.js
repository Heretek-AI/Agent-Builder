// src/server/local-server.js
// Local bridge HTTP server for `agent-builder serve` (CommonJS).
//
// Serves the WebUI (`_site/` when built, else `site/`) and `registry.json`
// (`_site/registry.json`, falling back to `dist/registry.json`), and exposes:
//   GET  /api/status          -> { mode: "local-cli", version, mcpBridge: true }
//   POST /api/llm/chat        -> CORS-free proxy to an OpenAI-compatible
//                                /v1/chat/completions endpoint (apiKey redacted).
//   POST /api/mcp/introspect  -> spawns a local stdio MCP server command with
//                                a strict argv array (no shell), runs
//                                initialize -> tools/list -> resources/list
//                                with a 5s timeout, returns live tool names.
//   POST /api/install         -> compiles an AgentRecipe and writes the
//                                workspace bundle into targetDir after
//                                path-traversal validation.
//
// Fail-closed: malformed JSON, missing fields, path escapes, and upstream
// errors all return 4xx/5xx JSON errors. Never logs secrets.

'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const dns = require('dns');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MCP_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

// Fail-closed allowlist for /api/mcp/introspect (AB-5.6-introspect-rce).
// Compared by exact bare name only; never spawn a path.
const MCP_COMMAND_ALLOWLIST = new Set(['npx', 'node', 'python3']);

function loadVersion() {
  try {
    const pkg = require('../../package.json');
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch (_e) {
    return '0.0.0';
  }
}

function loadRegistryEntries(rootDir) {
  const candidates = [
    path.join(rootDir, 'dist', 'registry.json'),
    path.join(rootDir, '_site', 'registry.json')
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
      // Fall through to next candidate / empty list.
    }
  }
  return [];
}

function resolveStaticRoot(rootDir) {
  const site = path.join(rootDir, '_site');
  if (fs.existsSync(path.join(site, 'index.html'))) {
    return site;
  }
  return path.join(rootDir, 'site');
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.md': return 'text/markdown; charset=utf-8';
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

function isLoopbackOrigin(origin) {
  try {
    const u = new URL(String(origin));
    const h = u.hostname.toLowerCase();
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
  } catch (_e) {
    return false;
  }
}

// Fail-closed CORS: never emit `Access-Control-Allow-Origin: *`.
// Only echo loopback origins (same-machine WebUI); all other callers get
// no CORS headers, so arbitrary websites cannot read /api/* responses.
function setCors(res, req) {
  const origin = req && req.headers ? req.headers.origin : undefined;
  if (typeof origin === 'string' && isLoopbackOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-ab-token');
  }
  // Non-loopback / no-Origin: send no CORS headers (no wildcard).
}

function sendJson(res, statusCode, obj, req) {
  setCors(res, req);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj) + '\n');
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim().length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('invalid JSON body: ' + e.message));
      }
    });
    req.on('error', reject);
  });
}

function resolveChatUrl(baseUrl) {
  const trimmed = String(baseUrl).replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(trimmed)) {
    return trimmed;
  }
  if (/\/v1$/.test(trimmed)) {
    return trimmed + '/chat/completions';
  }
  return trimmed + '/v1/chat/completions';
}

function isIPv4Literal(host) {
  const parts = String(host).split('.');
  if (parts.length !== 4) {
    return false;
  }
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isLoopbackLiteral(host) {
  const h = String(host).toLowerCase();
  if (h === 'localhost') {
    return true;
  }
  if (h === '::1' || h === '[::1]' || h === '::' || h === '[::]') {
    return true;
  }
  if (h === '0.0.0.0') {
    return true;
  }
  if (isIPv4Literal(h)) {
    return Number(h.split('.')[0]) === 127;
  }
  return false;
}

function isPrivateOrReservedLiteral(host) {
  let h = String(host).toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1);
  }
  // Fail-closed: block localhost names (allowed only via
  // --allow-loopback-llm when isLoopbackLiteral also agrees).
  if (h === 'localhost' || h.endsWith('.localhost')) {
    return true;
  }
  if (h === '::1' || h === '::' || h === '0.0.0.0') {
    return true;
  }
  if (h.includes(':')) {
    // IPv4-mapped IPv6 ::ffff:<hex>:<hex> (WHATWG URL normalizes
    // [::ffff:127.0.0.1] to [::ffff:7f00:1]): classify by embedded IPv4.
    const mapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      h = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
      // Fall through to the IPv4 checks below with the embedded address.
    } else if (h.startsWith('::ffff:')) {
      return true; // Fail closed on unrecognized ::ffff: forms.
    } else {
      // Any other IPv6 literal: treat link-local/unique-local/loopback as
      // blocked. Fail-closed: block fe80::/10, fc00::/7, ::1.
      if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fec0:')) {
        return true;
      }
      if (h.startsWith('fc') || h.startsWith('fd')) {
        return true;
      }
      return false;
    }
  }
  if (!isIPv4Literal(h)) {
    return false;
  }
  const o = h.split('.').map(Number);
  if (o[0] === 10) {
    return true; // 10/8
  }
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) {
    return true; // 172.16/12
  }
  if (o[0] === 192 && o[1] === 168) {
    return true; // 192.168/16
  }
  if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) {
    return true; // 100.64/10 shared address space
  }
  if (o[0] === 169 && o[1] === 254) {
    return true; // 169.254/16
  }
  if (o[0] === 127) {
    return true; // 127/8
  }
  if (o[0] === 0 && o[1] === 0 && o[2] === 0 && o[3] === 0) {
    return true; // 0.0.0.0
  }
  return false;
}

// Fail-closed SSRF gate (AB-5.5-ssrf-private-range). Throws
// `baseUrl target not permitted` for userinfo, literal private ranges,
// loopback (unless explicitly allowed), and non-http(s) targets.
// NOTE: upstream fetch uses raw http/https request with no redirect
// following (redirect mode: manual — 3xx responses are relayed, never
// followed), so a 302 can never escape this gate.
function assertBaseUrlPermitted(target, options) {
  const opts = options || {};
  const allowLoopback = opts.allowLoopbackLlm === true;
  if (target.username || target.password) {
    throw new Error('baseUrl target not permitted (userinfo not allowed)');
  }
  const host = target.hostname || '';
  if (!host) {
    throw new Error('baseUrl target not permitted (empty host)');
  }
  if (isPrivateOrReservedLiteral(host)) {
    if (allowLoopback && isLoopbackLiteral(host)) {
      return; // --allow-loopback-llm permits loopback only, not RFC1918.
    }
    throw new Error('baseUrl target not permitted');
  }
}

function isIpLiteralHost(host) {
  let h = String(host).toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1);
  }
  if (h.includes(':')) {
    return true; // IPv6 literal (including ::ffff: mapped forms).
  }
  if (isIPv4Literal(h)) {
    return true;
  }
  return false;
}

function stripBrackets(host) {
  const h = String(host);
  if (h.startsWith('[') && h.endsWith(']')) {
    return h.slice(1, -1);
  }
  return h;
}

function lookupHost(hostname) {
  return new Promise((resolve, reject) => {
    // No shell: hostname comes from the parsed URL object via argv-free lookup.
    dns.lookup(hostname, (err, address) => {
      if (err) {
        reject(err);
      } else {
        resolve(address);
      }
    });
  });
}

function proxyLlmChat(body, options) {
  return new Promise((resolve, reject) => {
    (async () => {
      let baseUrl = body.baseUrl;
      const model = body.model;
      const messages = body.messages;
      if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
        throw new Error('field "baseUrl" must be a non-empty string');
      }
      if (typeof model !== 'string' || model.trim().length === 0) {
        throw new Error('field "model" must be a non-empty string');
      }
      if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('field "messages" must be a non-empty array');
      }
      if (!/^https?:\/\//i.test(baseUrl.trim())) {
        throw new Error('field "baseUrl" must be an http(s) URL');
      }
      baseUrl = baseUrl.trim();
      let target;
      try {
        target = new URL(resolveChatUrl(baseUrl));
      } catch (e) {
        throw new Error('field "baseUrl" is not a valid URL: ' + e.message);
      }
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error('field "baseUrl" must use http or https');
      }
      try {
        assertBaseUrlPermitted(target, options);
      } catch (e) {
        throw e;
      }
      // Fail-closed: never send a bearer API key over cleartext HTTP to a
      // non-loopback target (passive network observer would capture it).
      // Credentialed loopback HTTP (isLoopbackLiteral) stays permitted.
      const hasApiKey = typeof body.apiKey === 'string' && body.apiKey.length > 0;
      if (hasApiKey && target.protocol === 'http:' && !isLoopbackLiteral(target.hostname)) {
        throw new Error('baseUrl target not permitted (API key requires HTTPS)');
      }
      // Fail-closed DNS vetting: hostnames that are not IP literals are
      // resolved with dns.lookup and the resolved address is re-checked with
      // the same literal gate; the connection then uses the vetted address
      // (original host preserved via Host header / SNI).
      const opts = options || {};
      const allowLoopback = opts.allowLoopbackLlm === true;
      let connectHostname = stripBrackets(target.hostname);
      let servername;
      let hostHeader;
      if (!isIpLiteralHost(target.hostname)) {
        let address;
        try {
          address = await lookupHost(target.hostname);
        } catch (_e) {
          throw new Error('baseUrl target not permitted (DNS lookup failed)');
        }
        if (isPrivateOrReservedLiteral(address)) {
          if (!(allowLoopback && isLoopbackLiteral(address))) {
            throw new Error('baseUrl target not permitted');
          }
        }
        connectHostname = stripBrackets(address);
        // Preserve virtual-host routing and TLS SNI for the original name.
        hostHeader = target.host;
        if (target.protocol === 'https:') {
          servername = target.hostname;
        }
      }
      const payload = JSON.stringify({
        model: model.trim(),
        messages,
        temperature: body.temperature !== undefined ? body.temperature : undefined,
        max_tokens: body.max_tokens !== undefined ? body.max_tokens : undefined,
        stream: false
      });
      const lib = target.protocol === 'https:' ? https : http;
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      };
      if (hostHeader) {
        headers.Host = hostHeader;
      }
      if (hasApiKey) {
        headers.Authorization = 'Bearer ' + body.apiKey;
      }
      const requestOptions = {
        hostname: connectHostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: target.pathname + (target.search || ''),
        method: 'POST',
        headers,
        timeout: 60000
      };
      if (servername) {
        requestOptions.servername = servername;
      }
      await new Promise((res, rej) => {
        const upstream = lib.request(requestOptions, (upRes) => {
          const chunks = [];
          upRes.on('data', (c) => chunks.push(c));
          upRes.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            let parsed;
            try {
              parsed = JSON.parse(text);
            } catch (_e) {
              parsed = { raw: text };
            }
            resolve({ status: upRes.statusCode || 502, body: parsed });
            res();
          });
        });
        upstream.on('timeout', () => {
          upstream.destroy(new Error('upstream LLM request timed out'));
        });
        upstream.on('error', (err) => {
          rej(err);
        });
        upstream.end(payload);
      });
    })().catch(reject);
  });
}

// Spawns `command` with a strict argv array (no shell), performs the MCP
// stdio handshake (initialize -> notifications/initialized -> tools/list ->
// resources/list) with a 5-second timeout, and returns discovered tools.
function introspectMcpServer(body) {
  return new Promise((resolve, reject) => {
    const command = body.command;
    const args = body.args === undefined ? [] : body.args;
    if (typeof command !== 'string' || command.trim().length === 0) {
      reject(new Error('field "command" must be a non-empty string'));
      return;
    }
    if (!Array.isArray(args) || !args.every((a) => typeof a === 'string')) {
      reject(new Error('field "args" must be an array of strings'));
      return;
    }
    if (body.env !== undefined && (body.env === null || typeof body.env !== 'object' || Array.isArray(body.env))) {
      reject(new Error('field "env" must be an object of string values when provided'));
      return;
    }
    let env = process.env;
    if (body.env !== undefined) {
      const extra = {};
      // Fail-closed: loader / interpreter-search keys must never come from
      // the caller (they would let an allowlisted binary load attacker code).
      const BLOCKED_ENV_KEYS = new Set([
        'NODE_OPTIONS',
        'NODE_PATH',
        'PYTHONPATH',
        'PYTHONSTARTUP',
        'PYTHONHOME',
        'LD_PRELOAD',
        'LD_LIBRARY_PATH',
        'PATH'
      ]);
      for (const key of Object.keys(body.env)) {
        if (typeof body.env[key] !== 'string') {
          reject(new Error('field "env" values must be strings'));
          return;
        }
        if (BLOCKED_ENV_KEYS.has(key)) {
          reject(new Error('introspect env not allowed: ' + key));
          return;
        }
        extra[key] = body.env[key];
      }
      env = Object.assign({}, process.env, extra);
    }
    let child;
    try {
      // Fail-closed allowlist (AB-5.6-introspect-rce): exact bare-name match
      // only (npx/node/python3). Never basename-compare or spawn a path: an
      // attacker path such as /tmp/x/node must not resolve via PATH.
      // Array argv only; never a shell string (no interpolation, no shell flag).
      const trimmed = command.trim();
      if (!MCP_COMMAND_ALLOWLIST.has(trimmed)) {
        throw new Error('command not allowlisted');
      }
      // Fail-closed: reject interpreter-evaluation flags that turn an
      // allowlisted binary into arbitrary code execution.
      const EVAL_FLAGS = new Set(['-e', '--eval', '-p', '--print', '-c', '-r', '--require', '--import', '--loader']);
      if (args.some((a) => EVAL_FLAGS.has(a) || /^--(eval|print|require|import|loader)=/.test(a))) {
        throw new Error('introspect args not allowed (eval/loader flag)');
      }
      // Spawn the validated bare name so PATH resolves it, not an attacker path.
      child = spawn(trimmed, args.slice(), { env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      reject(new Error('failed to spawn MCP server: ' + e.message));
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_e) {
        // Already exited.
      }
      reject(new Error('MCP introspection timed out after 5000ms'));
    }, MCP_TIMEOUT_MS);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error('failed to spawn MCP server: ' + err.message));
    });
    function send(obj) {
      return new Promise((res, rej) => {
        child.stdin.write(JSON.stringify(obj) + '\n', (err) => {
          if (err) {
            rej(err);
          } else {
            res();
          }
        });
      });
    }
    function collectResponse(id, timeoutMs) {
      return new Promise((res, rej) => {
        const deadline = Date.now() + timeoutMs;
        const iv = setInterval(() => {
          const lines = stdout.split('\n');
          for (const line of lines) {
            const t = line.trim();
            if (!t) {
              continue;
            }
            try {
              const msg = JSON.parse(t);
              if (msg && msg.id === id) {
                clearInterval(iv);
                res(msg);
                return;
              }
            } catch (_e) {
              // Partial line or log noise; keep waiting.
            }
          }
          if (Date.now() > deadline) {
            clearInterval(iv);
            rej(new Error('timed out waiting for MCP response id ' + id));
          }
        }, 25);
      });
    }
    (async () => {
      await send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'agent-builder-local-server', version: loadVersion() }
        }
      });
      const initRes = await collectResponse(1, 4000);
      if (initRes.error) {
        throw new Error('MCP initialize failed: ' + JSON.stringify(initRes.error));
      }
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      await send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      const toolsRes = await collectResponse(2, 4000);
      if (toolsRes.error) {
        throw new Error('MCP tools/list failed: ' + JSON.stringify(toolsRes.error));
      }
      await send({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
      let resourcesRes = null;
      try {
        resourcesRes = await collectResponse(3, 2000);
      } catch (_e) {
        resourcesRes = null; // resources/list is optional.
      }
      clearTimeout(timer);
      try {
        child.kill('SIGTERM');
      } catch (_e) {
        // Already exited.
      }
      const tools = (((toolsRes || {}).result || {}).tools || []).map((t) => (t && t.name ? String(t.name) : '')).filter(Boolean);
      const resources = resourcesRes && resourcesRes.result && Array.isArray(resourcesRes.result.resources)
        ? resourcesRes.result.resources
        : [];
      resolve({
        serverInfo: ((initRes || {}).result || {}).serverInfo || null,
        tools,
        resources,
        stderr: stderr.slice(0, 2000)
      });
    })().catch((err) => {
      clearTimeout(timer);
      try {
        child.kill('SIGKILL');
      } catch (_e) {
        // Already exited.
      }
      reject(err);
    });
  });
}

function isSafeRelPath(rel) {
  if (typeof rel !== 'string' || rel.length === 0) {
    return false;
  }
  if (path.isAbsolute(rel)) {
    return false;
  }
  const parts = rel.split(/[\\/]/);
  return !parts.includes('..') && !parts.some((p) => p.length === 0 && false);
}

// Compiles a recipe and writes every bundle file under targetDir.
// Throws fail-closed on path escapes or invalid recipes.
function installRecipeFiles(recipe, registryEntries, targetDir, harness) {
  const compiler = require('../core/compiler');
  const validHarnesses = ['opencode-v2', 'opencode-v1', 'opencode-md', 'claude-code', 'codex'];
  if (harness !== undefined && !validHarnesses.includes(harness)) {
    throw new Error('unknown harness ' + JSON.stringify(harness) + ' (expected one of ' + validHarnesses.join('|') + ')');
  }
  const root = path.resolve(targetDir || '.');
  const compiled = compiler.compileAgentRecipe(recipe, registryEntries);
  const written = [];
  for (const file of compiled.bundleFiles) {
    if (!isSafeRelPath(file.path)) {
      throw new Error('refusing to write unsafe bundle path: ' + JSON.stringify(file.path));
    }
    const dest = path.resolve(root, file.path);
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error('path traversal blocked for bundle file: ' + JSON.stringify(file.path));
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.content, 'utf8');
    written.push(path.relative(root, dest));
  }
  return { slug: compiled.slug, written };
}

// Fail-closed HTTP targetDir gate (AB-5.4-targetdir-unrestricted):
// rejects absolute paths and any `..` segment (raw or URL-decoded)
// before installRecipeFiles ever resolves them.
function assertHttpTargetDir(targetDir) {
  const s = String(targetDir);
  if (path.isAbsolute(s)) {
    throw new Error('targetDir must be a relative path (absolute paths not allowed over HTTP)');
  }
  let decoded = s;
  try {
    decoded = decodeURIComponent(s);
  } catch (_e) {
    // Keep raw value; invalid encoding is itself suspicious but the
    // raw `..`/absolute checks below still apply.
  }
  for (const v of [s, decoded]) {
    if (v.split(/[\\/]/).includes('..')) {
      throw new Error('targetDir must not contain ..');
    }
    if (path.isAbsolute(v)) {
      throw new Error('targetDir must be a relative path (absolute paths not allowed over HTTP)');
    }
  }
}

function getRequestToken(req) {
  try {
    if (req && req.headers && typeof req.headers['x-ab-token'] === 'string' && req.headers['x-ab-token'].length > 0) {
      return req.headers['x-ab-token'];
    }
  } catch (_e) {
    // Fall through to query param.
  }
  try {
    const u = new URL(req.url || '/', 'http://localhost');
    const t = u.searchParams.get('token');
    if (typeof t === 'string' && t.length > 0) {
      return t;
    }
  } catch (_e) {
    // No usable token.
  }
  return '';
}

function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Same-origin token bridge: inject the per-boot token as a meta tag when
// serving index.html so the WebUI can send it back via x-ab-token (or
// ?token=). getRequestToken contract unchanged. The token is only exposed
// to same-origin GETs of the served UI, never via CORS wildcard.
function injectAbToken(html, token) {
  const tag = '<meta name="ab-token" content="' + escapeHtmlAttr(token) + '">';
  if (String(html).includes('name="ab-token"')) {
    return String(html);
  }
  if (String(html).includes('</head>')) {
    return String(html).replace('</head>', '  ' + tag + '\n</head>');
  }
  if (String(html).includes('<head>')) {
    return String(html).replace('<head>', '<head>\n  ' + tag);
  }
  return tag + '\n' + String(html);
}

function serveStatic(reqUrl, staticRoot, res, req, bootToken) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(reqUrl, 'http://localhost').pathname);
  } catch (_e) {
    sendJson(res, 400, { error: 'malformed URL' }, req);
    return;
  }
  if (pathname === '/') {
    pathname = '/index.html';
  }
  // Serve dist/registry.json when the static root has no registry.json.
  if (pathname === '/registry.json' && !fs.existsSync(path.join(staticRoot, 'registry.json'))) {
    const fallback = path.join(path.dirname(staticRoot), 'dist', 'registry.json');
    if (fs.existsSync(fallback)) {
      setCors(res, req);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      fs.createReadStream(fallback).pipe(res);
      return;
    }
    sendJson(res, 404, { error: 'registry.json not found (run: npm run export)' }, req);
    return;
  }
  const rel = pathname.replace(/^\/+/, '');
  if (rel.includes('..') || path.isAbsolute(rel)) {
    sendJson(res, 403, { error: 'forbidden path' }, req);
    return;
  }
  const dest = path.resolve(staticRoot, rel);
  if (dest !== path.resolve(staticRoot) && !dest.startsWith(path.resolve(staticRoot) + path.sep)) {
    sendJson(res, 403, { error: 'forbidden path' }, req);
    return;
  }
  fs.stat(dest, (err, st) => {
    if (err || !st.isFile()) {
      sendJson(res, 404, { error: 'not found: ' + pathname }, req);
      return;
    }
    // Same-origin WebUI token bridge: inject bootToken into index.html so
    // same-origin callers of /api/llm/chat, /api/mcp/introspect, /api/install
    // can send it back as x-ab-token (fallback ?token=).
    if (pathname === '/index.html' && typeof bootToken === 'string' && bootToken.length > 0) {
      let html;
      try {
        html = fs.readFileSync(dest, 'utf8');
      } catch (_e) {
        sendJson(res, 500, { error: 'unable to read index.html' }, req);
        return;
      }
      const injected = injectAbToken(html, bootToken);
      setCors(res, req);
      const headers = { 'Content-Type': contentTypeFor(dest) };
      if ((req.method || 'GET').toUpperCase() === 'HEAD') {
        res.writeHead(200, headers);
        res.end();
        return;
      }
      res.writeHead(200, headers);
      res.end(injected);
      return;
    }
    setCors(res, req);
    if ((req.method || 'GET').toUpperCase() === 'HEAD') {
      res.writeHead(200, { 'Content-Type': contentTypeFor(dest) });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypeFor(dest) });
    fs.createReadStream(dest).pipe(res);
  });
}

function startLocalServer(options) {
  const opts = options || {};
  const port = opts.port !== undefined ? Number(opts.port) : 4173;
  const host = opts.host !== undefined ? String(opts.host) : '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('startLocalServer: port must be an integer 1-65535, got ' + JSON.stringify(opts.port));
  }
  const rootDir = opts.rootDir || path.join(__dirname, '..', '..');
  const staticRoot = opts.staticRoot || resolveStaticRoot(rootDir);
  const version = loadVersion();
  const allowLoopbackLlm = opts.allowLoopbackLlm === true;
  // Per-boot token (AB-5.6-introspect-rce): required on all /api/* POSTs.
  // Generated at server start, logged to stdout for local use, never sent
  // over CORS wildcard (wildcard removed above).
  const bootToken = crypto.randomUUID();
  try {
    console.log(`AGENT_BUILDER_LOCAL_TOKEN ${bootToken}`);
  } catch (_e) {
    // stdout unavailable; token still on server object.
  }

  const server = http.createServer((req, res) => {
    (async () => {
      const method = (req.method || 'GET').toUpperCase();
      let pathname;
      try {
        pathname = new URL(req.url || '/', 'http://localhost').pathname;
      } catch (_e) {
        sendJson(res, 400, { error: 'malformed URL' }, req);
        return;
      }
      if (method === 'OPTIONS') {
        setCors(res, req);
        res.writeHead(204);
        res.end();
        return;
      }
      if (method === 'GET' && pathname === '/api/status') {
        sendJson(res, 200, { mode: 'local-cli', version, mcpBridge: true }, req);
        return;
      }
      if (method === 'POST' && pathname === '/api/llm/chat') {
        if (getRequestToken(req) !== bootToken) {
          sendJson(res, 401, { error: 'missing or invalid token' }, req);
          return;
        }
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          sendJson(res, 400, { error: e.message }, req);
          return;
        }
        try {
          const out = await proxyLlmChat(body || {}, { allowLoopbackLlm });
          setCors(res, req);
          res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(out.body) + '\n');
        } catch (e) {
          sendJson(res, 400, { error: e.message }, req);
        }
        return;
      }
      if (method === 'POST' && pathname === '/api/mcp/introspect') {
        if (getRequestToken(req) !== bootToken) {
          sendJson(res, 401, { error: 'missing or invalid token' }, req);
          return;
        }
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          sendJson(res, 400, { error: e.message }, req);
          return;
        }
        try {
          const out = await introspectMcpServer(body || {});
          sendJson(res, 200, { ok: true, tools: out.tools, resources: out.resources, serverInfo: out.serverInfo }, req);
        } catch (e) {
          sendJson(res, 400, { error: e.message }, req);
        }
        return;
      }
      if (method === 'POST' && pathname === '/api/install') {
        if (getRequestToken(req) !== bootToken) {
          sendJson(res, 401, { error: 'missing or invalid token' }, req);
          return;
        }
        let body;
        try {
          body = await readJsonBody(req);
        } catch (e) {
          sendJson(res, 400, { error: e.message }, req);
          return;
        }
        try {
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new Error('body must be a JSON object with { recipe, targetDir?, harness? }');
          }
          if (!body.recipe || typeof body.recipe !== 'object') {
            throw new Error('field "recipe" must be an object');
          }
          const targetDir = body.targetDir === undefined ? '.' : String(body.targetDir);
          assertHttpTargetDir(targetDir);
          const entries = loadRegistryEntries(rootDir);
          const out = installRecipeFiles(body.recipe, entries, path.resolve(targetDir), body.harness);
          sendJson(res, 200, { ok: true, slug: out.slug, written: out.written }, req);
        } catch (e) {
          sendJson(res, 400, { error: e.message }, req);
        }
        return;
      }
      if (method === 'GET' || method === 'HEAD') {
        serveStatic(req.url, staticRoot, res, req, bootToken);
        return;
      }
      sendJson(res, 405, { error: 'method not allowed: ' + method + ' ' + pathname }, req);
    })().catch((err) => {
      try {
        sendJson(res, 500, { error: 'internal error: ' + err.message }, req);
      } catch (_e) {
        // Response already closed.
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      server.bootToken = bootToken;
      server.allowLoopbackLlm = allowLoopbackLlm;
      resolve(server);
    });
  });
}

module.exports = {
  startLocalServer,
  loadRegistryEntries,
  installRecipeFiles,
  introspectMcpServer,
  proxyLlmChat,
  assertBaseUrlPermitted,
  assertHttpTargetDir,
  isSafeRelPath,
  isLoopbackOrigin,
  isLoopbackLiteral,
  isPrivateOrReservedLiteral,
  getRequestToken,
  serveStatic,
  MCP_COMMAND_ALLOWLIST,
  MCP_TIMEOUT_MS
};
