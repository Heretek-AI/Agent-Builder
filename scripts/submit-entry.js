// scripts/submit-entry.js
// Parses GitHub issue-form JSON (add-entry + publish-agent) into data/**/*.yaml
// and optionally opens a branch + Pull Request (--open-pr) (CommonJS).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');
const { loadTaxonomy, validateEntryObject } = require('./utils/catalog');

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
  'installation', 'license', 'source_attribution', 'synthetic',
];

function printUsage() {
  console.log('Usage: node scripts/submit-entry.js --issue <file.json> [--dry-run] [--open-pr] [--help]');
  console.log('  --issue <file>  GitHub issue JSON ({ number, title, body }) with form fields');
  console.log('  --dry-run       validate + print the YAML without writing files or touching git');
  console.log('  --open-pr       write YAML on a fresh branch, push to origin, and open a PR');
}

function parseArgs(argv) {
  const args = { issue: null, dryRun: false, openPr: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    }
    if (a === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (a === '--open-pr') {
      args.openPr = true;
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
    console.error(`ERROR: unknown argument '${a}' (see --help)`);
    process.exit(1);
  }
  return args;
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function slugify(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'entry';
}

// Parses "### Label\n\nvalue" GitHub issue-form body sections into { label: value }.
// Normalizes labels by stripping trailing required-field asterisks ("### Entry name *")
// and parentheticals ("### MCP selections (JSON)"), and also extracts fenced ```yaml
// blocks when issues are submitted from the WebUI markdown link.
function parseIssueBody(body) {
  const fields = {};
  const text = String(body || '');
  const lines = text.split(/\r?\n/);
  let current = null;
  let buf = [];
  function storeKey(rawKey, val) {
    if (!rawKey) return;
    fields[rawKey] = val;
    const noStar = rawKey.replace(/\s*\*+$/, '').trim();
    if (noStar) fields[noStar] = val;
    const noParen = noStar.replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (noParen) fields[noParen] = val;
  }
  function flush() {
    if (current !== null) {
      const val = buf
        .join('\n')
        .trim()
        .replace(/^_No response_$/im, '')
        .trim();
      storeKey(current, val);
    }
  }
  for (const line of lines) {
    const m = line.match(/^###\s+(.+?)\s*$/);
    if (m) {
      flush();
      current = m[1].trim().toLowerCase();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();

  // Fallback: if the issue body contains a fenced ```yaml block (e.g. from
  // the WebUI Share/Publish link) and no explicit 'recipe yaml' field was set,
  // extract the fenced YAML block.
  if (!fields['recipe yaml']) {
    const ym = text.match(/```ya?ml\s*\r?\n([\s\S]*?)```/i);
    if (ym && ym[1] && ym[1].trim()) {
      storeKey('recipe yaml', ym[1].trim());
    }
  }
  return fields;
}

function get(fields, ...names) {
  for (const n of names) {
    const k = String(n).toLowerCase().trim();
    if (fields[k] !== undefined && String(fields[k]).trim() !== '') {
      return String(fields[k]).trim();
    }
  }
  return '';
}

function parseCheckboxList(raw) {
  // Form checkboxes render as "- [x] Label" lines; also supports comma-separated harness IDs.
  const out = [];
  const labelToId = {
    opencode: 'opencode',
    'claude code': 'claude-code',
    'claude-code': 'claude-code',
    'codex cli': 'codex',
    codex: 'codex',
    'gemini cli': 'gemini-cli',
    'gemini-cli': 'gemini-cli',
    cursor: 'cursor',
    windsurf: 'windsurf',
    'github copilot': 'copilot',
    copilot: 'copilot',
    'universal / multi-harness': 'universal',
    universal: 'universal',
    pi: 'universal',
  };
  const str = String(raw || '').trim();
  if (!str) return out;

  for (const line of str.split(/\r?\n/)) {
    const m = line.match(/^-\s*\[[xX]\]\s*(.+)$/);
    if (!m) continue;
    let label = m[1].trim();
    const paren = label.match(/^(.*)\(([^)]+)\)\s*$/);
    if (paren) label = paren[2].trim();
    const id = labelToId[label.toLowerCase()];
    if (id && !out.includes(id)) out.push(id);
  }

  if (out.length === 0 && !str.includes('- [')) {
    for (const token of str.split(/[,;\s]+/)) {
      const id = labelToId[token.trim().toLowerCase()];
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

function normalizeMcpSelectionItem(sel, i) {
  if (typeof sel === 'string') return { server: sel.trim(), tools: ['*'] };
  if (sel && typeof sel === 'object' && typeof sel.server === 'string' && sel.server.trim()) {
    const out = { server: sel.server.trim() };
    const denied = new Set(
      (Array.isArray(sel.deniedTools) ? sel.deniedTools : (Array.isArray(sel.denied_tools) ? sel.denied_tools : []))
        .map((t) => String(t).trim())
        .filter(Boolean)
    );
    if (Array.isArray(sel.tools)) {
      const filtered = sel.tools
        .map((t) => String(t).trim())
        .filter((t) => t && !denied.has(t));
      out.tools = filtered.length > 0 ? filtered : ['*'];
    } else {
      out.tools = ['*'];
    }
    return out;
  }
  throw new Error(`MCP selections entry at index ${i} must be a string or { server, ... } object`);
}

function parseMcpSelections(raw) {
  if (!raw || String(raw).trim() === '') return [];
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (err) {
    throw new Error(`invalid MCP selections JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('MCP selections JSON must be an array');
  return parsed.map((sel, i) => normalizeMcpSelectionItem(sel, i));
}

function buildEntryFromIssue(issue, rootDir) {
  const fields = parseIssueBody((issue && issue.body) || '');
  const { ids, taxonomy } = loadTaxonomy(rootDir);
  const validHarnesses = new Set(((taxonomy && taxonomy.harnesses) || []).map((h) => h.id));

  const titleStr = String((issue && issue.title) || '').trim();
  const isAgentForm =
    get(fields, 'system prompt', 'agent name / slug', 'agent name', 'recipe yaml') !== '' ||
    /^\[agent\]/i.test(titleStr) ||
    /^publish agent:/i.test(titleStr);

  let doc;
  if (isAgentForm) {
    const recipeYaml = get(fields, 'recipe yaml', 'recipe');
    let recipe = null;
    if (recipeYaml) {
      try {
        const loaded = yaml.load(recipeYaml);
        if (loaded && typeof loaded === 'object') recipe = loaded;
      } catch (err) {
        throw new Error(`invalid recipe YAML: ${err.message}`);
      }
    }

    const titleFallback = titleStr
      .replace(/^\[agent\]\s*/i, '')
      .replace(/^publish agent:\s*/i, '')
      .trim();
    const agentName =
      get(fields, 'agent name / slug', 'agent name', 'entry name') ||
      (recipe && (recipe.slug || recipe.name || recipe.id)) ||
      get(fields, 'title') ||
      titleFallback;

    const id = slugify(agentName);
    if (!id || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      throw new Error(`derived agent id '${id}' is invalid`);
    }

    const description =
      get(fields, 'description') ||
      (recipe && recipe.description) ||
      'Agent preset submitted via publish-agent form.';

    const rawHarness = (
      get(fields, 'target harness', 'harness') ||
      (recipe && recipe.harness) ||
      'universal'
    ).toLowerCase();
    const mappedHarness = rawHarness === 'claude' ? 'claude-code' : (rawHarness.startsWith('opencode') ? 'opencode' : rawHarness);
    const harness = validHarnesses.has(mappedHarness) ? mappedHarness : 'universal';

    const skills = get(fields, 'skills')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (skills.length === 0 && recipe && Array.isArray(recipe.skills)) {
      for (const s of recipe.skills) {
        if (s && String(s).trim()) skills.push(String(s).trim());
      }
    }

    let mcpSelections = [];
    const rawMcpField = get(fields, 'mcp selections (json)', 'mcp selections', 'mcp');
    if (rawMcpField) {
      mcpSelections = parseMcpSelections(rawMcpField);
    } else if (recipe && Array.isArray(recipe.mcp_selections || recipe.mcpSelections)) {
      const arr = recipe.mcp_selections || recipe.mcpSelections;
      mcpSelections = arr.map((sel, i) => normalizeMcpSelectionItem(sel, i));
    }

    let recipePrompt = get(fields, 'system prompt', 'prompt');
    if (!recipePrompt && recipe && recipe.prompt) {
      recipePrompt = String(recipe.prompt).trim();
    }
    if (!recipePrompt) {
      throw new Error('publish-agent issue is missing the system prompt');
    }

    const modelVal = get(fields, 'model') || (recipe && recipe.model ? String(recipe.model).trim() : '');
    const modeVal =
      (recipe && (recipe.mode === 'primary' || recipe.mode === 'subagent') && recipe.mode) ||
      'subagent';

    const categoryField = get(fields, 'category');
    const agentCategory =
      categoryField && ids.has(categoryField) && categoryField.startsWith('agents/')
        ? categoryField
        : 'agents/security-auditors';

    doc = {
      id,
      name: String(agentName).trim(),
      repo: 'https://github.com/Heretek-AI/Agent-Builder',
      tagline: String(description).replace(/\s+/g, ' ').trim().slice(0, 120) || String(agentName).trim(),
      description: String(description).trim(),
      kind: 'agent',
      category: agentCategory,
      harnesses: [harness],
      agent_preset: {
        mode: modeVal,
        ...(modelVal ? { model: modelVal } : {}),
        prompt: recipePrompt,
        skills,
        mcp_selections: mcpSelections,
      },
      license: 'MIT',
      source_attribution: 'Submitted via Agent-Builder publish-agent issue form (MIT).',
      synthetic: true,
    };
  } else {
    const titleFallback = titleStr
      .replace(/^\[entry\]\s*/i, '')
      .replace(/^<\s*entry name\s*>$/i, '')
      .trim();
    const name = get(fields, 'entry name', 'name') || titleFallback;
    const kind = get(fields, 'kind').toLowerCase();
    const category = get(fields, 'category');
    const repo = get(fields, 'repository url', 'repo', 'repository');
    const tagline = get(fields, 'tagline');
    const description = get(fields, 'description') || tagline;

    if (!name) throw new Error('add-entry issue is missing the entry name');
    if (!Object.prototype.hasOwnProperty.call(KIND_TO_FOLDER, kind)) {
      throw new Error(`invalid kind '${kind || '(missing)'}': must be one of ${Object.keys(KIND_TO_FOLDER).join(', ')}`);
    }
    if (!ids.has(category)) {
      throw new Error(`unknown category '${category || '(missing)'}' (not in data/taxonomy.json)`);
    }
    if (!/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(repo)) {
      throw new Error(`invalid repo URL '${repo || '(missing)'}'`);
    }
    if (!tagline) throw new Error('add-entry issue is missing the tagline');

    let harnesses = parseCheckboxList(get(fields, 'supported harnesses', 'harnesses'));
    harnesses = harnesses.filter((h) => validHarnesses.has(h));
    if (harnesses.length === 0) harnesses = ['universal'];

    const languages = get(fields, 'languages')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const license = get(fields, 'license') || 'MIT';

    doc = {
      id: slugify(name),
      name,
      repo,
      tagline: String(tagline).replace(/\s+/g, ' ').trim().slice(0, 120),
      description,
      kind,
      category,
      harnesses,
      ...(languages.length > 0 ? { languages } : {}),
      license,
      source_attribution: `Submitted via Agent-Builder add-entry issue form from ${repo} (${license}).`,
    };
  }

  const check = validateEntryObject(doc, rootDir);
  if (!check.valid) {
    throw new Error(`generated entry failed schema validation: ${(check.errors || []).join('; ')}`);
  }

  const folder = KIND_TO_FOLDER[doc.kind];
  let subpath = doc.category;
  if (subpath === folder) subpath = '';
  else if (subpath.startsWith(`${folder}/`)) subpath = subpath.slice(folder.length + 1);
  const outAbs = subpath
    ? path.join(rootDir, 'data', folder, subpath, `${doc.id}.yaml`)
    : path.join(rootDir, 'data', folder, `${doc.id}.yaml`);
  const relPath = path.relative(rootDir, outAbs).replace(/\\/g, '/');

  const ordered = {};
  for (const key of KEY_ORDER) {
    if (Object.prototype.hasOwnProperty.call(doc, key)) ordered[key] = doc[key];
  }
  const text = yaml.dump(ordered, { lineWidth: 100, noRefs: true, sortKeys: false });

  return { doc, outAbs, relPath, text, isAgentForm };
}

function gitExec(args, options) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(options || {}),
  });
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

function githubHeaders(token) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'agent-builder-submit-entry',
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

async function openPullRequestForEntry(rootDir, built, issue) {
  const token = process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPOSITORY || '';
  if (!token) fail('--open-pr requires GITHUB_TOKEN in the environment');
  if (!repo || !/^[^/]+\/[^/]+$/.test(repo)) {
    fail('--open-pr requires GITHUB_REPOSITORY=owner/repo in the environment');
  }

  const issueNumber = issue && issue.number ? Number(issue.number) : null;
  const { data: repoInfo } = await rest(`/repos/${repo}`, { token });
  const base = (repoInfo && repoInfo.default_branch) || 'main';
  const branchPrefix = built.isAgentForm ? 'agent' : 'entry';
  const branch = `${branchPrefix}/${built.doc.id}`;

  // Clear any checkout-persisted extraheader in .git/config so gitAuthEnv
  // never causes duplicate Authorization headers during fetch/push.
  try {
    gitExec(['config', '--local', '--unset-all', 'http.https://github.com/.extraheader']);
  } catch (_e) {
    // Key was not set in local config; safe to ignore.
  }

  try {
    gitExec(['fetch', 'origin', base], { env: gitAuthEnv(token) });
  } catch (_e) {
    // Offline/local fallback.
  }
  try {
    gitExec(['checkout', '-B', branch, `origin/${base}`]);
  } catch (_e) {
    gitExec(['checkout', '-B', branch, base]);
  }

  if (fs.existsSync(built.outAbs)) {
    throw new Error(`refusing to overwrite existing file '${built.relPath}'`);
  }
  fs.mkdirSync(path.dirname(built.outAbs), { recursive: true });
  fs.writeFileSync(built.outAbs, built.text, { encoding: 'utf8', flag: 'wx' });

  gitExec(['add', built.relPath]);
  const commitTitle = `docs: add ${built.doc.name} to ${built.doc.category}`;
  gitExec([
    '-c', 'user.name=agent-builder-bot',
    '-c', 'user.email=agent-builder-bot@users.noreply.github.com',
    'commit', '-m', commitTitle,
  ]);
  gitExec(['push', '--force', '--set-upstream', 'origin', branch], {
    env: gitAuthEnv(token),
  });

  const prBodyLines = [
    issueNumber ? `Automated catalog entry generated from #${issueNumber}.` : 'Automated catalog entry generated from issue submission.',
    '',
    `- **ID**: \`${built.doc.id}\``,
    `- **Kind**: \`${built.doc.kind}\``,
    `- **Category**: \`${built.doc.category}\``,
    `- **File**: \`${built.relPath}\``,
    ...(issueNumber ? ['', `Closes #${issueNumber}`] : []),
  ];

  let { ok: pok, status: pstatus, data: pr } = await rest(`/repos/${repo}/pulls`, {
    method: 'POST',
    token,
    body: {
      title: commitTitle,
      head: branch,
      base,
      body: prBodyLines.join('\n'),
    },
  });

  // If HTTP 422, an open PR for this branch may already exist.
  if (!pok && pstatus === 422) {
    const owner = repo.split('/')[0];
    const existing = await rest(
      `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
      { token }
    );
    if (existing.ok && Array.isArray(existing.data) && existing.data.length > 0) {
      pok = true;
      pr = existing.data[0];
    }
  }

  if (pok && pr && pr.number) {
    await rest(`/repos/${repo}/issues/${pr.number}/labels`, {
      method: 'POST',
      token,
      body: {
        labels: [
          built.isAgentForm ? 'new-agent' : 'new-entry',
          `category: ${built.doc.category}`,
        ],
      },
    }).catch(() => null);

    if (issueNumber) {
      await rest(`/repos/${repo}/issues/${issueNumber}/comments`, {
        method: 'POST',
        token,
        body: {
          body: `✅ Converted issue into catalog entry \`${built.relPath}\` and opened pull request #${pr.number}.`,
        },
      }).catch(() => null);
    }
    console.log(`SUBMIT_PR_OK: wrote ${built.relPath} on ${branch} -> PR #${pr.number}`);
    return;
  }

  // Branch was pushed, but PR creation was blocked (e.g. repo settings disallow Actions PRs).
  const compareUrl = `https://github.com/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?quick_pull=1&title=${encodeURIComponent(commitTitle)}`;
  const apiMsg = pr && pr.message ? redactSecrets(pr.message, token) : `HTTP ${pstatus}`;
  if (issueNumber) {
    await rest(`/repos/${repo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      token,
      body: {
        body: [
          `✅ Pushed catalog entry \`${built.relPath}\` to branch [\`${branch}\`](https://github.com/${repo}/tree/${encodeURIComponent(branch)}).`,
          '',
          `👉 **[Click here to open the Pull Request](${compareUrl})**`,
          '',
          `_(Automatic PR creation returned \`${apiMsg}\`. To let GitHub Actions open PRs directly, enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**.)_`,
        ].join('\n'),
      },
    }).catch(() => null);
  }
  console.log(`SUBMIT_BRANCH_OK: pushed ${built.relPath} to ${branch} (compare: ${compareUrl})`);
}

async function runMain() {
  const rootDir = path.join(__dirname, '..');
  const args = parseArgs(process.argv);
  if (!args.issue) fail('missing required argument --issue <file.json> (see --help)');
  const issueAbs = path.isAbsolute(args.issue) ? args.issue : path.join(rootDir, args.issue);
  if (!fs.existsSync(issueAbs)) fail(`issue file not found: '${args.issue}'`);
  let issue;
  try {
    issue = JSON.parse(fs.readFileSync(issueAbs, 'utf8'));
  } catch (err) {
    fail(`unable to parse issue JSON: ${err.message}`);
  }

  // When running live with --open-pr and an issue number, refresh from GitHub API
  // if body is missing or if triggered via workflow_dispatch with only a number.
  const token = process.env.GITHUB_TOKEN || '';
  const repo = process.env.GITHUB_REPOSITORY || '';
  if (args.openPr && !args.dryRun && token && repo && issue && issue.number && !issue.body) {
    const fetched = await rest(`/repos/${repo}/issues/${Number(issue.number)}`, { token });
    if (fetched.ok && fetched.data) {
      issue = fetched.data;
    }
  }

  let built;
  try {
    built = buildEntryFromIssue(issue, rootDir);
  } catch (err) {
    if (args.openPr && !args.dryRun && token && repo && issue && issue.number) {
      await rest(`/repos/${repo}/issues/${Number(issue.number)}/comments`, {
        method: 'POST',
        token,
        body: {
          body: `❌ Could not convert this issue into a catalog entry:\n\n\`\`\`\n${redactSecrets(err.message, token)}\n\`\`\`\n\nPlease edit the issue fields and re-save to trigger conversion again.`,
        },
      }).catch(() => null);
    }
    fail(err.message);
  }

  if (args.dryRun) {
    console.log(built.text);
    console.log(`SUBMIT_OK (dry-run): would write ${built.relPath}`);
    return;
  }

  if (args.openPr) {
    try {
      await openPullRequestForEntry(rootDir, built, issue);
    } catch (err) {
      if (token && repo && issue && issue.number) {
        await rest(`/repos/${repo}/issues/${Number(issue.number)}/comments`, {
          method: 'POST',
          token,
          body: {
            body: `❌ Failed while creating branch/PR for \`${built.relPath}\`:\n\n\`\`\`\n${redactSecrets(err.message, token)}\n\`\`\``,
          },
        }).catch(() => null);
      }
      fail(redactSecrets(err.message, token));
    }
    return;
  }

  if (fs.existsSync(built.outAbs)) {
    fail(`refusing to overwrite existing file '${built.relPath}'`);
  }
  fs.mkdirSync(path.dirname(built.outAbs), { recursive: true });
  fs.writeFileSync(built.outAbs, built.text, 'utf8');
  console.log(`SUBMIT_OK: wrote ${built.relPath}`);
}

if (require.main === module) {
  Promise.resolve(runMain()).catch((err) => {
    fail(err && err.message ? err.message : String(err));
  });
}

module.exports = {
  KIND_TO_FOLDER,
  KEY_ORDER,
  parseArgs,
  parseIssueBody,
  parseCheckboxList,
  parseMcpSelections,
  buildEntryFromIssue,
  gitAuthEnv,
  redactSecrets,
};
