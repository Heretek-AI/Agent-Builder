// scripts/scout.js
// Multi-harness GitHub/npm discovery scout (CommonJS).
//   node scripts/scout.js run [--dry-run] [--limit 20]
//   node scripts/scout.js accept --issue <n> [--sender <login>] [--dry-run]
// --dry-run never touches the network and requires no tokens.
//
// Live `run` mirrors the awesome-opencode reference scout (npm search paged
// 250/from, GitHub gating, downloads-then-stars ranking, one candidate per
// repo, `scout` label issue with `<!-- scout-data {...} -->`), extended from
// opencode-only to all Agent-Builder harnesses/topics. Only global fetch, fs,
// path (+ js-yaml / catalog util) are used; no new npm dependencies.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { loadCatalog, loadTaxonomy } = require('./utils/catalog');

// ---------------------------------------------------------------------------
// Search coverage: npm text queries spanning every harness + topic family.
// npm registry search (`/-/v1/search?text=...&size=250&from=...`) is the
// primary source; GitHub code search (see githubCodeSearchFallback) is a
// best-effort supplement when GITHUB_TOKEN is present.
// ---------------------------------------------------------------------------
const SEARCHES = [
  // OpenCode (reference behavior, kept first)
  'keywords:opencode-plugin',
  '@opencode/plugin',
  'keywords:opencode',
  '@opencode-ai',
  // Claude Code
  'keywords:claude-code',
  'claude-code skill',
  '@anthropic-ai',
  'claude-agent-sdk',
  // Codex CLI
  'keywords:codex',
  'codex skill',
  '@openai/codex',
  // Gemini CLI
  'keywords:gemini-cli',
  'gemini extension',
  'gemini-cli extension',
  // Cursor / Windsurf / Copilot
  'keywords:cursor',
  'cursor rules',
  'keywords:windsurf',
  'windsurf skill',
  'keywords:copilot',
  'copilot extension',
  // MCP servers
  'keywords:mcp-server',
  'keywords:mcp',
  'mcp-server',
  'mcp-',
  '@modelcontextprotocol',
  // Skills / agents / prompts / design systems (topic families)
  'keywords:skill',
  'SKILL.md skill',
  'keywords:agent',
  'subagent agent team',
  'keywords:prompt',
  'system prompt persona',
  'design-md DESIGN.md',
  'AGENTS.md agents',
];

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
  'id', 'name', 'repo', 'path', 'npm', 'homepage', 'tagline', 'description',
  'kind', 'category', 'harnesses', 'languages', 'platforms', 'mcp',
  'agent_preset', 'content_file', 'tags', 'compat', 'scope', 'min_version',
  'installation', 'license', 'source_attribution',
];

const DATA_RE = /<!-- scout-data (\{.*?\}) -->/s;
const ACCEPT_LIMIT = 10;

// GitHub code-search fallback: manifest/topic filenames worth probing when a
// token is available (code search is authenticated-only). Best-effort.
const CODE_SEARCH_QUERIES = [
  'filename:SKILL.md',
  'filename:DESIGN.md',
  'filename:AGENTS.md',
  'filename:opencode.json',
  'filename:.mcp.json',
  'filename:CLAUDE.md',
  'filename:GEMINI.md',
];

function printUsage() {
  console.log('Usage:');
  console.log('  node scripts/scout.js run [--dry-run] [--limit 20]');
  console.log('  node scripts/scout.js accept --issue <n> [--sender <login>] [--dry-run]');
}

function parseRunArgs(argv) {
  const args = { dryRun: false, limit: 20 };
  for (let i = 3; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (a === '--limit') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        console.error('ERROR: --limit requires a value');
        process.exit(1);
      }
      const n = Number(next);
      if (!Number.isInteger(n) || n <= 0 || n > 200) {
        console.error(`ERROR: invalid --limit '${next}': must be an integer 1..200`);
        process.exit(1);
      }
      args.limit = n;
      i += 1;
      continue;
    }
    if (a.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (!Number.isInteger(n) || n <= 0 || n > 200) {
        console.error(`ERROR: invalid --limit '${a}': must be an integer 1..200`);
        process.exit(1);
      }
      args.limit = n;
      continue;
    }
    console.error(`ERROR: unknown argument '${a}' (see --help)`);
    process.exit(1);
  }
  return args;
}

function parseAcceptArgs(argv) {
  const args = { dryRun: false, issue: null, sender: null };
  for (let i = 3; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (a === '--issue') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        console.error('ERROR: --issue requires a value');
        process.exit(1);
      }
      args.issue = next;
      i += 1;
      continue;
    }
    if (a.startsWith('--issue=')) {
      args.issue = a.slice('--issue='.length);
      continue;
    }
    if (a === '--sender') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        console.error('ERROR: --sender requires a value');
        process.exit(1);
      }
      args.sender = next;
      i += 1;
      continue;
    }
    if (a.startsWith('--sender=')) {
      args.sender = a.slice('--sender='.length);
      continue;
    }
    console.error(`ERROR: unknown argument '${a}' (see --help)`);
    process.exit(1);
  }
  return args;
}

function loadDeclined(rootDir) {
  const declinedPath = path.join(rootDir, 'discovery', 'declined.txt');
  const ignored = new Set();
  if (!fs.existsSync(declinedPath)) return ignored;
  for (const line of fs.readFileSync(declinedPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    ignored.add(t.toLowerCase());
  }
  return ignored;
}

function truncate(text, max) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

function slugify(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'entry';
}

// Canonical repo key: lowercased, no .git suffix, no trailing slash.
function canonicalRepoKey(url) {
  return String(url || '').trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// GitHub REST + npm helpers (inline; native fetch only, no new deps).
// ---------------------------------------------------------------------------
function githubHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'agent-builder-scout',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function rest(apiPath, { method = 'GET', body, token } = {}) {
  const res = await fetch(`https://api.github.com${apiPath}`, {
    method,
    headers: githubHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_e) {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

async function npmSearch(text) {
  const results = [];
  for (let from = 0; from < 1000; from += 250) {
    let res;
    try {
      res = await fetch(
        `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=250&from=${from}`,
        { headers: { 'User-Agent': 'agent-builder-scout' } },
      );
    } catch (err) {
      throw new Error(`npm search failed for '${text}': ${err.message}`);
    }
    if (!res.ok) break;
    const body = await res.json();
    const objects = Array.isArray(body.objects) ? body.objects : [];
    results.push(...objects.map((o) => o.package));
    if (objects.length < 250) break;
  }
  return results;
}

async function getNpmLatest(name) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
    headers: { 'User-Agent': 'agent-builder-scout' },
  });
  if (!res.ok) return null;
  return res.json();
}

async function getNpmWeeklyDownloads(name) {
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`, {
      headers: { 'User-Agent': 'agent-builder-scout' },
    });
    if (!res.ok) return 0;
    const body = await res.json();
    return Number(body.downloads) || 0;
  } catch (_e) {
    return 0;
  }
}

function parseRepoUrl(url) {
  const m = String(url || '').match(/github\.com[/:]([^/]+)\/([^/#.]+?)(?:\.git)?(?:[#/]|$)/i);
  if (!m) return null;
  return { owner: m[1], name: m[2] };
}

// REST equivalent of the reference getRepos(): one GET per repo, tolerant of
// failures (returns a Map of 'owner/name' -> normalized info).
async function getRepos(pairs, token) {
  const out = new Map();
  await mapLimit(pairs, 8, async (p) => {
    if (!p || !p.owner || !p.name) return;
    try {
      const { ok, data } = await rest(`/repos/${p.owner}/${p.name}`, { token });
      if (!ok || !data) return;
      out.set(`${p.owner}/${p.name}`.toLowerCase(), {
        isArchived: !!data.archived,
        isFork: !!data.fork,
        isPrivate: !!data.private,
        licenseInfo: data.license ? (data.license.spdx_id || data.license.key || data.license.name) : null,
        stargazerCount: Number(data.stargazers_count) || 0,
        description: data.description || '',
        nameWithOwner: data.full_name || `${p.owner}/${p.name}`,
        defaultBranch: data.default_branch || 'main',
      });
    } catch (_e) {
      // Fail-open per repo: gated out later (info missing => rejected).
    }
  });
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      try {
        out[i] = await fn(items[i], i);
      } catch (_e) {
        out[i] = null;
      }
    }
  }));
  return out;
}

function repoFromManifest(manifest) {
  const raw = typeof manifest.repository === 'string'
    ? manifest.repository
    : (manifest.repository && manifest.repository.url);
  const m = String(raw || '').match(/github\.com[/:]([^/]+)\/([^/#.]+?)(?:\.git)?(?:[#/]|$)/)
    || String(raw || '').match(/^github:([^/]+)\/(.+)$/)
    || String(raw || '').match(/^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!m) return null;
  const directory = manifest.repository && manifest.repository.directory;
  return {
    repo: `https://github.com/${m[1]}/${m[2]}`,
    path: directory ? String(directory).replace(/^\.?\/+|\/+$/g, '') : undefined,
  };
}

// ---------------------------------------------------------------------------
// Harness / kind / category classification.
// Mapping table (manifest signals -> harness, kind, category):
//   @opencode/* dep, opencode keywords      -> opencode,   plugin,     plugins/opencode
//   claude-code/@anthropic-ai/agent-sdk     -> claude-code, plugin,    plugins/claude-code
//   codex/@openai/codex keywords            -> codex,       plugin,    plugins/codex
//   gemini/@google/gemini-cli keywords      -> gemini-cli,  plugin,    plugins/gemini-cli
//   cursor keywords                         -> cursor,      plugin,    plugins/cursor-windsurf
//   windsurf keywords                       -> windsurf,    plugin,    plugins/cursor-windsurf
//   copilot keywords                        -> copilot,     plugin,    plugins/cross-harness*
//   mcp-sdk/@modelcontextprotocol markers   -> universal+,  mcp-server,mcp-servers/* (by topic)
//   SKILL.md/skill keywords                 -> universal+,  skill,     skills/* (by topic)
//   DESIGN.md/design keywords               -> universal+,  design-md, design-md/*
//   prompt/persona keywords                 -> universal+,  prompt,    prompts/*
//   subagent/multi-agent keywords           -> universal+,  agent,     agents/*
//   no signal                               -> universal,   plugin,    plugins/cross-harness
// * copilot-only with no other harness falls back to cross-harness bridge row.
// A package may list several harnesses when several signal families match.
// ---------------------------------------------------------------------------
function manifestSignalText(pkg, manifest) {
  const deps = Object.assign({}, manifest.dependencies, manifest.peerDependencies, manifest.devDependencies);
  return [
    pkg.name,
    manifest.description || '',
    pkg.description || '',
    (manifest.keywords || []).join(' '),
    Object.keys(deps).join(' '),
  ].join(' ').toLowerCase();
}

function hasAny(haystack, needles) {
  return needles.some((n) => haystack.includes(n));
}

function classifyManifest(pkg, manifest) {
  const text = manifestSignalText(pkg, manifest);
  const deps = Object.assign({}, manifest.dependencies, manifest.peerDependencies, manifest.devDependencies);
  const depNames = Object.keys(deps).map((d) => d.toLowerCase());

  const harnesses = [];
  if (hasAny(text, ['opencode', '@opencode'])) harnesses.push('opencode');
  if (hasAny(text, ['claude-code', 'claude code', '@anthropic-ai', 'claude-agent-sdk'])) harnesses.push('claude-code');
  if (hasAny(text, ['codex', '@openai/codex'])) harnesses.push('codex');
  if (hasAny(text, ['gemini-cli', 'gemini cli', 'gemini extension', '@google/gemini'])) harnesses.push('gemini-cli');
  if (hasAny(text, ['cursor', '.cursor', 'cursor-rules', 'cursor rules'])) harnesses.push('cursor');
  if (hasAny(text, ['windsurf', '.windsurf', 'windsurfrules'])) harnesses.push('windsurf');
  if (hasAny(text, ['copilot', 'copilot extension'])) harnesses.push('copilot');

  const isMcp = hasAny(text, ['mcp-server', 'mcp server', 'modelcontextprotocol', 'model context protocol', '@modelcontextprotocol', 'mcp-sdk', 'mcp sdk']);
  const isSkill = hasAny(text, ['skill.md', 'skil.md', 'skill bundle', 'skill playbook', 'slash-command', 'slash command'])
    || /\bskills?\b/.test(text);
  const isDesignMd = hasAny(text, ['design.md', 'design-md', 'design system', 'brand system']);
  const isPrompt = hasAny(text, ['system prompt', 'meta-prompt', 'metaprompt', 'persona', 'reasoning workflow'])
    || (/\bprompts?\b/.test(text) && !isSkill);
  const isAgent = hasAny(text, ['subagent', 'sub-agent', 'multi-agent', 'multiagent', 'agent team', 'agent-team', 'agent preset', 'agent-preset']);
  const isPlugin = depNames.some((d) => d === '@opencode/plugin' || d === '@opencode-ai/plugin')
    || hasAny(text, ['opencode-plugin', 'opencode plugin', 'claude plugin', 'marketplace plugin', 'hook script', 'lifecycle hook', 'statusline', 'extension']);

  let kind;
  if (isMcp) kind = 'mcp-server';
  else if (isSkill) kind = 'skill';
  else if (isDesignMd) kind = 'design-md';
  else if (isPrompt) kind = 'prompt';
  else if (isAgent) kind = 'agent';
  else kind = 'plugin';

  // Any recognized topic/dependency signal keeps the package; fully
  // signal-less packages are gated out by the caller.
  const signal = harnesses.length > 0 || isMcp || isSkill || isDesignMd || isPrompt || isAgent || isPlugin;

  if (harnesses.length === 0) harnesses.push('universal');

  const category = categoryFor(kind, harnesses, text);
  const topics = suggestTopics(text);
  return { harnesses, kind, category, topics, signal };
}

function categoryFor(kind, harnesses, text) {
  if (kind === 'plugin') {
    if (harnesses.includes('opencode')) return 'plugins/opencode';
    if (harnesses.includes('claude-code')) return 'plugins/claude-code';
    if (harnesses.includes('codex')) return 'plugins/codex';
    if (harnesses.includes('gemini-cli')) return 'plugins/gemini-cli';
    if (harnesses.includes('cursor') || harnesses.includes('windsurf')) return 'plugins/cursor-windsurf';
    return 'plugins/cross-harness';
  }
  if (kind === 'mcp-server') {
    if (hasAny(text, ['postgres', 'sqlite', 'clickhouse', 'supabase', 'neon', 'redis', 'database', 'sql ', 'warehouse'])) return 'mcp-servers/databases';
    if (hasAny(text, ['git', 'github', 'pull request', 'ast search', 'lsp ', 'code intelligence'])) return 'mcp-servers/git-repos';
    if (hasAny(text, ['browser', 'playwright', 'puppeteer', 'chrome cdp', 'firecrawl', 'crawl', 'scrap', 'serp', 'search'])) return 'mcp-servers/browser-web';
    if (hasAny(text, ['ghidra', 'vulnerab', 'malware', 'exploit', 'audit', '>yara', 'yara ', 'sandbox', 'sast', 'dast'])) return 'mcp-servers/security-re';
    if (hasAny(text, ['figma', 'stitch', 'storybook', 'screenshot', 'design', ' ui '])) return 'mcp-servers/design-ui';
    if (hasAny(text, ['cloudflare', 'kubernetes', 'docker', 'sentry', 'datadog', 'observab', 'cloud ', 'aws', 'gcp', 'azure'])) return 'mcp-servers/cloud-devops';
    if (hasAny(text, ['notion', 'obsidian', 'notebooklm', 'slack', 'workspace', 'docs', 'knowledge'])) return 'mcp-servers/knowledge-productivity';
    if (hasAny(text, ['file', 'shell', 'terminal', 'command', 'desktop', 'filesystem'])) return 'mcp-servers/filesystem-shell';
    return 'mcp-servers/filesystem-shell';
  }
  if (kind === 'skill') {
    if (hasAny(text, ['ghidra', 'ida pro', 'binary ninja', 'radare', 'firmware', 'reverse engineer'])) return 'skills/cybersecurity/reverse-engineering';
    if (hasAny(text, ['yara', 'malware', 'deobfuscat', 'triage'])) return 'skills/cybersecurity/malware-analysis';
    if (hasAny(text, ['pentest', 'burp', 'ssrf', 'idor', 'fuzz', 'red-team', 'red team'])) return 'skills/cybersecurity/web-network-pentesting';
    if (hasAny(text, ['dfir', 'forensic', 'incident response', 'osint', 'threat intel', 'detection engineer'])) return 'skills/cybersecurity/dfir-threat-intel';
    if (hasAny(text, ['iam ', 'sbom', 'cosign', 'secret scan', 'harden', 'supply chain', 'least-privilege'])) return 'skills/cybersecurity/cloud-devsecops';
    if (hasAny(text, ['sast', 'dast', 'threat model', 'code review', 'smart contract audit', 'vulnerab'])) return 'skills/cybersecurity/security-auditing';
    if (hasAny(text, ['docker', 'kubernetes', 'helm', 'service mesh'])) return 'skills/devops-cloud/containers-k8s';
    if (hasAny(text, ['terraform', 'opentofu', 'pulumi', 'infrastructure'])) return 'skills/devops-cloud/iac-terraform';
    if (hasAny(text, ['github actions', 'gitlab ci', 'opentelemetry', 'prometheus', 'runbook', 'ci/cd', 'pipeline'])) return 'skills/devops-cloud/ci-cd-observability';
    if (hasAny(text, ['rag ', 'vector search', 'embedding', 'chunking', 'knowledge graph', 'memory'])) return 'skills/data-ai/rag-memory';
    if (hasAny(text, ['lora', 'fine-tun', 'benchmark', 'bioinformat', 'geospatial', 'ml ', 'training'])) return 'skills/data-ai/ml-scientific';
    if (hasAny(text, ['subagent', 'orchestrat', 'context compaction', 'evaluation harness', 'mcp author'])) return 'skills/data-ai/agent-orchestration';
    if (hasAny(text, ['playwright', 'cypress', 'selenium', 'visual regression', 'e2e'])) return 'skills/testing-qa/browser-e2e';
    if (hasAny(text, ['mutation test', 'property test', 'fixture', 'unit test', 'integration test'])) return 'skills/testing-qa/unit-property';
    if (hasAny(text, ['react', 'next.js', 'vue', 'svelte', 'tailwind', 'accessib', 'frontend'])) return 'skills/design/webui';
    if (hasAny(text, ['rust', 'cargo'])) return 'skills/coding/rust';
    if (hasAny(text, ['c++', 'cmake', 'embedded c'])) return 'skills/coding/c-cpp';
    if (hasAny(text, ['typescript', 'javascript', 'node.js', 'bun ', 'deno'])) return 'skills/coding/typescript-js';
    if (hasAny(text, ['golang', ' grpc', ' goroutine'])) return 'skills/coding/go';
    if (hasAny(text, ['zig ', 'bare-metal', 'kernel'])) return 'skills/coding/zig-systems';
    if (hasAny(text, ['java', 'kotlin', 'spring', '.net', 'c#'])) return 'skills/coding/jvm-dotnet';
    if (hasAny(text, ['sql', 'postgres', 'clickhouse', 'migration'])) return 'skills/coding/sql-databases';
    if (hasAny(text, ['bash', 'posix', 'powershell', 'zsh', ' tui', ' cli '])) return 'skills/coding/shell-cli';
    if (hasAny(text, ['lua', 'neovim'])) return 'skills/coding/lua';
    if (hasAny(text, ['android', 'jetpack', 'gradle'])) return 'skills/design/mobile-android';
    if (hasAny(text, ['swiftui', 'uikit', 'xcode', 'testflight'])) return 'skills/design/mobile-ios';
    if (hasAny(text, ['react native', 'expo', 'flutter'])) return 'skills/design/mobile-cross-platform';
    if (hasAny(text, ['tauri', 'electron', 'dear imgui'])) return 'skills/design/desktop-cross-platform';
    if (hasAny(text, ['winui', 'wpf', 'win32'])) return 'skills/design/desktop-windows';
    if (hasAny(text, ['appkit', 'applescript'])) return 'skills/design/desktop-macos';
    if (hasAny(text, ['gtk', 'qt/qml', 'wayland', 'flatpak'])) return 'skills/design/desktop-linux';
    return 'skills/data-ai/agent-orchestration';
  }
  if (kind === 'design-md') {
    if (hasAny(text, ['saas', 'dashboard', 'analytic', 'workspace'])) return 'design-md/saas-productivity';
    if (hasAny(text, ['fintech', 'banking', 'media', 'consumer brand'])) return 'design-md/fintech-consumer';
    return 'design-md/ai-dev-tools';
  }
  if (kind === 'prompt') {
    if (hasAny(text, ['threat', 'red-team', 'red team', 'audit', 'adversarial'])) return 'prompts/security-research';
    if (hasAny(text, ['design', 'documentation', 'specification interview', 'technical writ'])) return 'prompts/product-design';
    return 'prompts/coding-architecture';
  }
  if (kind === 'agent' || kind === 'agent-preset') {
    if (hasAny(text, ['securit', 'reverse', 'malware', 'audit'])) return 'agents/security-auditors';
    if (hasAny(text, ['design', 'frontend', ' ui', 'mobile'])) return 'agents/design-frontend';
    if (hasAny(text, ['devops', 'database', 'sre', 'research'])) return 'agents/devops-data';
    return 'agents/coding-specialists';
  }
  return 'plugins/cross-harness';
}

const TOPIC_VOCAB = [
  'opencode', 'claude-code', 'codex', 'gemini-cli', 'cursor', 'windsurf', 'copilot',
  'mcp-server', 'mcp', 'skill', 'agent', 'subagent', 'prompt', 'persona', 'plugin',
  'extension', 'design-md', 'security', 'pentesting', 'reverse-engineering', 'malware',
  'devops', 'terraform', 'kubernetes', 'docker', 'ci-cd', 'observability', 'rag',
  'vector-search', 'ml', 'testing', 'playwright', 'browser', 'database', 'postgres',
  'filesystem', 'git', 'github', 'figma', 'cloud', 'notion', 'typescript', 'python',
  'rust', 'go',
];

function suggestTopics(text) {
  const lower = String(text || '').toLowerCase();
  const out = [];
  for (const topic of TOPIC_VOCAB) {
    if (lower.includes(topic) && !out.includes(topic)) out.push(topic);
    if (out.length >= 5) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dedupe helpers
// ---------------------------------------------------------------------------
function readDeclined(rootDir) {
  return loadDeclined(rootDir);
}

// Repo URLs + npm names already targeted by open PRs (best-effort: any
// network error yields an empty set so the weekly run never crashes).
async function openPullTargets(token, repo) {
  const targets = new Set();
  try {
    const { ok, data: pulls } = await rest(`/repos/${repo}/pulls?state=open&per_page=100`, { token });
    if (!ok || !Array.isArray(pulls)) return targets;
    for (const pull of pulls) {
      try {
        const { ok: fok, data: files } = await rest(`/repos/${repo}/pulls/${pull.number}/files?per_page=100`, { token });
        if (!fok || !Array.isArray(files)) continue;
        for (const f of files) {
          for (const m of String(f.patch || '').matchAll(/^\+\s*(repo|npm):\s*["']?([^\s"']+)/gm)) {
            targets.add(m[1] === 'repo' ? canonicalRepoKey(m[2]) : `npm:${m[2].toLowerCase()}`);
          }
        }
      } catch (_e) {
        // Per-PR failures are ignored (fail-open).
      }
    }
  } catch (_e) {
    // Network failure => empty set (fail-open).
  }
  return targets;
}

async function listOpenScoutIssues(token, repo) {
  const { ok, data } = await rest(`/repos/${repo}/issues?state=open&labels=scout&per_page=20`, { token });
  if (!ok || !Array.isArray(data)) return [];
  return data;
}

async function ensureLabels(token, repo, names) {
  for (const name of names) {
    const { status } = await rest(`/repos/${repo}/labels/${encodeURIComponent(name)}`, { token });
    if (status === 404) {
      await rest(`/repos/${repo}/labels`, {
        method: 'POST',
        token,
        body: { name, color: 'ededed', description: 'Automated discovery scout candidates' },
      });
    }
  }
}

// GitHub code-search fallback (authenticated-only). Returns candidate repo
// URLs; any failure yields [] so the npm path is never blocked.
async function githubCodeSearchFallback(token) {
  const urls = new Set();
  if (!token) return urls;
  for (const q of CODE_SEARCH_QUERIES) {
    try {
      const { ok, data } = await rest(`/search/code?q=${encodeURIComponent(`${q} stars:>5`)}&per_page=20`, { token });
      if (!ok || !data || !Array.isArray(data.items)) continue;
      for (const item of data.items) {
        const full = item && item.repository && item.repository.full_name;
        if (full) urls.add(`https://github.com/${full}`);
      }
    } catch (_e) {
      // Fail-open per query.
    }
  }
  return urls;
}

// ---------------------------------------------------------------------------
// Offline mocks (dry-run only — never emitted as live results).
// ---------------------------------------------------------------------------
const MOCK_CANDIDATES = [
  { name: 'opencode-example-plugin', kind: 'plugin', repo: 'https://github.com/example/opencode-example-plugin', tagline: 'Example OpenCode session plugin (dry-run mock).', harnesses: ['opencode'] },
  { name: 'claude-code-example-bundle', kind: 'plugin', repo: 'https://github.com/example/claude-code-example-bundle', tagline: 'Example Claude Code slash-command bundle (dry-run mock).', harnesses: ['claude-code'] },
  { name: 'codex-secure-shell-skill', kind: 'skill', repo: 'https://github.com/example/codex-secure-shell-skill', tagline: 'Example Codex CLI sandbox skill (dry-run mock).', harnesses: ['codex'] },
  { name: 'gemini-example-extension', kind: 'plugin', repo: 'https://github.com/example/gemini-example-extension', tagline: 'Example Gemini CLI tool extension (dry-run mock).', harnesses: ['gemini-cli'] },
  { name: 'cursor-rules-starter', kind: 'prompt', repo: 'https://github.com/example/cursor-rules-starter', tagline: 'Example Cursor rule pack and review prompts (dry-run mock).', harnesses: ['cursor'] },
  { name: 'windsurf-skill-pack', kind: 'skill', repo: 'https://github.com/example/windsurf-skill-pack', tagline: 'Example Windsurf cascade skill pack (dry-run mock).', harnesses: ['windsurf'] },
  { name: 'copilot-instructions-kit', kind: 'prompt', repo: 'https://github.com/example/copilot-instructions-kit', tagline: 'Example Copilot instructions kit (dry-run mock).', harnesses: ['copilot'] },
  { name: 'postgres-mcp-helper', kind: 'mcp-server', repo: 'https://github.com/example/postgres-mcp-helper', tagline: 'Example Postgres MCP server (dry-run mock).', harnesses: ['universal'] },
  { name: 'skill-secure-review-playbook', kind: 'skill', repo: 'https://github.com/example/skill-secure-review-playbook', tagline: 'Example SKILL.md review playbook (dry-run mock).', harnesses: ['universal'] },
  { name: 'brand-design-md-starter', kind: 'design-md', repo: 'https://github.com/example/brand-design-md-starter', tagline: 'Example DESIGN.md brand system (dry-run mock).', harnesses: ['universal'] },
  { name: 'triage-agent-team', kind: 'agent', repo: 'https://github.com/example/triage-agent-team', tagline: 'Example multi-agent triage team (dry-run mock).', harnesses: ['universal'] },
];

// ---------------------------------------------------------------------------
// Live discovery
// ---------------------------------------------------------------------------
async function findCandidates(rootDir, limit, token, repo) {
  const { entries } = loadCatalog(rootDir);
  const known = new Set();
  for (const { entry } of entries) {
    if (entry.repo) known.add(canonicalRepoKey(entry.repo));
    if (entry.npm) known.add(`npm:${String(entry.npm).toLowerCase()}`);
  }
  const declined = readDeclined(rootDir);
  const pending = await openPullTargets(token, repo);

  const seen = new Map();
  for (const query of SEARCHES) {
    const pkgs = await npmSearch(query);
    console.log(`npm search '${query}': ${pkgs.length} package(s)`);
    for (const pkg of pkgs) {
      if (!pkg || !pkg.name) continue;
      if (declined.has(String(pkg.name).toLowerCase())) continue;
      if (known.has(`npm:${String(pkg.name).toLowerCase()}`)) continue;
      if (pending.has(`npm:${String(pkg.name).toLowerCase()}`)) continue;
      if (!seen.has(pkg.name)) seen.set(pkg.name, pkg);
    }
  }
  console.log(`npm: ${seen.size} unique package(s) not yet listed`);
  const fresh = [...seen.values()].slice(0, Math.max(limit * 25, 200));

  const manifests = await mapLimit(fresh, 4, (p) => getNpmLatest(p.name));
  const withManifest = [];
  fresh.forEach((pkg, i) => {
    const manifest = manifests[i];
    if (!manifest || manifest.deprecated) return;
    const cls = classifyManifest(pkg, manifest);
    if (!cls.signal) return;
    const source = repoFromManifest(manifest);
    if (!source) return;
    const repoKey = canonicalRepoKey(source.repo);
    if (known.has(repoKey) || pending.has(repoKey) || declined.has(repoKey)) return;
    if (known.has(`npm:${pkg.name.toLowerCase()}`) || declined.has(pkg.name.toLowerCase())) return;
    withManifest.push({ pkg, manifest, source, cls });
  });
  console.log(`${withManifest.length} package(s) with a classifiable manifest + GitHub repo`);

  const pairs = withManifest.map((c) => parseRepoUrl(c.source.repo)).filter(Boolean);
  const repos = await getRepos(pairs, token);
  const gated = [];
  for (const c of withManifest) {
    const p = parseRepoUrl(c.source.repo);
    const info = p ? repos.get(`${p.owner}/${p.name}`.toLowerCase()) : undefined;
    if (!info) continue;
    if (info.isArchived || info.isFork || info.isPrivate) continue;
    if (!(info.licenseInfo || c.manifest.license)) continue;
    // npm repository links often point at a pre-transfer name; dedupe on
    // GitHub's canonical name.
    c.source.repo = `https://github.com/${info.nameWithOwner}`;
    const key = canonicalRepoKey(c.source.repo);
    if (known.has(key) || pending.has(key) || declined.has(key)) continue;
    c.info = info;
    gated.push(c);
  }
  console.log(`${gated.length} pass the gates (public, licensed, not archived/fork)`);

  // Best-effort code-search fallback: log-only; npm remains authoritative.
  if (token) {
    const extra = await githubCodeSearchFallback(token);
    if (extra.size > 0) console.log(`code-search fallback: ${extra.size} additional repo(s) noted`);
  }

  await mapLimit(gated, 8, async (c) => {
    c.downloads = await getNpmWeeklyDownloads(c.pkg.name);
  });
  // One candidate per repo (monorepos publish several packages; keep the
  // most downloaded).
  const byRepo = new Map();
  for (const c of gated) {
    const key = canonicalRepoKey(c.source.repo);
    if (!byRepo.has(key) || (byRepo.get(key).downloads || 0) < (c.downloads || 0)) byRepo.set(key, c);
  }
  const ranked = [...byRepo.values()]
    .sort((a, b) => (b.downloads || 0) - (a.downloads || 0) || (b.info.stargazerCount || 0) - (a.info.stargazerCount || 0));
  console.log(`${gated.length} pass the gates; ${ranked.length} distinct repo(s)`);
  return ranked.slice(0, limit);
}

function candidateInput(c) {
  const description = truncate(c.info.description || c.manifest.description || c.pkg.description || '', 600);
  let license;
  const li = c.info && c.info.licenseInfo;
  if (typeof li === 'string' && li && li.toUpperCase() !== 'NOASSERTION') license = li;
  else if (typeof c.manifest.license === 'string' && c.manifest.license) license = c.manifest.license;
  return {
    name: c.pkg.name,
    repo: c.source.repo,
    ...(c.source.path ? { path: c.source.path } : {}),
    npm: c.pkg.name,
    category: c.cls.category,
    kind: c.cls.kind,
    harnesses: c.cls.harnesses,
    topics: c.cls.topics,
    ...(license ? { license } : {}),
    tagline: truncate(c.manifest.description || description || c.pkg.name, 120),
    description: description || c.pkg.name,
  };
}

async function cmdRunLive(rootDir, limit) {
  const token = process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPOSITORY || '';
  if (!token) {
    fail('live scout requires GITHUB_TOKEN (issue creation + GitHub gating). '
      + 'Run with --dry-run for the offline path, or set GITHUB_TOKEN in the environment.');
  }
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    fail('live scout requires GITHUB_REPOSITORY=owner/repo in the environment (CI provides this automatically).');
  }
  let candidates;
  try {
    candidates = await findCandidates(rootDir, limit, token, repo);
  } catch (err) {
    fail(`live discovery failed: ${err.message} (check network access to registry.npmjs.org / api.github.com)`);
  }

  const week = new Date().toISOString().slice(0, 10);
  const data = {};
  const lines = candidates.map((c, i) => {
    const id = `c${i + 1}`;
    data[id] = candidateInput(c);
    const label = data[id].kind;
    return `- [ ] **${c.pkg.name}** (${label}) — ${truncate(c.manifest.description || c.info.description || '', 140)} · ⭐ ${c.info.stargazerCount} · ⬇ ${c.downloads || 0}/wk · [repo](${c.source.repo}) · [npm](https://www.npmjs.com/package/${c.pkg.name}) <!-- scout:${id} -->`;
  });
  const harnessList = 'opencode, claude-code, codex, gemini-cli, cursor, windsurf, copilot, universal';
  const body = [
    `Multi-harness npm packages not in the catalog yet (${harnessList}; kinds plugin / skill / mcp-server / design-md / prompt / agent per \`data/taxonomy.json\`). Public, licensed, not archived or forked. Ranked by weekly downloads, then stars.`,
    '',
    '**Tick a box to open a pull request for that candidate** (maintainers only; harness/kind/category/topics are keyword guesses, fix them in the PR). To stop suggesting a package, add it to [`discovery/declined.txt`](https://github.com/Heretek-AI/Agent-Builder/blob/main/discovery/declined.txt).',
    '',
    ...(lines.length ? lines : ['_No new candidates this week._']),
    '',
    `<!-- scout-data ${JSON.stringify(data)} -->`,
  ].join('\n');

  await ensureLabels(token, repo, ['scout']);
  const open = await listOpenScoutIssues(token, repo);
  for (const old of open) {
    if (!old.pull_request) {
      await rest(`/repos/${repo}/issues/${old.number}`, {
        method: 'PATCH', token, body: { state: 'closed', state_reason: 'completed' },
      });
      console.log(`closed prior scout issue #${old.number}`);
    }
  }
  const { ok, data: created, status } = await rest(`/repos/${repo}/issues`, {
    method: 'POST', token, body: { title: `Scout: multi-harness candidates (${week})`, body, labels: ['scout'] },
  });
  if (!ok || !created || !created.number) {
    fail(`failed to open scout issue (HTTP ${status}). Check issues:write permission and GITHUB_TOKEN scope.`);
  }
  console.log(`Opened scout issue #${created.number} with ${candidates.length} candidate(s)`);
}

function cmdRun(rootDir) {
  const args = parseRunArgs(process.argv);
  const declined = loadDeclined(rootDir);
  // Dry-run returns before any fetch: guaranteed offline, no tokens needed.
  if (args.dryRun) {
    const candidates = MOCK_CANDIDATES
      .filter((c) => !declined.has(c.repo.toLowerCase()))
      .slice(0, args.limit);
    for (const c of candidates) {
      console.log(`CANDIDATE ${c.kind} ${c.name} ${c.repo} -- ${c.tagline}`);
    }
    console.log(`SCOUT_DRY_RUN_OK candidates=${candidates.length} declined=${declined.size}`);
    return Promise.resolve();
  }
  return cmdRunLive(rootDir, args.limit);
}

// ---------------------------------------------------------------------------
// Accept: open PRs for ticked candidates.
// ---------------------------------------------------------------------------
function gitExec(args, options) {
  // argv-array only: issue text is untrusted and never interpolated into shell.
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(options || {}) });
}

function buildEntryYaml(input, taxonomyIds) {
  if (!input || typeof input !== 'object') return { ok: false, problems: ['empty candidate input'] };
  const problems = [];
  const name = truncate(input.name || '', 256);
  const repoUrl = String(input.repo || '').trim();
  const kind = String(input.kind || '').toLowerCase();
  const category = String(input.category || '').trim();
  if (!name) problems.push('missing name');
  if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(repoUrl)) problems.push(`invalid repo URL '${repoUrl || '(missing)'}'`);
  if (!Object.prototype.hasOwnProperty.call(KIND_TO_FOLDER, kind)) {
    problems.push(`invalid kind '${kind || '(missing)'}'`);
  }
  if (!taxonomyIds.has(category)) problems.push(`unknown category '${category || '(missing)'}'`);
  const tagline = truncate(input.tagline || input.description || name, 120);
  if (!tagline) problems.push('missing tagline');
  if (!input.license || (typeof input.license === 'string' && !input.license.trim())) problems.push('missing license');
  if (problems.length > 0) return { ok: false, problems };
  const id = slugify(name);
  const doc = {
    id,
    name,
    repo: repoUrl,
    ...(input.path ? { path: String(input.path) } : {}),
    ...(input.npm ? { npm: String(input.npm) } : {}),
    tagline,
    description: truncate(input.description || tagline, 2000),
    kind,
    category,
    harnesses: Array.isArray(input.harnesses) && input.harnesses.length > 0 ? input.harnesses : ['universal'],
    ...(Array.isArray(input.topics) && input.topics.length > 0 ? { tags: input.topics } : {}),
    license: String(input.license),
  };
  const ordered = {};
  for (const key of KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(doc, key)) ordered[key] = doc[key];
  }
  const folder = KIND_TO_FOLDER[kind];
  let subpath = category;
  if (subpath === folder) subpath = '';
  else if (subpath.startsWith(`${folder}/`)) subpath = subpath.slice(folder.length + 1);
  const file = subpath ? `data/${folder}/${subpath}/${id}.yaml` : `data/${folder}/${id}.yaml`;
  const text = yaml.dump(ordered, { lineWidth: 100, noRefs: true, sortKeys: false });
  return {
    ok: true, file, text, id, problems: [], notes: [`topics ${doc.tags ? 'guessed' : 'defaulted'}; verify harness/kind/category before merging`],
  };
}

async function cmdAccept(rootDir) {
  const args = parseAcceptArgs(process.argv);
  if (args.issue === null || String(args.issue).trim() === '') {
    console.error('ERROR: accept requires --issue <n> (see --help)');
    process.exit(1);
  }
  const n = Number(String(args.issue).trim());
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`ERROR: invalid --issue '${args.issue}': must be a positive integer`);
    process.exit(1);
  }
  // Dry-run returns before any fetch: guaranteed offline, no tokens needed.
  if (args.dryRun) {
    console.log(`ACCEPT_OK (dry-run): would accept scout issue #${n}`
      + (args.sender ? ` (sender ${args.sender})` : '')
      + ` — plan: fetch issue, parse scout-data, open up to ${ACCEPT_LIMIT} PR(s) on scout/<slug> branches`);
    return;
  }
  const token = process.env.GITHUB_TOKEN || '';
  if (!token) fail('live accept requires GITHUB_TOKEN in the environment.');
  const repo = process.env.GITHUB_REPOSITORY || '';
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    fail('live accept requires GITHUB_REPOSITORY=owner/repo in the environment.');
  }
  if (args.sender) {
    try {
      const { data } = await rest(`/repos/${repo}/collaborators/${encodeURIComponent(args.sender)}/permission`, { token });
      if (!data || !['admin', 'maintain', 'write'].includes(data.permission)) {
        console.log(`${args.sender} does not have write access; ignoring`);
        return;
      }
    } catch (err) {
      console.log(`unable to verify sender access (${err.message}); ignoring`);
      return;
    }
  }
  const { ok, data: issue, status } = await rest(`/repos/${repo}/issues/${n}`, { token });
  if (!ok || !issue) fail(`failed to fetch issue #${n} (HTTP ${status}).`);
  const match = DATA_RE.exec(issue.body || '');
  if (!match) {
    console.log('no scout data in issue');
    return;
  }
  let scoutData;
  try {
    scoutData = JSON.parse(match[1]);
  } catch (err) {
    fail(`scout-data JSON in issue #${n} is corrupt: ${err.message}`);
  }
  const { ids } = loadTaxonomy(rootDir);
  const { data: repoInfo } = await rest(`/repos/${repo}`, { token });
  const base = (repoInfo && repoInfo.default_branch) || 'main';

  let body = issue.body || '';
  let opened = 0;
  for (const line of body.split('\n')) {
    const candidate = line.match(/^- \[( |x)\] .*<!-- scout:(c\d+) -->\r?$/i);
    if (!candidate) continue;
    const id = candidate[2];
    const selected = candidate[1].toLowerCase() === 'x';
    if (!selected || / → /.test(line) || opened >= ACCEPT_LIMIT) continue;
    if (!scoutData[id]) continue;
    const input = scoutData[id];
    const result = buildEntryYaml(input, ids);
    let note;
    if (!result.ok) {
      note = ` → not added: ${truncate(result.problems.join('; '), 200)}`;
    } else {
      const branch = `scout/${result.id}`;
      try {
        const outAbs = path.join(rootDir, result.file);
        // One PR per candidate: fresh branch from base, single file, push, PR.
        try { gitExec(['fetch', 'origin', base]); } catch (_e) { /* offline-safe: use local base */ }
        try { gitExec(['checkout', '-B', branch, `origin/${base}`]); }
        catch (_e) { gitExec(['checkout', '-B', branch, base]); }
        if (fs.existsSync(outAbs)) throw new Error(`refusing to overwrite existing file '${result.file}'`);
        fs.mkdirSync(path.dirname(outAbs), { recursive: true });
        fs.writeFileSync(outAbs, result.text, 'utf8');
        gitExec(['add', result.file]);
        gitExec(['-c', 'user.name=agent-builder-scout', '-c', 'user.email=agent-builder-scout@users.noreply.github.com',
          'commit', '-m', `docs: add ${input.name} to ${input.category}`]);
        gitExec(['push', '--set-upstream', 'origin', branch], {
          env: {
            ...process.env,
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
            GIT_CONFIG_VALUE_0: `AUTHORIZATION: bearer ${token}`,
          },
        });
        const { ok: pok, data: pr } = await rest(`/repos/${repo}/pulls`, {
          method: 'POST', token,
          body: {
            title: `docs: add ${input.name} to ${input.category}`,
            head: branch,
            base,
            body: [
              `Found by the weekly scout in #${n}.`,
              '',
              ...result.notes.map((t) => `- ${t}`),
              '',
              'Harness/kind/category/topics are keyword guesses; adjust them before merging.',
            ].join('\n'),
          },
        });
        if (pok && pr && pr.number) {
          await rest(`/repos/${repo}/issues/${pr.number}/labels`, {
            method: 'POST', token, body: { labels: ['scout', `category: ${input.category}`] },
          }).catch(() => null);
          note = ` → #${pr.number}`;
        } else {
          note = ' → (PR creation failed; branch pushed)';
        }
        opened += 1;
      } catch (err) {
        // Roll back the working tree file so the next candidate starts clean.
        try { gitExec(['checkout', '--', result.file]); } catch (_e) { /* ignore */ }
        try { if (fs.existsSync(path.join(rootDir, result.file))) fs.unlinkSync(path.join(rootDir, result.file)); } catch (_e) { /* ignore */ }
        note = ` → not added: ${truncate(token ? String(err.message || '').split(token).join('[redacted]') : String(err.message || ''), 200)}`;
      }
    }
    body = body.replace(line, line.replace(/^- \[x\]/i, '- [x]').replace(/ <!-- scout:/, `${note} <!-- scout:`));
  }
  if (body !== (issue.body || '')) {
    await rest(`/repos/${repo}/issues/${n}`, { method: 'PATCH', token, body: { body } });
  }
  console.log(`ACCEPT_OK: processed ${opened} accepted candidate(s) for scout issue #${n}`);
}

function main() {
  const rootDir = path.join(__dirname, '..');
  const cmd = process.argv[2];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    printUsage();
    process.exit(cmd ? 0 : 1);
  }
  if (cmd === 'run') {
    Promise.resolve(cmdRun(rootDir)).catch((err) => {
      console.error(`ERROR: ${err && err.message ? err.message : err}`);
      process.exit(1);
    });
    return;
  }
  if (cmd === 'accept') {
    Promise.resolve(cmdAccept(rootDir)).catch((err) => {
      console.error(`ERROR: ${err && err.message ? err.message : err}`);
      process.exit(1);
    });
    return;
  }
  console.error(`ERROR: unknown command '${cmd}' (expected 'run' or 'accept'; see --help)`);
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { DATA_RE, ACCEPT_LIMIT, SEARCHES, classifyManifest, buildEntryYaml, truncate, canonicalRepoKey };
