// scripts/scout.js
// Multi-harness GitHub/npm discovery scout & multi-signal classifier (CommonJS).
//   node scripts/scout.js run [--dry-run] [--limit 20]
//   node scripts/scout.js accept --issue <n> [--sender <login>] [--dry-run]
//   node scripts/scout.js classify --name <pkg> [--description <text>] [--keywords <a,b>]
// --dry-run never touches the network and requires no tokens.
//
// Powered by `src/core/classifier.js` (weighted 4-tier multi-signal scoring
// with word-boundary domain matching and confidence breakdown).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { loadCatalog, loadTaxonomy } = require('./utils/catalog');
const { classifyManifest, suggestTopics } = require('../src/core/classifier');

// ---------------------------------------------------------------------------
// Search coverage: npm text queries spanning every harness + topic family.
// ---------------------------------------------------------------------------
const SEARCHES = [
  // OpenCode (reference behavior, kept first)
  'keywords:opencode-plugin',
  '@opencode/plugin',
  'keywords:opencode',
  '@opencode-ai',
  // Pi (earendil-works/pi)
  'keywords:pi-package',
  '@earendil-works/pi',
  'pi-coding-agent',
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
  console.log('  node scripts/scout.js classify --name <pkg> [--description <text>] [--keywords <k1,k2>]');
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

function parseClassifyArgs(argv) {
  const args = { name: '', description: '', keywords: [], deps: [] };
  for (let i = 3; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
    if (a === '--name') {
      args.name = argv[++i] || '';
    } else if (a.startsWith('--name=')) {
      args.name = a.slice('--name='.length);
    } else if (a === '--description') {
      args.description = argv[++i] || '';
    } else if (a.startsWith('--description=')) {
      args.description = a.slice('--description='.length);
    } else if (a === '--keywords') {
      args.keywords = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a.startsWith('--keywords=')) {
      args.keywords = a.slice('--keywords='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--deps') {
      args.deps = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    }
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

function canonicalRepoKey(url) {
  return String(url || '').trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

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
      // Fail-open per repo
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

function readDeclined(rootDir) {
  return loadDeclined(rootDir);
}

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
        // Ignore
      }
    }
  } catch (_e) {
    // Ignore
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
    c.source.repo = `https://github.com/${info.nameWithOwner}`;
    const key = canonicalRepoKey(c.source.repo);
    if (known.has(key) || pending.has(key) || declined.has(key)) continue;
    c.info = info;
    gated.push(c);
  }
  console.log(`${gated.length} pass the gates (public, licensed, not archived/fork)`);

  if (token) {
    const extra = await githubCodeSearchFallback(token);
    if (extra.size > 0) console.log(`code-search fallback: ${extra.size} additional repo(s) noted`);
  }

  await mapLimit(gated, 8, async (c) => {
    c.downloads = await getNpmWeeklyDownloads(c.pkg.name);
  });
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
    confidence: c.cls.confidence,
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
    const label = `${data[id].kind} → ${data[id].category} (${c.cls.confidence || 80}% conf)`;
    return `- [ ] **${c.pkg.name}** (${label}) — ${truncate(c.manifest.description || c.info.description || '', 140)} · ⭐ ${c.info.stargazerCount} · ⬇ ${c.downloads || 0}/wk · [repo](${c.source.repo}) · [npm](https://www.npmjs.com/package/${c.pkg.name}) <!-- scout:${id} -->`;
  });
  const harnessList = 'opencode, claude-code, codex, gemini-cli, cursor, windsurf, copilot, universal';
  const body = [
    `Multi-harness npm packages not in the catalog yet (${harnessList}; kinds plugin / skill / mcp-server / design-md / prompt / agent per \`data/taxonomy.json\`). Public, licensed, not archived or forked. Ranked by weekly downloads, then stars.`,
    '',
    '**Tick a box to open a pull request for that candidate** (maintainers only; harness/kind/category/topics are weighted multi-signal classifications, fix them in the PR if needed). To stop suggesting a package, add it to [`discovery/declined.txt`](https://github.com/Heretek-AI/Agent-Builder/blob/main/discovery/declined.txt).',
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

function cmdClassify() {
  const args = parseClassifyArgs(process.argv);
  if (!args.name) {
    fail('classify requires --name <pkg>');
  }
  const depsObj = {};
  args.deps.forEach((d) => { depsObj[d] = '*'; });
  const res = classifyManifest(
    { name: args.name, description: args.description },
    { name: args.name, description: args.description, keywords: args.keywords, dependencies: depsObj }
  );
  console.log(JSON.stringify(res, null, 2));
}

function gitExec(args, options) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...(options || {}) });
}

function gitAuthEnv(token) {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

function redactSecrets(text, token) {
  let out = String(text || '');
  if (token) {
    out = out.split(token).join('[redacted]');
    const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    out = out.split(basic).join('[redacted]');
  }
  return out;
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
  const validHarnesses = new Set(['opencode', 'claude-code', 'codex', 'gemini-cli', 'cursor', 'windsurf', 'copilot', 'universal']);
  const filteredHarnesses = Array.isArray(input.harnesses)
    ? input.harnesses.filter((h) => validHarnesses.has(String(h)))
    : [];
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
    harnesses: filteredHarnesses.length > 0 ? filteredHarnesses : ['universal'],
    ...(Array.isArray(input.topics) && input.topics.length > 0 ? { tags: input.topics } : {}),
    license: String(input.license),
    source_attribution: `Discovered by Agent-Builder scout from ${repoUrl} (${String(input.license)}).`,
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
    if (!selected || / → #\d+/.test(line) || opened >= ACCEPT_LIMIT) continue;
    if (!scoutData[id]) continue;
    const input = scoutData[id];
    const result = buildEntryYaml(input, ids);
    const cleanLine = line.replace(/ → .*?(?= <!-- scout:)/, '');
    let note;
    if (!result.ok) {
      note = ` → not added: ${truncate(result.problems.join('; '), 200)}`;
    } else {
      const branch = `scout/${result.id}`;
      try {
        const outAbs = path.join(rootDir, result.file);
        // Clear any checkout-persisted extraheader so gitAuthEnv never sends duplicate Authorization headers.
        try { gitExec(['config', '--local', '--unset-all', 'http.https://github.com/.extraheader']); } catch (_e) { /* ignore */ }
        try { gitExec(['fetch', 'origin', base], { env: gitAuthEnv(token) }); } catch (_e) { /* offline-safe */ }
        try { gitExec(['checkout', '-B', branch, `origin/${base}`]); }
        catch (_e) { gitExec(['checkout', '-B', branch, base]); }
        fs.mkdirSync(path.dirname(outAbs), { recursive: true });
        try {
          fs.writeFileSync(outAbs, result.text, { encoding: 'utf8', flag: 'wx' });
        } catch (e) {
          if (e && e.code === 'EEXIST') throw new Error(`refusing to overwrite existing file '${result.file}'`);
          throw e;
        }
        gitExec(['add', result.file]);
        const commitTitle = `docs: add ${input.name} to ${input.category}`;
        gitExec(['-c', 'user.name=agent-builder-scout', '-c', 'user.email=agent-builder-scout@users.noreply.github.com',
          'commit', '-m', commitTitle]);
        gitExec(['push', '--force', '--set-upstream', 'origin', branch], {
          env: gitAuthEnv(token),
        });
        let { ok: pok, status: pstatus, data: pr } = await rest(`/repos/${repo}/pulls`, {
          method: 'POST', token,
          body: {
            title: commitTitle,
            head: branch,
            base,
            body: [
              `Found by the weekly scout in #${n}.`,
              '',
              ...result.notes.map((t) => `- ${t}`),
              '',
              'Harness/kind/category/topics are weighted multi-signal guesses; adjust them before merging.',
            ].join('\n'),
          },
        });
        if (!pok && pstatus === 422) {
          const owner = repo.split('/')[0];
          const existing = await rest(`/repos/${repo}/pulls?state=open&head=${encodeURIComponent(owner + ':' + branch)}`, { token });
          if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
            pok = true;
            pr = existing.data[0];
          }
        }
        if (pok && pr && pr.number) {
          await rest(`/repos/${repo}/issues/${pr.number}/labels`, {
            method: 'POST', token, body: { labels: ['scout', `category: ${input.category}`] },
          }).catch(() => null);
          note = ` → #${pr.number}`;
        } else {
          const compareUrl = `https://github.com/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?quick_pull=1&title=${encodeURIComponent(commitTitle)}`;
          const apiErr = pr && pr.message ? truncate(redactSecrets(pr.message, token), 80) : `HTTP ${pstatus}`;
          note = ` → [Open PR ↗](${compareUrl}) (PR API: ${apiErr}; branch pushed)`;
        }
        opened += 1;
        try { gitExec(['checkout', '-f', base]); } catch (_e) { /* ignore */ }
      } catch (err) {
        try { gitExec(['checkout', '--', result.file]); } catch (_e) { /* ignore */ }
        try { fs.unlinkSync(path.join(rootDir, result.file)); } catch (_e) { /* ignore */ }
        note = ` → not added: ${truncate(redactSecrets(err.message || '', token), 200)}`;
      }
    }
    body = body.replace(line, cleanLine.replace(/^- \[x\]/i, '- [x]').replace(/ <!-- scout:/, `${note} <!-- scout:`));
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
  if (cmd === 'classify') {
    cmdClassify();
    return;
  }
  console.error(`ERROR: unknown command '${cmd}' (expected 'run', 'accept', or 'classify'; see --help)`);
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = { DATA_RE, ACCEPT_LIMIT, SEARCHES, classifyManifest, suggestTopics, buildEntryYaml, truncate, canonicalRepoKey, gitAuthEnv, redactSecrets };
