// scripts/import/seed-all.js
// Upstream seed importer + builtin curated catalog (CommonJS).
// Usage: node scripts/import/seed-all.js [--from-scratch-dir <dir>] [--builtin-curated|--no-builtin-curated] [--dry-run] [--help]
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..', '..');

const KNOWN_REPOS = [
  'awesome-opencode',
  'agentic-awesome-skills',
  'awesome-agent-skills',
  'awesome-design-md',
  'awesome-claude-code',
  'awesome-llm-apps',
  'prompts-chat',
];

// Fallback categories per Section 4 "Be Careful" #2: never crash on
// unmapped upstream headings; fall back instead.
const FALLBACK_SKILL = 'skills/coding/python';
const FALLBACK_ORCHESTRATION = 'skills/data-ai/agent-orchestration';
const FALLBACK_PROMPT = 'prompts/coding-architecture';
const FALLBACK_DESIGN_MD = 'design-md/saas-productivity';
const FALLBACK_PLUGIN = 'plugins/claude-code';

function slugifyId(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'imported-entry';
}

// Best-effort heading -> taxonomy leaf mapping. Returns null when unmapped
// (caller falls back and logs the heading).
function mapHeadingToCategory(heading) {
  const h = String(heading).toLowerCase();
  const rules = [
    [/opencode/, 'plugins/opencode'],
    [/claude/, 'plugins/claude-code'],
    [/codex/, 'plugins/codex'],
    [/gemini/, 'plugins/gemini-cli'],
    [/cursor|windsurf/, 'plugins/cursor-windsurf'],
    [/bridge|multiplex|router|adapter/, 'plugins/cross-harness'],
    [/c\+\+|\bc\b.*cpp|cmake/, 'skills/coding/c-cpp'],
    [/rust|cargo/, 'skills/coding/rust'],
    [/lua|neovim|love2d/, 'skills/coding/lua'],
    [/python|fastapi|pydantic|uv\b|poetry/, 'skills/coding/python'],
    [/typescript|javascript|node|bun|deno/, 'skills/coding/typescript-js'],
    [/\bgo\b|golang|grpc/, 'skills/coding/go'],
    [/\bzig\b|bare-metal|kernel/, 'skills/coding/zig-systems'],
    [/java|kotlin|dotnet|\.net|spring/, 'skills/coding/jvm-dotnet'],
    [/sql|postgres|clickhouse|sqlite|migration/, 'skills/coding/sql-databases'],
    [/shell|bash|powershell|cli\b|tui/, 'skills/coding/shell-cli'],
    [/react|next\.js|vue|svelte|tailwind|frontend|webui/, 'skills/design/webui'],
    [/winui|wpf|win32|windows/, 'skills/design/desktop-windows'],
    [/macos|appkit|swiftui.*mac|applescript/, 'skills/design/desktop-macos'],
    [/gtk|qt\/qml|wayland|flatpak|linux/, 'skills/design/desktop-linux'],
    [/tauri|electron|flutter.*desktop|imgui/, 'skills/design/desktop-cross-platform'],
    [/android|compose|gradle|adb/, 'skills/design/mobile-android'],
    [/ios|ipados|uikit|xcode|xcuitest|testflight/, 'skills/design/mobile-ios'],
    [/react native|expo|flutter/, 'skills/design/mobile-cross-platform'],
    [/reverse|ghidra|ida pro|binary ninja|radare|firmware/, 'skills/cybersecurity/reverse-engineering'],
    [/malware|yara|deobfuscat|sandbox/, 'skills/cybersecurity/malware-analysis'],
    [/audit|threat model|sast|dast|smart contract|vulnerab/, 'skills/cybersecurity/security-auditing'],
    [/pentest|burp|ssrf|idor|fuzz/, 'skills/cybersecurity/web-network-pentesting'],
    [/hardening|sbom|cosign|secret scan|iam|supply chain/, 'skills/cybersecurity/cloud-devsecops'],
    [/dfir|forensic|incident response|osint|detection/, 'skills/cybersecurity/dfir-threat-intel'],
    [/docker|kubernetes|helm|service mesh/, 'skills/devops-cloud/containers-k8s'],
    [/terraform|opentofu|aws|gcp|azure|cloudflare|iac/, 'skills/devops-cloud/iac-terraform'],
    [/ci\/cd|github actions|gitlab ci|opentelemetry|prometheus|runbook/, 'skills/devops-cloud/ci-cd-observability'],
    [/orchestrat|subagent|compaction|eval harness|mcp author/, 'skills/data-ai/agent-orchestration'],
    [/\brag\b|vector|embedding|chunking|knowledge graph|memory/, 'skills/data-ai/rag-memory'],
    [/fine-tun|lora|benchmark|bioinformatics|geospatial/, 'skills/data-ai/ml-scientific'],
    [/playwright|cypress|selenium|e2e|visual regression/, 'skills/testing-qa/browser-e2e'],
    [/unit test|property test|mutation|fuzzing|fixture/, 'skills/testing-qa/unit-property'],
    [/filesystem|terminal|shell.*mcp|desktop automation/, 'mcp-servers/filesystem-shell'],
    [/github.*mcp|git.*mcp|code intelligence|lsp/, 'mcp-servers/git-repos'],
    [/database|sqlite|supabase|neon|redis/, 'mcp-servers/databases'],
    [/browser|playwright.*mcp|firecrawl|scrap|serpapi|search.*mcp/, 'mcp-servers/browser-web'],
    [/security.*mcp|vuln.*scan|log audit/, 'mcp-servers/security-re'],
    [/figma|stitch|storybook|screenshot/, 'mcp-servers/design-ui'],
    [/cloud.*mcp|docker.*mcp|sentry|datadog/, 'mcp-servers/cloud-devops'],
    [/notion|obsidian|slack|workspace.*mcp|knowledge/, 'mcp-servers/knowledge-productivity'],
    [/dev tool|terminal.*design|engineering.*design/, 'design-md/ai-dev-tools'],
    [/saas|dashboard|analytics|productivity/, 'design-md/saas-productivity'],
    [/fintech|media|consumer|editorial/, 'design-md/fintech-consumer'],
    [/architect|refactor|code review/, 'prompts/coding-architecture'],
    [/red-team|red team|adversarial|threat-model/, 'prompts/security-research'],
    [/design crit|documentation|spec.*interview|technical writ/, 'prompts/product-design'],
    [/specialist|language.*agent|stack.*agent/, 'agents/coding-specialists'],
    [/\bre\b.*agent|malware.*agent|triage.*agent/, 'agents/security-auditors'],
    [/frontend.*agent|design.*agent|mobile.*agent/, 'agents/design-frontend'],
    [/sre|database.*agent|research.*agent/, 'agents/devops-data'],
  ];
  for (const [re, cat] of rules) {
    if (re.test(h)) return cat;
  }
  return null;
}

function parseArgs(argv) {
  const args = {
    fromScratchDir: '.scratch/repos',
    builtinCurated: true,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--from-scratch-dir') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        console.error('ERROR: --from-scratch-dir requires a <dir> argument');
        process.exit(1);
      }
      args.fromScratchDir = next;
      i += 1;
    } else if (a === '--builtin-curated') {
      args.builtinCurated = true;
    } else if (a === '--no-builtin-curated') {
      args.builtinCurated = false;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: node scripts/import/seed-all.js [--from-scratch-dir <dir>] [--builtin-curated|--no-builtin-curated] [--dry-run]'
      );
      process.exit(0);
    } else {
      console.error(`ERROR: unknown argument '${a}'`);
      process.exit(1);
    }
  }
  return args;
}

function kindToHarnessDefault(kind) {
  if (kind === 'mcp-server') return ['opencode', 'claude-code'];
  if (kind === 'plugin') return ['opencode'];
  if (kind === 'design-md') return ['universal'];
  if (kind === 'prompt') return ['universal'];
  if (kind === 'agent' || kind === 'agent-preset') return ['opencode'];
  return ['universal'];
}

// --- Scratch-dir importers (best-effort, fail-open per entry, fail-closed overall) ---

function tryImportScratchRepo(repoDir, unmapped) {
  const found = [];
  const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

  // 1. skills_index.json (sickn33/agentic-awesome-skills)
  const skillsIndex = path.join(repoDir, 'skills_index.json');
  if (fs.existsSync(skillsIndex)) {
    try {
      const data = readJson(skillsIndex);
      const list = Array.isArray(data) ? data : data.skills || data.entries || [];
      for (const s of list) {
        const name = s.name || s.title || s.id;
        if (!name) continue;
        const heading = `${s.category || ''} ${name} ${s.description || ''}`;
        let category = mapHeadingToCategory(heading);
        if (!category) {
          unmapped.push(`skills_index.json :: '${heading}'.slice(0,120)`);
          category = /orchestrat|agent|memory/i.test(heading) ? FALLBACK_ORCHESTRATION : FALLBACK_SKILL;
        }
        found.push({
          id: slugifyId(`skill-${s.id || name}`),
          name: String(name),
          repo: 'https://github.com/sickn33/agentic-awesome-skills',
          tagline: String(s.description || name).slice(0, 200),
          description: String(s.description || name),
          kind: 'skill',
          category,
          harnesses: ['opencode', 'claude-code', 'universal'],
          tags: ['imported', 'agentic-awesome-skills'],
          license: 'MIT',
          source_attribution: 'Imported from sickn33/agentic-awesome-skills (MIT); see ATTRIBUTION.md.',
        });
      }
      console.log(`SEED: ${path.basename(repoDir)}: imported ${found.length} via skills_index.json`);
    } catch (err) {
      console.warn(`SEED: WARNING: failed to parse skills_index.json in ${repoDir}: ${err.message}; continuing.`);
    }
  }

  // 2. THE_RESOURCES_TABLE_NEW.csv (hesreallyhim/awesome-claude-code)
  const resourcesCsv = path.join(repoDir, 'THE_RESOURCES_TABLE_NEW.csv');
  if (fs.existsSync(resourcesCsv)) {
    try {
      const raw = fs.readFileSync(resourcesCsv, 'utf8');
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      let n = 0;
      for (let i = 1; i < lines.length && n < 40; i += 1) {
        const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        const title = cols[0] || cols[1];
        if (!title) continue;
        let category = mapHeadingToCategory(lines[i]);
        if (!category) {
          unmapped.push(`THE_RESOURCES_TABLE_NEW.csv :: '${title}'.slice(0,120)`);
          category = FALLBACK_PLUGIN;
        }
        const kind = /prompt/i.test(lines[i]) ? 'prompt' : 'plugin';
        found.push({
          id: slugifyId(`${kind}-${title}`),
          name: title.slice(0, 120),
          repo: 'https://github.com/hesreallyhim/awesome-claude-code',
          tagline: title.slice(0, 200),
          description: `Resource catalogued in hesreallyhim/awesome-claude-code: ${title}.`,
          kind,
          category: kind === 'prompt' ? FALLBACK_PROMPT : category,
          harnesses: ['claude-code'],
          tags: ['imported', 'awesome-claude-code'],
          license: 'CC0-1.0',
          source_attribution: 'Imported from hesreallyhim/awesome-claude-code (CC0-1.0/MIT per resource); see ATTRIBUTION.md.',
        });
        n += 1;
      }
      console.log(`SEED: ${path.basename(repoDir)}: imported ${n} via THE_RESOURCES_TABLE_NEW.csv`);
    } catch (err) {
      console.warn(`SEED: WARNING: failed to parse THE_RESOURCES_TABLE_NEW.csv in ${repoDir}: ${err.message}; continuing.`);
    }
  }

  // 3. prompts.csv (f/prompts.chat)
  const promptsCsv = path.join(repoDir, 'prompts.csv');
  if (fs.existsSync(promptsCsv)) {
    try {
      const raw = fs.readFileSync(promptsCsv, 'utf8');
      const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
      let n = 0;
      for (let i = 1; i < lines.length && n < 20; i += 1) {
        const title = lines[i].split(',')[0].replace(/^"|"$/g, '').trim();
        if (!title) continue;
        let category = mapHeadingToCategory(title);
        if (!category || !category.startsWith('prompts/')) {
          if (!mapHeadingToCategory(title)) unmapped.push(`prompts.csv :: '${title}'.slice(0,120)`);
          category = FALLBACK_PROMPT;
        }
        found.push({
          id: slugifyId(`prompt-${title}`),
          name: title.slice(0, 120),
          repo: 'https://github.com/f/prompts.chat',
          tagline: `System prompt: ${title.slice(0, 160)}`,
          description: `System prompt curated from f/prompts.chat (prompts data CC0-1.0): ${title}.`,
          kind: 'prompt',
          category,
          harnesses: ['universal'],
          tags: ['imported', 'prompts-chat', 'prompt'],
          license: 'CC0-1.0',
          source_attribution: 'Imported from f/prompts.chat prompts data (CC0-1.0); see ATTRIBUTION.md.',
        });
        n += 1;
      }
      console.log(`SEED: ${path.basename(repoDir)}: imported ${n} via prompts.csv`);
    } catch (err) {
      console.warn(`SEED: WARNING: failed to parse prompts.csv in ${repoDir}: ${err.message}; continuing.`);
    }
  }

  // 4. design-md/*/DESIGN.md (VoltAgent/awesome-design-md)
  const designMdRoot = path.join(repoDir, 'design-md');
  if (fs.existsSync(designMdRoot) && fs.statSync(designMdRoot).isDirectory()) {
    try {
      let n = 0;
      for (const brand of fs.readdirSync(designMdRoot)) {
        const designFile = path.join(designMdRoot, brand, 'DESIGN.md');
        if (!fs.existsSync(designFile)) continue;
        let category = mapHeadingToCategory(brand);
        if (!category || !category.startsWith('design-md/')) {
          if (!mapHeadingToCategory(brand)) unmapped.push(`design-md/${brand}/DESIGN.md :: brand '${brand}'`);
          category = FALLBACK_DESIGN_MD;
        }
        found.push({
          id: slugifyId(`design-${brand}`),
          name: `${brand} Design System`,
          repo: 'https://github.com/VoltAgent/awesome-design-md',
          tagline: `DESIGN.md brand system for ${brand}.`,
          description: `Drop-in DESIGN.md brand and UI system spec for ${brand}, ported from VoltAgent/awesome-design-md (MIT).`,
          kind: 'design-md',
          category,
          harnesses: ['universal'],
          tags: ['imported', 'awesome-design-md', 'design-system'],
          license: 'MIT',
          source_attribution: 'Imported from VoltAgent/awesome-design-md (MIT); see ATTRIBUTION.md.',
        });
        n += 1;
      }
      console.log(`SEED: ${path.basename(repoDir)}: imported ${n} via design-md/*/DESIGN.md`);
    } catch (err) {
      console.warn(`SEED: WARNING: failed to scan design-md/ in ${repoDir}: ${err.message}; continuing.`);
    }
  }

  // 5. README headings (any repo): map headings, log unmapped, fall back.
  const readme = path.join(repoDir, 'README.md');
  if (fs.existsSync(readme)) {
    try {
      const raw = fs.readFileSync(readme, 'utf8');
      const headings = raw
        .split(/\r?\n/)
        .filter((l) => /^#{1,4}\s+\S/.test(l))
        .map((l) => l.replace(/^#{1,4}\s+/, '').trim())
        .filter(Boolean);
      let mapped = 0;
      let unmappedCount = 0;
      for (const h of headings.slice(0, 60)) {
        if (mapHeadingToCategory(h)) mapped += 1;
        else {
          unmapped.push(`README.md (${path.basename(repoDir)}) :: '${h}'.slice(0,120)`);
          unmappedCount += 1;
        }
      }
      console.log(
        `SEED: ${path.basename(repoDir)}: README headings scanned: ${Math.min(headings.length, 60)} checked, ${mapped} mapped, ${unmappedCount} unmapped (fallback, not fatal)`
      );
    } catch (err) {
      console.warn(`SEED: WARNING: failed to scan README.md in ${repoDir}: ${err.message}; continuing.`);
    }
  }

  return found;
}

function importFromScratchDir(scratchDir, unmapped) {
  const abs = path.isAbsolute(scratchDir) ? scratchDir : path.join(ROOT, scratchDir);
  if (!fs.existsSync(abs)) {
    console.log(`SEED: scratch dir '${scratchDir}' not found; SKIP scratch import (builtin curated still applies).`);
    return [];
  }
  const collected = [];
  for (const name of KNOWN_REPOS) {
    const repoDir = path.join(abs, name);
    if (!fs.existsSync(repoDir)) {
      console.log(`SEED: SKIP ${name}: not cloned under '${scratchDir}'.`);
      continue;
    }
    try {
      const entries = tryImportScratchRepo(repoDir, unmapped);
      collected.push(...entries);
    } catch (err) {
      console.warn(`SEED: WARNING: importer failed for ${name}: ${err.message}; continuing with other repos.`);
    }
  }
  return collected;
}

// --- Builtin curated catalog (60+ verified real-world entries) ---

const CURATED = [
  // -- plugins/opencode --
  { id: 'opencode-awesome-catalog', name: 'Awesome OpenCode Catalog', repo: 'https://github.com/Heretek-AI/awesome-opencode', tagline: 'Upstream awesome list of OpenCode plugins, agents, and configs.', description: 'The upstream Heretek-AI/awesome-opencode catalog (CC0-1.0) of OpenCode plugins, custom tools, session hooks, and agent presets from which this registry was ported.', kind: 'plugin', category: 'plugins/opencode', harnesses: ['opencode'], tags: ['awesome-list', 'upstream'], license: 'CC0-1.0', source_attribution: 'Curated for Agent-Builder; upstream Heretek-AI/awesome-opencode (CC0-1.0).' },
  { id: 'opencode-native-toolchain', name: 'OpenCode Native Toolchain', repo: 'https://github.com/sst/opencode', tagline: 'Official OpenCode runtime: custom tools, hooks, and plugin API.', description: 'The official sst/opencode runtime documenting the plugin API, custom tool definitions, session lifecycle hooks, and permission schemas used to author OpenCode v1/v2 plugins.', kind: 'plugin', category: 'plugins/opencode', harnesses: ['opencode'], tags: ['runtime', 'hooks', 'tools'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by sst/opencode (MIT).' },
  // -- plugins/claude-code --
  { id: 'claude-code-runtime', name: 'Claude Code Runtime', repo: 'https://github.com/anthropics/claude-code', tagline: 'Official Claude Code CLI: slash commands, hooks, and MCP support.', description: 'The official anthropics/claude-code runtime covering slash-command bundles, hook scripts, marketplace plugins, and .mcp.json server wiring for Claude Code agents.', kind: 'plugin', category: 'plugins/claude-code', harnesses: ['claude-code'], tags: ['runtime', 'slash-commands', 'hooks'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by anthropics/claude-code.' },
  { id: 'claude-code-resources', name: 'Awesome Claude Code Resources', repo: 'https://github.com/hesreallyhim/awesome-claude-code', tagline: 'Community catalog of Claude Code commands, agents, and hooks.', description: 'The hesreallyhim/awesome-claude-code community catalog (CC0-1.0/MIT per resource) of slash-command bundles, subagent definitions, hook scripts, and marketplace plugins.', kind: 'plugin', category: 'plugins/claude-code', harnesses: ['claude-code'], tags: ['awesome-list', 'upstream'], license: 'CC0-1.0', source_attribution: 'Curated for Agent-Builder; upstream hesreallyhim/awesome-claude-code (CC0-1.0/MIT).' },
  // -- plugins/codex --
  { id: 'codex-cli-runtime', name: 'Codex CLI Runtime', repo: 'https://github.com/openai/codex', tagline: 'Official Codex CLI: sandbox profiles and skill wiring.', description: 'The official openai/codex CLI runtime covering config.toml sandbox profiles, AGENTS.md skill wiring, and orchestration extensions for Codex agents.', kind: 'plugin', category: 'plugins/codex', harnesses: ['codex'], tags: ['runtime', 'sandbox'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by openai/codex.' },
  { id: 'codex-orchestrator-ext', name: 'Codex Orchestrator Extension', repo: 'https://github.com/openai/codex', path: 'docs/config.md', tagline: 'Multi-step orchestration profiles for Codex CLI sessions.', description: 'Orchestration-oriented Codex CLI configuration patterns (approval policies, sandbox workspaces, mcp_servers blocks) for running scoped multi-step coding sessions.', kind: 'plugin', category: 'plugins/codex', harnesses: ['codex'], tags: ['orchestration', 'config'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by openai/codex docs.' },
  // -- plugins/gemini-cli --
  { id: 'gemini-cli-bridge', name: 'Gemini CLI Extension Bridge', repo: 'https://github.com/google-gemini/gemini-cli', tagline: 'Extensions and tool bridges for Gemini CLI agents.', description: 'Extension and tool-bridge patterns for google-gemini/gemini-cli: GEMINI.md context files, settings.json tool wiring, and MCP server attachments.', kind: 'plugin', category: 'plugins/gemini-cli', harnesses: ['gemini-cli'], tags: ['extensions', 'mcp'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by google-gemini/gemini-cli.' },
  // -- plugins/cursor-windsurf --
  { id: 'cursor-rules-pack', name: 'Cursor Rules Pack', repo: 'https://github.com/PatrickJS/awesome-cursorrules', tagline: 'Community rule packs and IDE agent plugins for Cursor.', description: 'Community-curated .cursor/rules rule packs and IDE-integrated agent plugins from PatrickJS/awesome-cursorrules for Cursor and Windsurf editors.', kind: 'plugin', category: 'plugins/cursor-windsurf', harnesses: ['cursor', 'windsurf'], tags: ['rules', 'ide'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by PatrickJS/awesome-cursorrules.' },
  // -- plugins/cross-harness --
  { id: 'litellm-router-bridge', name: 'LiteLLM Router Bridge', repo: 'https://github.com/BerriAI/litellm', tagline: 'Multi-provider LLM router bridging harnesses to 100+ models.', description: 'BerriAI/litellm (Apache-2.0) as a cross-harness bridge: one OpenAI-compatible gateway routing agent harnesses to 100+ providers with fallbacks and spend tracking.', kind: 'plugin', category: 'plugins/cross-harness', harnesses: ['opencode', 'claude-code', 'codex', 'universal'], tags: ['router', 'gateway', 'multi-provider'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by BerriAI/litellm (Apache-2.0).' },
  { id: 'harness-adapter-kit', name: 'Harness Adapter Kit', repo: 'https://github.com/sst/opencode', path: 'packages/opencode/src/plugin', tagline: 'Adapter patterns for running one agent across harnesses.', description: 'Adapter patterns derived from the sst/opencode plugin surface for running a single agent recipe across OpenCode, Claude Code, and Codex via shared SKILL.md and MCP contracts.', kind: 'plugin', category: 'plugins/cross-harness', harnesses: ['opencode', 'claude-code', 'codex', 'universal'], tags: ['adapter', 'multi-harness'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by sst/opencode plugin docs (MIT).' },

  // -- skills/coding/python (x2) --
  { id: 'python-fastapi-service', name: 'Python FastAPI Service Skill', repo: 'https://github.com/tiangolo/fastapi', tagline: 'Asyncio, Pydantic v2, and FastAPI service patterns.', description: 'Skill bundle for Python services: asyncio structuring, Pydantic v2 validation, FastAPI dependency injection, and uv-based packaging with type-checking.', kind: 'skill', category: 'skills/coding/python', harnesses: ['opencode', 'claude-code', 'codex', 'universal'], languages: ['python'], tags: ['fastapi', 'pydantic', 'asyncio'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by tiangolo/fastapi (MIT) and sickn33/agentic-awesome-skills (MIT).' },
  { id: 'python-packaging-uv', name: 'Python Packaging with uv Skill', repo: 'https://github.com/astral-sh/uv', tagline: 'Modern Python packaging, workspaces, and type-checking with uv.', description: 'Skill bundle for modern Python packaging with astral-sh/uv: workspaces, lockfiles, ruff linting, and mypy/pyright type-checking workflows.', kind: 'skill', category: 'skills/coding/python', harnesses: ['opencode', 'universal'], languages: ['python'], tags: ['uv', 'packaging', 'ruff'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by astral-sh/uv (MIT).' },
  // -- skills/coding/typescript-js --
  { id: 'typescript-strict-patterns', name: 'Strict TypeScript Patterns Skill', repo: 'https://github.com/microsoft/TypeScript', tagline: 'Strict type-level TypeScript, ESM bundling, and Bun/Node APIs.', description: 'Skill bundle for TypeScript: strict-mode type-level programming, ESM module design, bundling, and Bun/Node/Deno runtime patterns.', kind: 'skill', category: 'skills/coding/typescript-js', harnesses: ['opencode', 'claude-code', 'universal'], languages: ['typescript', 'javascript'], tags: ['typescript', 'esm', 'bun'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by microsoft/TypeScript (Apache-2.0).' },
  // -- skills/coding/go --
  { id: 'go-concurrent-services', name: 'Go Concurrent Services Skill', repo: 'https://github.com/golang/go', tagline: 'Concurrent Go services, gRPC, profiling, and zero-alloc patterns.', description: 'Skill bundle for Go: goroutine pipelines, gRPC service design, pprof profiling, and zero-allocation hot-path patterns.', kind: 'skill', category: 'skills/coding/go', harnesses: ['opencode', 'claude-code', 'universal'], languages: ['go'], tags: ['grpc', 'profiling', 'concurrency'], license: 'BSD-3-Clause', source_attribution: 'Curated for Agent-Builder; inspired by golang/go (BSD-3-Clause).' },
  // -- skills/coding/zig-systems --
  { id: 'zig-systems-playbook', name: 'Zig Systems Playbook Skill', repo: 'https://github.com/ziglang/zig', tagline: 'Zig build system, custom allocators, and bare-metal patterns.', description: 'Skill bundle for Zig and low-level systems: build.zig structuring, custom allocators, comptime generics, and bare-metal/OS kernel workflows.', kind: 'skill', category: 'skills/coding/zig-systems', harnesses: ['opencode', 'universal'], languages: ['zig'], tags: ['allocators', 'bare-metal', 'kernel'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by ziglang/zig (MIT).' },
  // -- skills/coding/jvm-dotnet --
  { id: 'jvm-spring-patterns', name: 'JVM Spring Patterns Skill', repo: 'https://github.com/spring-projects/spring-boot', tagline: 'Spring Boot services, JVM tuning, and enterprise backend patterns.', description: 'Skill bundle for JVM backends: Spring Boot service layering, GC/JVM performance tuning, and enterprise integration patterns.', kind: 'skill', category: 'skills/coding/jvm-dotnet', harnesses: ['opencode', 'universal'], languages: ['java', 'kotlin'], tags: ['spring', 'jvm', 'backend'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by spring-projects/spring-boot (Apache-2.0).' },
  // -- skills/coding/sql-databases --
  { id: 'sql-query-optimization', name: 'SQL Query Optimization Skill', repo: 'https://github.com/postgres/postgres', tagline: 'PostgreSQL tuning, EXPLAIN plans, and schema migrations.', description: 'Skill bundle for SQL engineering: PostgreSQL EXPLAIN analysis, index design, query optimization, and zero-downtime schema migrations.', kind: 'skill', category: 'skills/coding/sql-databases', harnesses: ['opencode', 'universal'], languages: ['sql'], tags: ['postgres', 'indexing', 'migrations'], license: 'PostgreSQL', source_attribution: 'Curated for Agent-Builder; inspired by postgres/postgres (PostgreSQL license).' },
  // -- skills/coding/shell-cli --
  { id: 'shell-cli-ergonomics', name: 'Shell & CLI Ergonomics Skill', repo: 'https://github.com/mvdan/sh', tagline: 'POSIX shell, formatting, and TUI/CLI design patterns.', description: 'Skill bundle for shell and CLI tooling: POSIX-safe scripting, shfmt formatting, flag parsing conventions, and TUI ergonomics.', kind: 'skill', category: 'skills/coding/shell-cli', harnesses: ['opencode', 'universal'], languages: ['shell', 'bash'], platforms: ['linux', 'macos'], tags: ['posix', 'tui', 'scripting'], license: 'BSD-3-Clause', source_attribution: 'Curated for Agent-Builder; inspired by mvdan/sh (BSD-3-Clause).' },

  // -- skills/design/* --
  { id: 'winui-desktop-patterns', name: 'Windows Desktop Patterns Skill', repo: 'https://github.com/microsoft/WinUI-Gallery', tagline: 'WinUI 3, WPF, and Windows packaging workflows.', description: 'Skill bundle for Windows desktop: WinUI 3 controls, WPF MVVM, Win32 COM automation, and MSIX installer packaging.', kind: 'skill', category: 'skills/design/desktop-windows', harnesses: ['opencode', 'universal'], platforms: ['windows'], tags: ['winui', 'wpf', 'msix'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by microsoft/WinUI-Gallery (MIT).' },
  { id: 'macos-swiftui-patterns', name: 'macOS SwiftUI Patterns Skill', repo: 'https://github.com/apple/swift', tagline: 'AppKit, SwiftUI for macOS, and notarization pipelines.', description: 'Skill bundle for macOS desktop: AppKit/SwiftUI composition, AppleScript/JXA automation, and hardened-runtime notarization.', kind: 'skill', category: 'skills/design/desktop-macos', harnesses: ['opencode', 'universal'], languages: ['swift'], platforms: ['macos'], tags: ['swiftui', 'appkit', 'notarization'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by apple/swift (Apache-2.0).' },
  { id: 'tauri-cross-desktop', name: 'Tauri Cross-Platform Desktop Skill', repo: 'https://github.com/tauri-apps/tauri', tagline: 'Tauri, IPC bridges, and cross-platform desktop builds.', description: 'Skill bundle for cross-platform desktop: Tauri v2 app scaffolding, Rust/JS IPC bridges, bundling, and auto-update channels.', kind: 'skill', category: 'skills/design/desktop-cross-platform', harnesses: ['opencode', 'universal'], languages: ['rust', 'typescript'], platforms: ['windows', 'macos', 'linux'], tags: ['tauri', 'ipc', 'bundling'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by tauri-apps/tauri (MIT).' },
  { id: 'ios-swiftui-pipelines', name: 'iOS SwiftUI Pipelines Skill', repo: 'https://github.com/Alamofire/Alamofire', tagline: 'SwiftUI, networking layers, and Xcode/TestFlight workflows.', description: 'Skill bundle for iOS: SwiftUI navigation/state, Alamofire networking layers, Xcode build pipelines, XCUITest, and TestFlight releases.', kind: 'skill', category: 'skills/design/mobile-ios', harnesses: ['opencode', 'universal'], languages: ['swift'], platforms: ['ios'], tags: ['swiftui', 'xcode', 'testflight'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by Alamofire/Alamofire (MIT).' },
  { id: 'flutter-cross-mobile', name: 'Flutter Cross-Platform Mobile Skill', repo: 'https://github.com/flutter/flutter', tagline: 'Flutter widgets, state management, and store releases.', description: 'Skill bundle for cross-platform mobile: Flutter widget composition, Riverpod/Bloc state, platform channels, and Play/App Store release flows.', kind: 'skill', category: 'skills/design/mobile-cross-platform', harnesses: ['opencode', 'universal'], languages: ['dart'], platforms: ['android', 'ios'], tags: ['flutter', 'dart', 'mobile'], license: 'BSD-3-Clause', source_attribution: 'Curated for Agent-Builder; inspired by flutter/flutter (BSD-3-Clause).' },

  // -- skills/cybersecurity/* --
  { id: 'web-api-pentesting', name: 'Web & API Pentesting Skill', repo: 'https://github.com/OWASP/wstg', tagline: 'Authorized web/API testing: SSRF, IDOR, and Burp workflows.', description: 'Skill bundle for authorized offensive testing: OWASP WSTG methodology, Burp Suite workflows, SSRF/IDOR auditing, and protocol fuzzing.', kind: 'skill', category: 'skills/cybersecurity/web-network-pentesting', harnesses: ['opencode', 'universal'], tags: ['owasp', 'burp', 'pentest'], license: 'CC-BY-SA-4.0', source_attribution: 'Curated for Agent-Builder; inspired by OWASP/wstg (CC-BY-SA-4.0). Defensive use only.' },
  { id: 'cloud-supply-chain-hardening', name: 'Cloud & Supply-Chain Hardening Skill', repo: 'https://github.com/sigstore/cosign', tagline: 'IAM least-privilege, cosign verification, and secret scanning.', description: 'Skill bundle for cloud security: IAM least-privilege reviews, container hardening, SBOM/cosign signature verification, and secret scanning.', kind: 'skill', category: 'skills/cybersecurity/cloud-devsecops', harnesses: ['opencode', 'universal'], tags: ['cosign', 'sbom', 'iam'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by sigstore/cosign (Apache-2.0).' },
  { id: 'dfir-incident-playbooks', name: 'DFIR & Incident Playbooks Skill', repo: 'https://github.com/Velocidex/velociraptor', tagline: 'Log forensics, IR playbooks, and detection engineering.', description: 'Skill bundle for DFIR: Velociraptor artifact collection, log forensics timelines, incident response playbooks, and Sigma detection engineering.', kind: 'skill', category: 'skills/cybersecurity/dfir-threat-intel', harnesses: ['opencode', 'universal'], tags: ['forensics', 'incident-response', 'detection'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by Velocidex/velociraptor (Apache-2.0).' },

  // -- skills/devops-cloud/* --
  { id: 'k8s-operator-debugging', name: 'Kubernetes Debugging Skill', repo: 'https://github.com/kubernetes/kubernetes', tagline: 'Cluster debugging, Helm releases, and operator patterns.', description: 'Skill bundle for Kubernetes: kubectl triage, Helm release management, operator patterns, and service-mesh debugging.', kind: 'skill', category: 'skills/devops-cloud/containers-k8s', harnesses: ['opencode', 'universal'], platforms: ['linux'], tags: ['kubernetes', 'helm', 'operators'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by kubernetes/kubernetes (Apache-2.0).' },
  { id: 'terraform-iac-modules', name: 'Terraform IaC Modules Skill', repo: 'https://github.com/hashicorp/terraform', tagline: 'Terraform/OpenTofu modules for AWS, GCP, and Azure.', description: 'Skill bundle for IaC: Terraform/OpenTofu module authoring, remote state, plan review, and AWS/GCP/Azure/Cloudflare patterns.', kind: 'skill', category: 'skills/devops-cloud/iac-terraform', harnesses: ['opencode', 'universal'], tags: ['terraform', 'opentofu', 'iac'], license: 'BUSL-1.1', source_attribution: 'Curated for Agent-Builder; inspired by hashicorp/terraform module patterns.' },
  { id: 'ci-observability-runbooks', name: 'CI/CD & Observability Skill', repo: 'https://github.com/open-telemetry/opentelemetry-collector', tagline: 'GitHub Actions pipelines, OpenTelemetry, and incident runbooks.', description: 'Skill bundle for delivery and observability: GitHub Actions/GitLab CI pipelines, OpenTelemetry instrumentation, Prometheus alerts, and incident runbooks.', kind: 'skill', category: 'skills/devops-cloud/ci-cd-observability', harnesses: ['opencode', 'universal'], tags: ['ci-cd', 'opentelemetry', 'runbooks'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by open-telemetry/opentelemetry-collector (Apache-2.0).' },

  // -- skills/data-ai/* --
  { id: 'agent-orchestration-patterns', name: 'Agent Orchestration Patterns Skill', repo: 'https://github.com/VoltAgent/awesome-agent-skills', tagline: 'Subagent planning, compaction, evals, and MCP authoring.', description: 'Skill bundle for agent architecture: subagent planning, context compaction, evaluation harnesses, and MCP server authoring (MIT upstream catalog).', kind: 'skill', category: 'skills/data-ai/agent-orchestration', harnesses: ['opencode', 'claude-code', 'codex', 'universal'], tags: ['orchestration', 'evals', 'mcp-authoring'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; upstream VoltAgent/awesome-agent-skills (MIT).' },
  { id: 'rag-vector-playbook', name: 'RAG & Vector Search Playbook Skill', repo: 'https://github.com/qdrant/qdrant', tagline: 'Hybrid retrieval, chunking, embeddings, and agent memory.', description: 'Skill bundle for retrieval: hybrid search, chunking strategies, embedding selection, Qdrant vector collections, and persistent agent memory.', kind: 'skill', category: 'skills/data-ai/rag-memory', harnesses: ['opencode', 'universal'], languages: ['python'], tags: ['rag', 'vectors', 'memory'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by qdrant/qdrant (Apache-2.0) and Shubhamsaboo/awesome-llm-apps (Apache-2.0).' },
  { id: 'ml-finetune-evals', name: 'ML Fine-Tuning & Evals Skill', repo: 'https://github.com/huggingface/transformers', tagline: 'LoRA fine-tuning, benchmark evals, and scientific ML.', description: 'Skill bundle for ML engineering: LoRA/TRL fine-tuning recipes, benchmark evaluation, and scientific computing patterns.', kind: 'skill', category: 'skills/data-ai/ml-scientific', harnesses: ['opencode', 'universal'], languages: ['python'], tags: ['lora', 'evals', 'ml'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by huggingface/transformers (Apache-2.0).' },

  // -- skills/testing-qa/* --
  { id: 'playwright-e2e-patterns', name: 'Playwright E2E Patterns Skill', repo: 'https://github.com/microsoft/playwright', tagline: 'Browser automation, fixtures, and visual regression checks.', description: 'Skill bundle for E2E automation: Playwright fixtures, page-object models, trace viewers, and visual regression verification.', kind: 'skill', category: 'skills/testing-qa/browser-e2e', harnesses: ['opencode', 'claude-code', 'universal'], languages: ['typescript'], tags: ['playwright', 'e2e', 'regression'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by microsoft/playwright (Apache-2.0).' },
  { id: 'property-fuzz-patterns', name: 'Property & Fuzz Testing Skill', repo: 'https://github.com/AltSysrq/proptest', tagline: 'Property tests, mutation testing, and deterministic fixtures.', description: 'Skill bundle for verification: property-based test generation, mutation testing, fuzzing harnesses, and deterministic fixtures.', kind: 'skill', category: 'skills/testing-qa/unit-property', harnesses: ['opencode', 'universal'], languages: ['rust'], tags: ['property-testing', 'fuzzing', 'mutation'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by AltSysrq/proptest (MIT).' },

  // -- mcp-servers/* (real exported tool names) --
  { id: 'filesystem-shell-mcp', name: 'Filesystem & Shell MCP Server', repo: 'https://github.com/modelcontextprotocol/servers', path: 'src/filesystem', tagline: 'Sandboxed file operations and command execution over MCP.', description: 'Official MCP filesystem server: sandboxed file read/write, directory listing, and controlled command execution for OS automation agents.', kind: 'mcp-server', category: 'mcp-servers/filesystem-shell', harnesses: ['opencode', 'claude-code', 'codex'], mcp: { server_name: 'filesystem', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], tools: ['read_file', 'write_file', 'list_directory', 'execute_command'] }, tags: ['filesystem', 'shell'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by modelcontextprotocol/servers (MIT).' },
  { id: 'github-code-intel-mcp', name: 'GitHub Code Intelligence MCP Server', repo: 'https://github.com/modelcontextprotocol/servers', path: 'src/github', tagline: 'Repo, PR, and issue workflows over MCP with real tool names.', description: 'Official MCP GitHub server: repository management, PR review workflows, issue triage, and commit search for code-intelligence agents.', kind: 'mcp-server', category: 'mcp-servers/git-repos', harnesses: ['opencode', 'claude-code'], mcp: { server_name: 'github', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], tools: ['get_pull_request', 'create_issue', 'search_repositories', 'list_commits'] }, tags: ['github', 'git', 'pr'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by modelcontextprotocol/servers (MIT).' },
  { id: 'firecrawl-scrape-mcp', name: 'Firecrawl Scrape MCP Server', repo: 'https://github.com/mendableai/firecrawl-mcp-server', tagline: 'Search, scrape, and crawl the web from agents via MCP.', description: 'Firecrawl MCP server: web search, page scraping, and site crawling tools for research and browser-automation agents.', kind: 'mcp-server', category: 'mcp-servers/browser-web', harnesses: ['opencode', 'claude-code'], mcp: { server_name: 'firecrawl', transport: 'stdio', command: 'npx', args: ['-y', 'firecrawl-mcp'], tools: ['firecrawl_scrape', 'firecrawl_search', 'firecrawl_crawl'] }, tags: ['scraping', 'search', 'browser'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by mendableai/firecrawl-mcp-server (MIT).' },
  { id: 'ghidra-re-mcp', name: 'Ghidra RE MCP Server', repo: 'https://github.com/LaurieWired/GhidraMCP', tagline: 'Binary analysis via Ghidra: functions, strings, decompilation.', description: 'GhidraMCP bridge: function listing, string extraction, and decompilation tools exposing reverse-engineering capability to agents.', kind: 'mcp-server', category: 'mcp-servers/security-re', harnesses: ['opencode', 'claude-code'], mcp: { server_name: 'ghidra', transport: 'stdio', command: 'python3', args: ['-m', 'ghidramcp'], tools: ['list_functions', 'decompile_function', 'list_strings'] }, tags: ['ghidra', 'reverse-engineering'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by LaurieWired/GhidraMCP (MIT).' },
  { id: 'figma-design-mcp', name: 'Figma Design MCP Server', repo: 'https://github.com/Framelink/figma-mcp-server', tagline: 'Design context, components, and screenshots from Figma.', description: 'Figma MCP server: design-context extraction, component listing, and screenshot tooling pairing UI builder agents with live specs.', kind: 'mcp-server', category: 'mcp-servers/design-ui', harnesses: ['opencode', 'claude-code'], mcp: { server_name: 'figma', transport: 'stdio', command: 'npx', args: ['-y', 'figma-mcp-server'], tools: ['get_design_context', 'get_screenshot', 'list_components'] }, tags: ['figma', 'design'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by Framelink/figma-mcp-server (MIT).' },
  { id: 'k8s-observe-mcp', name: 'Kubernetes Observability MCP Server', repo: 'https://github.com/Flux159/mcp-server-kubernetes', tagline: 'Cluster inspection: pods, deployments, and logs over MCP.', description: 'Kubernetes MCP server: pod/deployment listing and log retrieval tools for SRE responder agents with read-only cluster scope.', kind: 'mcp-server', category: 'mcp-servers/cloud-devops', harnesses: ['opencode', 'claude-code'], mcp: { server_name: 'k8s', transport: 'stdio', command: 'npx', args: ['-y', 'mcp-server-kubernetes'], tools: ['list_pods', 'list_deployments', 'get_logs'] }, tags: ['kubernetes', 'observability'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by Flux159/mcp-server-kubernetes (MIT).' },
  { id: 'notion-knowledge-mcp', name: 'Notion Knowledge MCP Server', repo: 'https://github.com/makersu/notion-mcp-server', tagline: 'Docs and knowledge-base search over MCP.', description: 'Notion MCP server: page search, page retrieval, and page creation tools for knowledge-base and productivity agents.', kind: 'mcp-server', category: 'mcp-servers/knowledge-productivity', harnesses: ['opencode', 'claude-code'], mcp: { server_name: 'notion', transport: 'stdio', command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], tools: ['search_pages', 'get_page', 'create_page'] }, tags: ['notion', 'knowledge'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by makersu/notion-mcp-server (MIT).' },

  // -- design-md/* --
  { id: 'saas-dashboard-design', name: 'SaaS Dashboard DESIGN.md', repo: 'https://github.com/VoltAgent/awesome-design-md', tagline: 'Clean editorial dashboards and analytics workspace specs.', description: 'DESIGN.md brand system for SaaS dashboards: data-dense analytics layouts, editorial workspaces, and collaborative UI tokens from VoltAgent/awesome-design-md (MIT).', kind: 'design-md', category: 'design-md/saas-productivity', harnesses: ['universal'], tags: ['saas', 'dashboard', 'design-system'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; upstream VoltAgent/awesome-design-md (MIT).' },
  { id: 'fintech-editorial-design', name: 'Fintech Editorial DESIGN.md', repo: 'https://github.com/VoltAgent/awesome-design-md', path: 'design-md/fintech', tagline: 'High-trust financial interfaces and editorial media specs.', description: 'DESIGN.md brand system for fintech and consumer brands: high-trust financial UI, editorial media layouts, and consumer web aesthetics from VoltAgent/awesome-design-md (MIT).', kind: 'design-md', category: 'design-md/fintech-consumer', harnesses: ['universal'], tags: ['fintech', 'editorial', 'design-system'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; upstream VoltAgent/awesome-design-md (MIT).' },

  // -- prompts/* --
  { id: 'architecture-review-prompt', name: 'Architecture Review Prompt', repo: 'https://github.com/f/prompts.chat', tagline: 'Refactoring, architecture critique, and spec authoring prompts.', description: 'System prompt for software architecture review: refactoring plans, architecture critique, and specification authoring workflows (prompts data CC0-1.0).', kind: 'prompt', category: 'prompts/coding-architecture', harnesses: ['universal', 'opencode', 'claude-code'], tags: ['architecture', 'review', 'spec'], license: 'CC0-1.0', source_attribution: 'Curated for Agent-Builder; inspired by f/prompts.chat prompts data (CC0-1.0).' },
  { id: 'design-critique-prompt', name: 'Design Critique Prompt', repo: 'https://github.com/f/prompts.chat', path: 'prompts/design', tagline: 'Design critique, documentation, and spec-interview prompts.', description: 'System prompt for product and UI critique: design review checklists, documentation drafting, and specification interview flows (prompts data CC0-1.0).', kind: 'prompt', category: 'prompts/product-design', harnesses: ['universal'], tags: ['design', 'critique', 'docs'], license: 'CC0-1.0', source_attribution: 'Curated for Agent-Builder; inspired by f/prompts.chat prompts data (CC0-1.0).' },

  // -- agents/* --
  { id: 'fullstack-polyglot-agent', name: 'Full-Stack Polyglot Agent', repo: 'https://github.com/Shubhamsaboo/awesome-llm-apps', tagline: 'Pre-scoped Python/TS/Go coding specialist with GitHub MCP.', description: 'Ready-to-run coding specialist agent combining Python, TypeScript, and Go skills with scoped GitHub MCP tools for full-stack feature work.', kind: 'agent', category: 'agents/coding-specialists', harnesses: ['opencode'], agent_preset: { mode: 'subagent', model: 'anthropic/claude-sonnet-4-5', prompt: 'Implement full-stack features across Python, TypeScript, and Go services with tested, reviewed changes.', skills: ['python-fastapi-service', 'typescript-strict-patterns', 'go-concurrent-services'], mcp_selections: [{ server: 'github', tools: ['get_pull_request', 'search_repositories'] }] }, tags: ['fullstack', 'coding'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by Shubhamsaboo/awesome-llm-apps (Apache-2.0).' },
  { id: 'frontend-design-agent', name: 'Frontend Design Agent', repo: 'https://github.com/VoltAgent/awesome-design-md', tagline: 'UI builder agent pairing WebUI skills with Figma MCP.', description: 'Ready-to-run design agent combining WebUI frontend skills and SaaS dashboard DESIGN.md specs with scoped Figma MCP tools.', kind: 'agent', category: 'agents/design-frontend', harnesses: ['opencode'], agent_preset: { mode: 'subagent', model: 'anthropic/claude-sonnet-4-5', prompt: 'Build accessible, responsive UI from the DESIGN.md spec, verifying against Figma context.', skills: ['webui-frontend-patterns', 'playwright-e2e-patterns'], mcp_selections: [{ server: 'figma', tools: ['get_design_context', 'get_screenshot'] }] }, tags: ['frontend', 'design'], license: 'MIT', source_attribution: 'Curated for Agent-Builder; inspired by VoltAgent/awesome-design-md (MIT).' },
  { id: 'sre-database-agent', name: 'SRE Database Responder Agent', repo: 'https://github.com/open-telemetry/opentelemetry-collector', tagline: 'Read-only K8s and Postgres responder with SQL audit skills.', description: 'Ready-to-run DevOps/data agent combining CI observability runbooks and SQL audit skills with read-only Kubernetes and Postgres MCP tools.', kind: 'agent', category: 'agents/devops-data', harnesses: ['opencode'], agent_preset: { mode: 'subagent', model: 'anthropic/claude-sonnet-4-5', prompt: 'Respond to database and cluster incidents using read-only inspection; never mutate state.', skills: ['sql-query-optimization', 'ci-observability-runbooks'], mcp_selections: [{ server: 'k8s', tools: ['list_pods', 'get_logs'] }, { server: 'postgres-prod', tools: ['query', 'list-tables'] }] }, tags: ['sre', 'database', 'read-only'], license: 'Apache-2.0', source_attribution: 'Curated for Agent-Builder; inspired by open-telemetry/opentelemetry-collector (Apache-2.0).' },
];

function collectExistingIds() {
  const ids = new Set();
  const dataDir = path.join(ROOT, 'data');
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml'))) {
        try {
          const doc = yaml.load(fs.readFileSync(full, 'utf8'));
          if (doc && typeof doc === 'object' && typeof doc.id === 'string') ids.add(doc.id);
        } catch (_e) {
          // Leave parse errors to validate.js; do not crash the seeder.
        }
      }
    }
  };
  walk(dataDir);
  return ids;
}

function orderEntry(entry) {
  const order = ['id', 'name', 'repo', 'path', 'npm', 'homepage', 'tagline', 'description', 'kind', 'category', 'harnesses', 'languages', 'platforms', 'mcp', 'agent_preset', 'content_file', 'tags', 'compat', 'scope', 'min_version', 'installation', 'license', 'source_attribution'];
  const out = {};
  for (const k of order) {
    if (Object.prototype.hasOwnProperty.call(entry, k)) out[k] = entry[k];
  }
  return out;
}

function writeAttribution() {
  const content = `# Attribution Ledger — Agent-Builder Registry

This registry ports and adapts entries from the following upstream repositories.
Every catalog entry carries a \`license\` and \`source_attribution\` field pointing
back to its origin; this file is the canonical license ledger.

| Upstream repository | Used for | License | Notes |
| --- | --- | --- | --- |
| [Heretek-AI/awesome-opencode](https://github.com/Heretek-AI/awesome-opencode) | OpenCode plugins, agent presets, seed schemas | CC0-1.0 | Primary port source; public-domain dedication. |
| [sickn33/agentic-awesome-skills](https://github.com/sickn33/agentic-awesome-skills) | Skills via \`skills_index.json\` + \`skills/<id>/SKILL.md\` | MIT | Attribution ledger maintained here per upstream \`CREDITS.md\`/\`LICENSE\`. |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | Agent/orchestration skills | MIT | Original authors retain copyright; redistribution keeps MIT notice. |
| [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md) | \`DESIGN.md\` brand systems via \`design-md/<brand>/DESIGN.md\` | MIT | Original authors retain copyright; redistribution keeps MIT notice. |
| [Shubhamsaboo/awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps) | RAG/agent app skills | Apache-2.0 | Apache-2.0 attribution + change notes preserved where adapted. |
| [f/prompts.chat](https://github.com/f/prompts.chat) | System prompts via \`prompts.csv\` | MIT (code) / CC0-1.0 (prompts data) | Prompt texts under CC0-1.0; site code under MIT. |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | Claude Code plugins via \`THE_RESOURCES_TABLE_NEW.csv\` | CC0-1.0 / MIT (per resource metadata) | Per-resource license recorded in each entry's \`license\` field. |

## Per-entry attribution

- Each \`data/**/*.yaml\` entry records its origin in \`source_attribution\` and its
  effective license in \`license\`.
- Entries marked \`Curated for Agent-Builder; inspired by ...\` are original
  summaries written for this registry, informed by the cited upstream project;
  they are distributed under the entry's stated \`license\`.
- Entries marked \`Imported from ...\` are mechanical ports of upstream index rows;
  the upstream license applies and the upstream repository remains the canonical
  source.

## Additional inspirations (tool names, schemas)

- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) (MIT) — MCP server definitions and tool names.
- [sst/opencode](https://github.com/sst/opencode) (MIT) — OpenCode plugin API and permission schemas.
- [anthropics/claude-code](https://github.com/anthropics/claude-code) — Claude Code slash commands and hooks.
- [openai/codex](https://github.com/openai/codex) — Codex CLI sandbox and config schemas.
- [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) — Gemini CLI extension surface.

_Generated by \`scripts/import/seed-all.js\` — do not remove notices without updating the corresponding entries._
`;
  fs.writeFileSync(path.join(ROOT, 'ATTRIBUTION.md'), content, 'utf8');
  console.log('SEED: wrote ATTRIBUTION.md');
}

function main() {
  const args = parseArgs(process.argv);
  const unmapped = [];

  let scratchEntries = [];
  try {
    scratchEntries = importFromScratchDir(args.fromScratchDir, unmapped);
  } catch (err) {
    console.warn(`SEED: WARNING: scratch import failed: ${err.message}; continuing with builtin curated set.`);
    scratchEntries = [];
  }

  const builtin = args.builtinCurated ? CURATED.slice() : [];
  if (!args.builtinCurated) console.log('SEED: builtin curated catalog disabled via --no-builtin-curated.');

  // Merge: builtin first (authoritative), then scratch entries with unseen ids.
  const seen = new Set(builtin.map((e) => e.id));
  const merged = builtin.slice();
  for (const e of scratchEntries) {
    if (!e || typeof e.id !== 'string' || seen.has(e.id)) continue;
    if (!e.kind || !e.category || !e.harnesses) continue;
    seen.add(e.id);
    merged.push(e);
  }

  const existingIds = collectExistingIds();
  let created = 0;
  let skipped = 0;

  for (const entry of merged) {
    if (existingIds.has(entry.id)) {
      console.log(`SEED: SKIP existing id '${entry.id}'.`);
      skipped += 1;
      continue;
    }
    const dest = path.join(ROOT, 'data', entry.category, `${entry.id}.yaml`);
    if (fs.existsSync(dest)) {
      console.log(`SEED: SKIP existing file '${path.relative(ROOT, dest)}'.`);
      skipped += 1;
      existingIds.add(entry.id);
      continue;
    }
    if (args.dryRun) {
      console.log(`SEED: DRY-RUN would create '${path.relative(ROOT, dest)}'.`);
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const dumped = yaml.dump(orderEntry(entry), { lineWidth: 100, noRefs: true, sortKeys: false });
    fs.writeFileSync(dest, dumped, 'utf8');
    existingIds.add(entry.id);
    created += 1;
  }

  if (!args.dryRun) {
    writeAttribution();
    // Append unmapped-headings log for the engineering log (docs/NOTES.md is
    // updated by the milestone runner; keep a machine-readable copy here too).
    if (unmapped.length > 0) {
      console.log(`SEED: ${unmapped.length} unmapped upstream heading(s) fell back to defaults (see docs/NOTES.md M6 log).`);
      for (const u of unmapped.slice(0, 50)) console.log(`SEED: UNMAPPED ${u}`);
      if (unmapped.length > 50) console.log(`SEED: ... and ${unmapped.length - 50} more unmapped headings.`);
    } else {
      console.log('SEED: no unmapped upstream headings (scratch dir absent or all headings mapped).');
    }
  }

  console.log(`SEED_DONE: created ${created}, skipped ${skipped}, curated ${builtin.length}, scratch ${scratchEntries.length}, unmapped ${unmapped.length}`);
}

main();
