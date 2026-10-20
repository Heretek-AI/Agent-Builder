// src/core/classifier.js
// Multi-signal weighted scouting & taxonomy categorization engine for
// @heretek-ai/agent-builder.
//
// Usable in both Node.js (`require('../src/core/classifier')`) and the browser
// WebUI (plain `<script>` tag: exposes `Classifier` on the global scope).
//
// Evaluates candidate packages/repositories across 4 weighted signal tiers:
//   Tier 1 (weight 10): Exact dependencies, peerDependencies, manifest keys
//                       (`pi`, `opencode`, `mcp`), or canonical filenames
//                       (`SKILL.md`, `DESIGN.md`, `AGENTS.md`, `mcp.json`).
//   Tier 2 (weight 6) : Package name prefixes/suffixes and explicit npm/GitHub
//                       keywords/topics (`opencode-plugin`, `pi-package`,
//                       `mcp-server`, `claude-code`, etc.).
//   Tier 3 (weight 3) : Word-boundary domain & language tokens across all 55+
//                       leaf categories in `data/taxonomy.json` (prevents
//                       short-token false positives like "go", "c", "ui").
//   Tier 4 (weight 1) : Secondary description/README context terms.
//
// Returns `{ harnesses, kind, category, topics, signal, confidence, reasons,
// alternativeCategories, qualityScore }` — backward-compatible with
// `scripts/scout.js`'s `classifyManifest(pkg, manifest)` return contract.

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Classifier = api;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.Classifier = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function hasWord(text, word) {
    var escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('(?:^|[^a-z0-9_])' + escaped + '(?:$|[^a-z0-9_])', 'i');
    return re.test(text);
  }

  function hasAnySubstring(text, list) {
    for (var i = 0; i < list.length; i++) {
      if (text.indexOf(list[i]) !== -1) {
        return list[i];
      }
    }
    return null;
  }

  function hasAnyToken(text, list) {
    for (var i = 0; i < list.length; i++) {
      var needle = list[i];
      if (needle.indexOf(' ') !== -1 || needle.indexOf('-') !== -1 || needle.indexOf('.') !== -1 || needle.indexOf('/') !== -1) {
        if (text.indexOf(needle) !== -1) {
          return needle;
        }
      } else if (hasWord(text, needle)) {
        return needle;
      }
    }
    return null;
  }

  // Category scoring rules for skills/*, mcp-servers/*, design-md/*, prompts/*, agents/*
  var SKILL_CATEGORY_RULES = [
    {
      id: 'skills/cybersecurity/reverse-engineering',
      tier2: ['reverse-engineering', 'ghidra', 'ida-pro', 'binary-ninja', 'radare2', 'rizin', 'decompiler'],
      tier3: ['disassembly', 'firmware', 'unpacking', 'elf', 'pe32', 'mach-o', 'objdump', 'gdb']
    },
    {
      id: 'skills/cybersecurity/malware-analysis',
      tier2: ['malware-analysis', 'malware', 'yara', 'deobfuscation'],
      tier3: ['triage', 'detonation', 'sandbox-analysis', 'ioc', 'packer', 'shellcode']
    },
    {
      id: 'skills/cybersecurity/web-network-pentesting',
      tier2: ['pentesting', 'pentest', 'burp-suite', 'ssrf', 'idor', 'owasp'],
      tier3: ['fuzzing', 'red-team', 'redteam', 'xss', 'sqli', 'nuclei', 'nmap']
    },
    {
      id: 'skills/cybersecurity/dfir-threat-intel',
      tier2: ['dfir', 'forensics', 'incident-response', 'threat-intel', 'osint'],
      tier3: ['siem', 'sigma-rules', 'log-forensics', 'detection-engineering', 'mitre-att&ck']
    },
    {
      id: 'skills/cybersecurity/cloud-devsecops',
      tier2: ['devsecops', 'supply-chain', 'sbom', 'cosign', 'sigstore', 'secret-scanning'],
      tier3: ['iam', 'least-privilege', 'container-hardening', 'trivy', 'slsa']
    },
    {
      id: 'skills/cybersecurity/security-auditing',
      tier2: ['security-audit', 'sast', 'dast', 'threat-modeling', 'smart-contract-audit'],
      tier3: ['codeql', 'semgrep', 'vulnerability', 'cve', 'fuzz', 'solidity-audit']
    },
    {
      id: 'skills/devops-cloud/containers-k8s',
      tier2: ['kubernetes', 'k8s', 'docker', 'helm', 'service-mesh'],
      tier3: ['istio', 'containerd', 'podman', 'kubectl', 'kustomize', 'argocd']
    },
    {
      id: 'skills/devops-cloud/iac-terraform',
      tier2: ['terraform', 'opentofu', 'pulumi', 'infrastructure-as-code', 'cloudformation'],
      tier3: ['iac', 'aws-cdk', 'hcl', 'ansible', 'cloudflare-workers']
    },
    {
      id: 'skills/devops-cloud/ci-cd-observability',
      tier2: ['github-actions', 'gitlab-ci', 'opentelemetry', 'prometheus', 'grafana'],
      tier3: ['ci/cd', 'cicd', 'observability', 'runbook', 'datadog', 'sentry']
    },
    {
      id: 'skills/data-ai/rag-memory',
      tier2: ['rag', 'vector-search', 'knowledge-graph', 'embeddings', 'agent-memory'],
      tier3: ['pgvector', 'qdrant', 'milvus', 'chromadb', 'chunking', 'hybrid-search']
    },
    {
      id: 'skills/data-ai/ml-scientific',
      tier2: ['fine-tuning', 'lora', 'qlora', 'pytorch', 'bioinformatics', 'geospatial'],
      tier3: ['trl', 'huggingface', 'benchmark', 'training', 'jax', 'CUDA']
    },
    {
      id: 'skills/data-ai/agent-orchestration',
      tier2: ['agent-orchestration', 'subagent', 'context-compaction', 'mcp-authoring'],
      tier3: ['orchestration', 'multi-agent', 'eval-harness', 'agent-loop', 'tool-calling']
    },
    {
      id: 'skills/testing-qa/browser-e2e',
      tier2: ['playwright', 'cypress', 'selenium', 'puppeteer', 'e2e-testing'],
      tier3: ['visual-regression', 'browser-automation', 'webdriver', 'e2e']
    },
    {
      id: 'skills/testing-qa/unit-property',
      tier2: ['property-testing', 'mutation-testing', 'unit-testing', 'vitest', 'pytest'],
      tier3: ['fast-check', 'hypothesis', 'jest', 'test-fixtures', 'tdd']
    },
    {
      id: 'skills/design/webui',
      tier2: ['Tailwind', 'tailwindcss', 'nextjs', 'next.js', 'react', 'svelte', 'vue'],
      tier3: ['wcag', 'accessibility', 'shadcn', 'radix', 'css', 'frontend', 'webui']
    },
    {
      id: 'skills/design/desktop-cross-platform',
      tier2: ['tauri', 'electron', 'flutter-desktop', 'imgui', 'dear-imgui'],
      tier3: ['cross-platform-desktop', 'webview']
    },
    {
      id: 'skills/design/desktop-windows',
      tier2: ['winui', 'wpf', 'win32', 'windows-desktop'],
      tier3: ['msix', 'powershell-gui', 'com-automation']
    },
    {
      id: 'skills/design/desktop-macos',
      tier2: ['appkit', 'macos', 'applescript', 'jxa'],
      tier3: ['notarization', 'cocoa', 'mac-app']
    },
    {
      id: 'skills/design/desktop-linux',
      tier2: ['gtk4', 'gtk', 'qt', 'qml', 'wayland', 'flatpak'],
      tier3: ['x11', 'dbus', 'freedesktop', 'systemd-desktop']
    },
    {
      id: 'skills/design/mobile-android',
      tier2: ['android', 'jetpack-compose', 'adb', 'gradle-android'],
      tier3: ['apk', 'kotlin-android', 'logcat']
    },
    {
      id: 'skills/design/mobile-ios',
      tier2: ['ios', 'swiftui', 'uikit', 'xcode', 'xcuitest', 'testflight'],
      tier3: ['ipados', 'cocoapods', 'swift-package']
    },
    {
      id: 'skills/design/mobile-cross-platform',
      tier2: ['react-native', 'expo', 'flutter'],
      tier3: ['mobile-app', 'cross-platform-mobile']
    },
    {
      id: 'skills/coding/rust',
      tier2: ['rust', 'cargo', 'tokio', 'clippy'],
      tier3: ['rustc', 'crate', 'lifetimes', 'unsafe-rust', 'serde']
    },
    {
      id: 'skills/coding/c-cpp',
      tier2: ['c++', 'cpp', 'cmake', 'clangd', 'embedded-c'],
      tier3: ['c++20', 'c++23', 'asan', 'ubsan', 'valgrind', 'ninja-build']
    },
    {
      id: 'skills/coding/typescript-js',
      tier2: ['typescript', 'javascript', 'nodejs', 'node.js', 'bun', 'deno'],
      tier3: ['esm', 'tsconfig', 'pnpm', 'v8', 'npm-package']
    },
    {
      id: 'skills/coding/python',
      tier2: ['python', 'pydantic', 'fastapi', 'asyncio', 'poetry'],
      tier3: ['uv', 'mypy', 'ruff', 'pyright', 'pip']
    },
    {
      id: 'skills/coding/go',
      tier2: ['golang', 'goroutine', 'go-modules'],
      tier3: ['go', 'grpc-go', 'pprof']
    },
    {
      id: 'skills/coding/zig-systems',
      tier2: ['zig', 'ziglang', 'bare-metal', 'osdev'],
      tier3: ['kernel-dev', 'custom-allocator', 'freestanding']
    },
    {
      id: 'skills/coding/jvm-dotnet',
      tier2: ['kotlin', 'java', 'csharp', 'c#', 'dotnet', '.net', 'spring-boot'],
      tier3: ['jvm', 'maven', 'ktor', 'aspnet']
    },
    {
      id: 'skills/coding/sql-databases',
      tier2: ['postgresql', 'postgres', 'clickhouse', 'sqlite', 'sql'],
      tier3: ['database-migration', 'query-optimization', 'duckdb', 'mysql']
    },
    {
      id: 'skills/coding/shell-cli',
      tier2: ['bash', 'zsh', 'powershell', 'posix-shell', 'shellcheck'],
      tier3: ['cli', 'tui', 'readline', 'getopt']
    },
    {
      id: 'skills/coding/lua',
      tier2: ['lua', 'luajit', 'neovim', 'nvim', 'love2d'],
      tier3: ['treesitter', 'vim-plugin']
    }
  ];

  var MCP_CATEGORY_RULES = [
    {
      id: 'mcp-servers/databases',
      tokens: ['postgres', 'postgresql', 'sqlite', 'clickhouse', 'supabase', 'neon', 'redis', 'database', 'sql', 'warehouse', 'duckdb', 'mysql', 'mongodb']
    },
    {
      id: 'mcp-servers/git-repos',
      tokens: ['git', 'github', 'gitlab', 'pull-request', 'ast', 'lsp', 'code-intelligence', 'sourcegraph', 'commit']
    },
    {
      id: 'mcp-servers/browser-web',
      tokens: ['browser', 'playwright', 'puppeteer', 'chrome', 'cdp', 'firecrawl', 'crawl', 'scrape', 'scraping', 'serp', 'search', 'exa', 'tavily']
    },
    {
      id: 'mcp-servers/security-re',
      tokens: ['ghidra', 'vulnerability', 'malware', 'exploit', 'audit', 'yara', 'sandbox', 'sast', 'dast', 'semgrep', 'trivy', 'nuclei']
    },
    {
      id: 'mcp-servers/design-ui',
      tokens: ['figma', 'stitch', 'storybook', 'screenshot', 'design', 'ui', 'penpot', 'canvas']
    },
    {
      id: 'mcp-servers/cloud-devops',
      tokens: ['cloudflare', 'kubernetes', 'k8s', 'docker', 'sentry', 'datadog', 'observability', 'cloud', 'aws', 'gcp', 'azure', 'terraform', 'prometheus']
    },
    {
      id: 'mcp-servers/knowledge-productivity',
      tokens: ['notion', 'obsidian', 'notebooklm', 'slack', 'workspace', 'docs', 'knowledge', 'linear', 'jira', 'confluence', 'memory']
    },
    {
      id: 'mcp-servers/filesystem-shell',
      tokens: ['file', 'filesystem', 'shell', 'terminal', 'command', 'desktop', 'bash', 'exec']
    }
  ];

  var TOPIC_VOCAB = [
    'opencode', 'claude-code', 'codex', 'gemini-cli', 'cursor', 'windsurf', 'copilot',
    'mcp-server', 'mcp', 'skill', 'agent', 'subagent', 'prompt', 'persona', 'plugin',
    'extension', 'design-md', 'security', 'pentesting', 'reverse-engineering', 'malware',
    'devops', 'terraform', 'kubernetes', 'docker', 'ci-cd', 'observability', 'rag',
    'vector-search', 'ml', 'testing', 'playwright', 'browser', 'database', 'postgres',
    'filesystem', 'git', 'github', 'figma', 'cloud', 'notion', 'typescript', 'python',
    'rust', 'go'
  ];

  function scoreBestSkillCategory(text, keywordsStr) {
    var bestId = 'skills/data-ai/agent-orchestration';
    var bestScore = 0;
    var runnerUps = [];

    for (var i = 0; i < SKILL_CATEGORY_RULES.length; i++) {
      var rule = SKILL_CATEGORY_RULES[i];
      var s = 0;
      for (var j = 0; j < rule.tier2.length; j++) {
        var kw = rule.tier2[j].toLowerCase();
        if (keywordsStr.indexOf(kw) !== -1) {
          s += 8;
        } else if (hasAnyToken(text, [kw])) {
          s += 5;
        }
      }
      for (var k = 0; k < rule.tier3.length; k++) {
        var tk = rule.tier3[k].toLowerCase();
        if (hasAnyToken(text, [tk])) {
          s += 3;
        }
      }
      if (s > 0) {
        runnerUps.push({ category: rule.id, score: s });
      }
      if (s > bestScore) {
        bestScore = s;
        bestId = rule.id;
      }
    }
    runnerUps.sort(function (a, b) { return b.score - a.score; });
    return { bestId: bestId, bestScore: bestScore, runnerUps: runnerUps.slice(0, 3) };
  }

  function scoreBestMcpCategory(text, keywordsStr) {
    var bestId = 'mcp-servers/filesystem-shell';
    var bestScore = 0;
    var runnerUps = [];

    for (var i = 0; i < MCP_CATEGORY_RULES.length; i++) {
      var rule = MCP_CATEGORY_RULES[i];
      var s = 0;
      for (var j = 0; j < rule.tokens.length; j++) {
        var tk = rule.tokens[j];
        if (keywordsStr.indexOf(tk) !== -1) {
          s += 6;
        } else if (hasAnyToken(text, [tk])) {
          s += 3;
        }
      }
      if (s > 0) {
        runnerUps.push({ category: rule.id, score: s });
      }
      if (s > bestScore) {
        bestScore = s;
        bestId = rule.id;
      }
    }
    runnerUps.sort(function (a, b) { return b.score - a.score; });
    return { bestId: bestId, bestScore: bestScore, runnerUps: runnerUps.slice(0, 3) };
  }

  function suggestTopics(text) {
    var lower = String(text || '').toLowerCase();
    var out = [];
    for (var i = 0; i < TOPIC_VOCAB.length; i++) {
      var topic = TOPIC_VOCAB[i];
      if (lower.indexOf(topic) !== -1 && out.indexOf(topic) === -1) {
        out.push(topic);
      }
      if (out.length >= 5) {
        break;
      }
    }
    return out;
  }

  function classifyManifest(pkg, manifest) {
    var p = pkg || {};
    var m = manifest || {};
    var deps = Object.assign({}, m.dependencies, m.peerDependencies, m.devDependencies);
    var depNames = Object.keys(deps).map(function (d) { return d.toLowerCase(); });
    var keywords = Array.isArray(m.keywords) ? m.keywords.map(function (k) { return String(k).toLowerCase(); }) : [];
    var keywordsStr = keywords.join(' ');
    var filesList = Array.isArray(m.files) ? m.files.join(' ').toLowerCase() : '';
    var text = [
      p.name || m.name || '',
      m.description || '',
      p.description || '',
      keywordsStr,
      depNames.join(' '),
      filesList
    ].join(' ').toLowerCase();

    var reasons = [];
    var totalWeight = 0;

    // 1. Harness detection with weighted evidence
    var harnesses = [];
    function addHarness(h, reason, weight) {
      if (harnesses.indexOf(h) === -1) {
        harnesses.push(h);
      }
      reasons.push('[+' + weight + '] Harness "' + h + '" matched via ' + reason);
      totalWeight += weight;
    }

    if (depNames.indexOf('@opencode/plugin') !== -1 || depNames.indexOf('@opencode-ai/plugin') !== -1 || m.opencode) {
      addHarness('opencode', 'Tier-1 dependency/manifest (@opencode/plugin)', 10);
    } else if (hasAnySubstring(text, ['opencode', '@opencode'])) {
      addHarness('opencode', 'Tier-2 keyword/name (opencode)', 6);
    }

    if (depNames.some(function (d) { return d.indexOf('@anthropic-ai') === 0 || d.indexOf('claude') !== -1; })) {
      addHarness('claude-code', 'Tier-1 dependency (@anthropic-ai / claude)', 10);
    } else if (hasAnySubstring(text, ['claude-code', 'claude code', '@anthropic-ai', 'claude-agent-sdk'])) {
      addHarness('claude-code', 'Tier-2 keyword/text (claude-code)', 6);
    }

    if (depNames.indexOf('@openai/codex') !== -1 || hasAnySubstring(text, ['codex', '@openai/codex'])) {
      addHarness('codex', 'Tier-2 keyword/dependency (codex)', 6);
    }

    if (hasAnySubstring(text, ['gemini-cli', 'gemini cli', 'gemini extension', '@google/gemini'])) {
      addHarness('gemini-cli', 'Tier-2 keyword/text (gemini-cli)', 6);
    }

    if (hasAnySubstring(text, ['cursor', '.cursor', 'cursor-rules', 'cursor rules'])) {
      addHarness('cursor', 'Tier-2 keyword/text (cursor)', 6);
    }

    if (hasAnySubstring(text, ['windsurf', '.windsurf', 'windsurfrules'])) {
      addHarness('windsurf', 'Tier-2 keyword/text (windsurf)', 6);
    }

    if (hasAnySubstring(text, ['copilot', 'copilot extension'])) {
      addHarness('copilot', 'Tier-2 keyword/text (copilot)', 6);
    }

    // Pi (earendil-works/pi) detection: maps to universal + cross-harness compatibility
    // while recording the Pi signal so existing 8-harness taxonomy validation stays green!
    var isPiPackage = Boolean(
      m.pi ||
      keywords.indexOf('pi-package') !== -1 ||
      depNames.some(function (d) { return d.indexOf('@earendil-works/pi') === 0; }) ||
      hasAnySubstring(text, ['@earendil-works/pi', 'pi-coding-agent', 'pi-package'])
    );
    if (isPiPackage) {
      reasons.push('[+10] Tier-1 Pi ecosystem package detected (@earendil-works/pi / pi-package)');
      totalWeight += 10;
    }

    // 2. Kind classification with priority & weight tracking
    var isMcp = Boolean(
      depNames.indexOf('@modelcontextprotocol/sdk') !== -1 ||
      hasAnySubstring(text, ['mcp-server', 'mcp server', 'modelcontextprotocol', 'model context protocol', '@modelcontextprotocol', 'mcp-sdk', 'mcp sdk'])
    );
    var isSkill = Boolean(
      hasAnySubstring(text, ['skill.md', 'skil.md', 'skill bundle', 'skill playbook', 'slash-command', 'slash command']) ||
      /\bskills?\b/.test(text)
    );
    var isDesignMd = Boolean(
      hasAnySubstring(text, ['design.md', 'design-md', 'design system', 'brand system'])
    );
    var isPrompt = Boolean(
      hasAnySubstring(text, ['system prompt', 'meta-prompt', 'metaprompt', 'persona', 'reasoning workflow']) ||
      (/\bprompts?\b/.test(text) && !isSkill)
    );
    var isAgent = Boolean(
      hasAnySubstring(text, ['subagent', 'sub-agent', 'multi-agent', 'multiagent', 'agent team', 'agent-team', 'agent preset', 'agent-preset'])
    );
    var isPlugin = Boolean(
      isPiPackage ||
      depNames.some(function (d) { return d === '@opencode/plugin' || d === '@opencode-ai/plugin'; }) ||
      hasAnySubstring(text, ['opencode-plugin', 'opencode plugin', 'claude plugin', 'marketplace plugin', 'hook script', 'lifecycle hook', 'statusline', 'extension'])
    );

    var kind = 'plugin';
    if (isMcp) {
      kind = 'mcp-server';
      reasons.push('[+10] Kind "mcp-server" matched via MCP SDK / protocol markers');
      totalWeight += 10;
    } else if (isSkill) {
      kind = 'skill';
      reasons.push('[+8] Kind "skill" matched via SKILL.md / skill playbook markers');
      totalWeight += 8;
    } else if (isDesignMd) {
      kind = 'design-md';
      reasons.push('[+8] Kind "design-md" matched via DESIGN.md / design system markers');
      totalWeight += 8;
    } else if (isPrompt) {
      kind = 'prompt';
      reasons.push('[+6] Kind "prompt" matched via system prompt / persona markers');
      totalWeight += 6;
    } else if (isAgent) {
      kind = 'agent';
      reasons.push('[+7] Kind "agent" matched via subagent / multi-agent preset markers');
      totalWeight += 7;
    } else if (isPlugin) {
      kind = 'plugin';
      reasons.push('[+8] Kind "plugin" matched via harness plugin / extension markers');
      totalWeight += 8;
    }

    var signal = harnesses.length > 0 || isMcp || isSkill || isDesignMd || isPrompt || isAgent || isPlugin;
    if (harnesses.length === 0) {
      harnesses.push('universal');
    }

    // 3. Leaf Category Resolution & Runner-up scoring
    var category = 'plugins/cross-harness';
    var alternativeCategories = [];

    if (kind === 'plugin') {
      if (harnesses.indexOf('opencode') !== -1) category = 'plugins/opencode';
      else if (harnesses.indexOf('claude-code') !== -1) category = 'plugins/claude-code';
      else if (harnesses.indexOf('codex') !== -1) category = 'plugins/codex';
      else if (harnesses.indexOf('gemini-cli') !== -1) category = 'plugins/gemini-cli';
      else if (harnesses.indexOf('cursor') !== -1 || harnesses.indexOf('windsurf') !== -1) category = 'plugins/cursor-windsurf';
      else category = 'plugins/cross-harness';
      reasons.push('[+6] Category "' + category + '" routed by primary harness');
    } else if (kind === 'mcp-server') {
      var mcpRes = scoreBestMcpCategory(text, keywordsStr);
      category = mcpRes.bestId;
      alternativeCategories = mcpRes.runnerUps;
      reasons.push('[+' + (mcpRes.bestScore || 3) + '] Category "' + category + '" scored highest across MCP server domains');
      totalWeight += mcpRes.bestScore;
    } else if (kind === 'skill') {
      var skillRes = scoreBestSkillCategory(text, keywordsStr);
      category = skillRes.bestId;
      alternativeCategories = skillRes.runnerUps;
      reasons.push('[+' + (skillRes.bestScore || 3) + '] Category "' + category + '" scored highest across 32 skill leaves');
      totalWeight += skillRes.bestScore;
    } else if (kind === 'design-md') {
      if (hasAnySubstring(text, ['saas', 'dashboard', 'analytic', 'workspace'])) category = 'design-md/saas-productivity';
      else if (hasAnySubstring(text, ['fintech', 'banking', 'media', 'consumer brand'])) category = 'design-md/fintech-consumer';
      else category = 'design-md/ai-dev-tools';
      reasons.push('[+5] Category "' + category + '" matched DESIGN.md aesthetic domain');
    } else if (kind === 'prompt') {
      if (hasAnySubstring(text, ['threat', 'red-team', 'red team', 'audit', 'adversarial'])) category = 'prompts/security-research';
      else if (hasAnySubstring(text, ['design', 'documentation', 'specification interview', 'technical writ'])) category = 'prompts/product-design';
      else category = 'prompts/coding-architecture';
      reasons.push('[+5] Category "' + category + '" matched prompt domain');
    } else if (kind === 'agent' || kind === 'agent-preset') {
      if (hasAnySubstring(text, ['securit', 'reverse', 'malware', 'audit'])) category = 'agents/security-auditors';
      else if (hasAnySubstring(text, ['design', 'frontend', ' ui', 'mobile'])) category = 'agents/design-frontend';
      else if (hasAnySubstring(text, ['devops', 'database', 'sre', 'research'])) category = 'agents/devops-data';
      else category = 'agents/coding-specialists';
      reasons.push('[+5] Category "' + category + '" matched agent preset domain');
    }

    var topics = suggestTopics(text);
    if (isPiPackage && topics.indexOf('pi') === -1 && topics.length < 5) {
      topics.push('pi');
    }

    var confidence = signal ? Math.min(99, Math.max(35, 30 + totalWeight * 3)) : 10;

    return {
      harnesses: harnesses,
      kind: kind,
      category: category,
      topics: topics,
      signal: signal,
      confidence: confidence,
      reasons: reasons,
      alternativeCategories: alternativeCategories,
      isPiPackage: isPiPackage
    };
  }

  return {
    classifyManifest: classifyManifest,
    scoreBestSkillCategory: scoreBestSkillCategory,
    scoreBestMcpCategory: scoreBestMcpCategory,
    suggestTopics: suggestTopics
  };
}));
