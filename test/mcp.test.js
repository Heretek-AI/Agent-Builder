// test/mcp.test.js
// Milestone 9: stdio MCP JSON-RPC 2.0 server over `node bin/agent-builder.js mcp`.
// Spawns the CLI as a child process and exercises initialize, tools/list,
// and tools/call (search_registry, compile_agent_config).
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'bin', 'agent-builder.js');
const TIMEOUT_MS = 5000;

let child = null;
let stdoutBuf = '';
const responses = new Map(); // id -> parsed message
const waiters = new Map(); // id -> { resolve, reject, timer }

function onStdoutData(chunk) {
  stdoutBuf += chunk.toString('utf8');
  const lines = stdoutBuf.split('\n');
  stdoutBuf = lines.pop();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (_e) {
      continue; // Ignore non-JSON log noise.
    }
    if (msg && msg.id !== undefined) {
      responses.set(msg.id, msg);
      const waiter = waiters.get(msg.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiters.delete(msg.id);
        waiter.resolve(msg);
      }
    }
  }
}

function rpc(id, method, params) {
  return new Promise((resolve, reject) => {
    if (responses.has(id)) {
      resolve(responses.get(id));
      return;
    }
    const timer = setTimeout(() => {
      waiters.delete(id);
      reject(new Error('timed out waiting for JSON-RPC response id ' + JSON.stringify(id)));
    }, TIMEOUT_MS);
    waiters.set(id, { resolve, reject, timer });
    const payload = params === undefined
      ? { jsonrpc: '2.0', id, method }
      : { jsonrpc: '2.0', id, method, params };
    child.stdin.write(JSON.stringify(payload) + '\n', (err) => {
      if (err) {
        clearTimeout(timer);
        waiters.delete(id);
        reject(err);
      }
    });
  });
}

function toolText(msg) {
  assert.equal(msg.jsonrpc, '2.0');
  assert.ok(!msg.error, 'expected no error, got ' + JSON.stringify(msg.error));
  const content = msg.result && msg.result.content;
  assert.ok(Array.isArray(content) && content.length > 0, 'tools/call result must have content[]');
  assert.equal(content[0].type, 'text');
  return JSON.parse(content[0].text);
}

before(() => {
  child = spawn(process.execPath, [CLI, 'mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', onStdoutData);
  child.stderr.on('data', () => {
    // Server must stay silent on stderr during happy-path runs; ignore here.
  });
});

after(() => {
  for (const [, waiter] of waiters) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('test teardown: child killed'));
  }
  waiters.clear();
  if (child) {
    try {
      child.kill('SIGTERM');
    } catch (_e) {
      // Already exited.
    }
    setTimeout(() => {
      try {
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
        }
      } catch (_e) {
        // Already exited.
      }
    }, 1000).unref();
  }
});

describe('mcp initialize handshake', () => {
  it('responds with protocolVersion 2024-11-05, tools capability, and serverInfo', async () => {
    const res = await rpc(1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mcp-test', version: '0.0.0' }
    });
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 1);
    assert.ok(!res.error, 'initialize must not error: ' + JSON.stringify(res.error));
    assert.equal(res.result.protocolVersion, '2024-11-05');
    assert.deepEqual(res.result.capabilities, { tools: {} });
    assert.equal(res.result.serverInfo.name, '@heretek-ai/agent-builder');
    assert.ok(typeof res.result.serverInfo.version === 'string');
    // Notification: no response expected; the server must stay usable after it.
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  });
});

describe('mcp tools/list', () => {
  it('lists exactly the 4 registry tools with input schemas', async () => {
    const res = await rpc(2, 'tools/list', {});
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 2);
    assert.ok(!res.error, 'tools/list must not error: ' + JSON.stringify(res.error));
    const names = res.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      'compile_agent_config',
      'get_entry_details',
      'install_agent_bundle',
      'search_registry'
    ]);
    for (const tool of res.result.tools) {
      assert.ok(tool.description && tool.description.length > 0, tool.name + ' needs a description');
      assert.equal(tool.inputSchema.type, 'object');
    }
  });
});

describe('mcp tools/call search_registry', () => {
  it('finds postgres entries by free-text query', async () => {
    const res = await rpc(3, 'tools/call', {
      name: 'search_registry',
      arguments: { query: 'postgres' }
    });
    assert.equal(res.id, 3);
    const out = toolText(res);
    assert.ok(Array.isArray(out.entries), 'search result must carry entries[]');
    assert.ok(out.entries.length > 0, 'query "postgres" must match at least one entry');
    assert.ok(out.total > 0 && out.count === out.entries.length);
    const ids = out.entries.map((e) => e.id);
    assert.ok(ids.includes('postgres-mcp-connector'), 'expected postgres-mcp-connector in results');
  });

  it('filters by exact kind', async () => {
    const res = await rpc(4, 'tools/call', {
      name: 'search_registry',
      arguments: { kind: 'mcp-server', limit: 100 }
    });
    assert.equal(res.id, 4);
    const out = toolText(res);
    assert.ok(out.entries.length > 0);
    for (const entry of out.entries) {
      assert.equal(entry.kind, 'mcp-server');
    }
  });
});

describe('mcp tools/call compile_agent_config', () => {
  it('returns deny-first scoped permissions for the compiled agent', async () => {
    const res = await rpc(5, 'tools/call', {
      name: 'compile_agent_config',
      arguments: {
        name: 'mcp-test-agent',
        description: 'MCP smoke-test agent',
        prompt: 'Audit things.',
        skills: ['python-fastapi-service'],
        mcp: [{ server: 'postgres-prod', tools: ['query'] }]
      }
    });
    assert.equal(res.id, 5);
    const out = toolText(res);
    assert.equal(out.slug, 'mcp-test-agent');
    const perms = out.opencodeV2.agents['mcp-test-agent'].permissions;
    assert.deepEqual(perms.slice(0, 2), [
      { action: 'skill', resource: '*', effect: 'deny' },
      { action: 'skill', resource: 'python-fastapi-service', effect: 'allow' }
    ]);
    assert.ok(perms.some((r) => r.action === 'postgres_prod_query' && r.effect === 'allow'));
    assert.ok(out.opencodeMarkdown.includes('mcp-test-agent') || out.opencodeMarkdown.includes('Audit things.'));
  });
});

describe('mcp tools/call get_entry_details', () => {
  it('returns the full record for a known id', async () => {
    const res = await rpc(6, 'tools/call', {
      name: 'get_entry_details',
      arguments: { id: 'postgres-mcp-connector' }
    });
    assert.equal(res.id, 6);
    const out = toolText(res);
    assert.equal(out.entry.id, 'postgres-mcp-connector');
    assert.ok(out.entry.description && out.entry.description.length > 0);
    assert.ok('content' in out, 'result must carry a content field (markdown or null)');
  });
});

describe('mcp protocol errors', () => {
  it('rejects unknown methods with -32601', async () => {
    const res = await rpc(7, 'does/not-exist', {});
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 7);
    assert.equal(res.error.code, -32601);
  });

  it('rejects unknown tools with -32602', async () => {
    const res = await rpc(8, 'tools/call', { name: 'no_such_tool', arguments: {} });
    assert.equal(res.id, 8);
    assert.equal(res.error.code, -32602);
  });
});
