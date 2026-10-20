/* Agent Builder Studio WebUI — zero-build plain JS (no bundler, no npm deps).
 *
 * Depends on ./core/compiler.js (global `Compiler`), ./core/importer.js
 * (global `Importer`), and ./core/classifier.js (global `Classifier`).
 * Registry: window.__EMBEDDED_REGISTRY__ (if present), else fetch('./registry.json'),
 * else fallback to https://heretek-ai.github.io/Agent-Builder/registry.json.
 */
(function () {
  'use strict';

  var REGISTRY_LOCAL = './registry.json';
  var REGISTRY_REMOTE = 'https://heretek-ai.github.io/Agent-Builder/registry.json';
  var LS_LLM_KEY = 'heretek_agent_builder_llm_key';
  var GITHUB_ISSUE_BASE = 'https://github.com/Heretek-AI/Agent-Builder/issues/new';

  var HARNESS_TO_TAB = {
    'opencode-v2': 'v2',
    'opencode-v1': 'v1',
    'opencode-md': 'opencodeMd',
    pi: 'pi',
    claude: 'claude',
    codex: 'codex',
    gemini: 'gemini',
    cursor: 'cursor',
    windsurf: 'windsurf',
    copilot: 'copilot',
  };

  var TAB_TO_HARNESS = {
    v2: 'opencode-v2',
    v1: 'opencode-v1',
    opencodeMd: 'opencode-md',
    pi: 'pi',
    claude: 'claude',
    codex: 'codex',
    gemini: 'gemini',
    cursor: 'cursor',
    windsurf: 'windsurf',
    copilot: 'copilot',
  };

  var state = {
    registry: null,
    entries: [],
    studioTab: 'all',
    kindFilter: '',
    categoryFilter: '',
    harnessFilter: '',
    languageFilter: '',
    platformFilter: '',
    query: '',
    selectedIds: [],
    // Persistent per-MCP-server tool scoping state:
    // serverName -> { allowAll: boolean, deniedTools: Object<tool,bool>, allowResources: boolean, customTools: string[], isCustomServer?: boolean }
    mcpConfig: {},
    customServers: [], // [{ server: 'sqlite-local', tools: ['read_query', 'write_query'] }]
    harness: 'opencode-v2',
    previewTab: 'v2',
    lastCompiled: null,
    lastScoutEntry: null,
    inspectedEntryId: null,
    localBridgeActive: false,
  };

  function $(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function showToast(message, tone) {
    var container = $('toastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    var borderCol = tone === 'warn' ? 'border-rose-500/50 text-rose-200' : 'border-teal-500/50 text-teal-200';
    toast.className = 'glass-panel px-3.5 py-2 rounded-xl border ' + borderCol +
      ' shadow-xl text-xs font-medium pointer-events-auto transition-opacity duration-200 bg-slate-950/95';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 220);
    }, 2400);
  }

  function copyText(text, label) {
    var msg = label || 'Copied to clipboard';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showToast(msg);
      }).catch(function () {
        fallbackCopy(text, msg);
      });
    } else {
      fallbackCopy(text, msg);
    }
  }

  function fallbackCopy(text, msg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast(msg);
    } catch (_e) {
      showToast('Copy failed', 'warn');
    }
    ta.remove();
  }

  function highlight(text) {
    var esc = escHtml(text);
    esc = esc.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?/g, function (m, str, colon) {
      return '<span class="s">' + str + '</span>' + (colon ? colon : '');
    });
    esc = esc.replace(/(^|\n)(#[^\n]*)/g, '$1<span class="c">$2</span>');
    return esc;
  }

  function base64UrlEncode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlDecode(s) {
    var b64 = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) { b64 += '='; }
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
    return new TextDecoder().decode(bytes);
  }

  function serverNameOf(entry) {
    if (entry && entry.mcp && (entry.mcp.server_name || entry.mcp.serverName)) {
      return entry.mcp.server_name || entry.mcp.serverName;
    }
    return entry ? entry.id : '';
  }

  function toolsOf(entry) {
    var base = [];
    if (entry && entry.mcp && Array.isArray(entry.mcp.tools)) {
      base = entry.mcp.tools.map(function (t) { return String(t); });
    }
    var srv = serverNameOf(entry);
    var cfg = state.mcpConfig[srv];
    if (cfg && Array.isArray(cfg.customTools)) {
      cfg.customTools.forEach(function (ct) {
        if (base.indexOf(ct) === -1) base.push(ct);
      });
    }
    return base;
  }

  function ensureMcpConfig(server, defaultTools) {
    if (!state.mcpConfig[server]) {
      state.mcpConfig[server] = {
        allowAll: true,
        deniedTools: {},
        allowResources: false,
        customTools: Array.isArray(defaultTools) ? defaultTools.slice() : [],
      };
    }
    return state.mcpConfig[server];
  }

  // ---- Local CLI Bridge Probe ----

  function probeLocalBridge() {
    fetch('/api/status', { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('not local');
        return res.json();
      })
      .then(function (data) {
        if (data && data.mode === 'local-cli') {
          state.localBridgeActive = true;
          var badge = $('bridgeModeBadge');
          if (badge) {
            badge.textContent = 'Local CLI Bridge Active (v' + (data.version || '0.1.0') + ')';
            badge.className = 'text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
          }
        }
      })
      .catch(function () {
        state.localBridgeActive = false;
      });
  }

  // ---- Studio Navigation Tabs ----

  function switchStudioTab(tabName, scrollIntoView) {
    state.studioTab = tabName;
    var btns = document.querySelectorAll('.studio-tab-btn');
    btns.forEach(function (b) {
      if (b.dataset.studioTab === tabName) {
        b.className = 'studio-tab-btn tab-active px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-800 transition flex items-center gap-1.5 whitespace-nowrap';
      } else {
        b.className = 'studio-tab-btn px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 border border-transparent transition flex items-center gap-1.5 whitespace-nowrap';
      }
    });
    var views = ['explorer', 'harness', 'scope', 'scout'];
    views.forEach(function (v) {
      var el = $('view-' + v);
      if (el) {
        if (tabName === 'all' || v === tabName) {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
    });
    if (scrollIntoView && tabName !== 'all') {
      var target = $('view-' + tabName);
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  // ---- Registry Loading ----

  function setStatus(text, ok) {
    var el = $('registryStatus');
    if (!el) return;
    el.textContent = text;
    el.style.borderColor = ok === undefined ? '' : (ok ? 'var(--allow)' : 'var(--deny)');
  }

  function applyRegistryPayload(data) {
    if (!data || !Array.isArray(data.entries)) {
      throw new Error('registry payload has no entries array');
    }
    state.registry = data;
    state.entries = data.entries.slice();
    setStatus(state.entries.length + ' entries loaded', true);
    if ($('badgeRegistryCount')) {
      $('badgeRegistryCount').textContent = String(state.entries.length);
    }
    buildFilters();
    buildCategoryTree();
    renderCards();
    restoreRecipeFromUrl();
    if (state.selectedIds.length === 0 && !location.search.match(/[?&]recipe=/)) {
      loadAgentPreset('db-security-auditor', true);
    } else {
      renderAll();
    }
    runScoutClassifier();
  }

  function loadRegistry() {
    if (typeof window !== 'undefined' && window.__EMBEDDED_REGISTRY__ && Array.isArray(window.__EMBEDDED_REGISTRY__.entries)) {
      try {
        applyRegistryPayload(window.__EMBEDDED_REGISTRY__);
        return Promise.resolve();
      } catch (_e) { /* fall through */ }
    }
    return fetch(REGISTRY_LOCAL, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) { throw new Error('local registry HTTP ' + res.status); }
        return res.json();
      })
      .catch(function () {
        return fetch(REGISTRY_REMOTE, { cache: 'no-store' }).then(function (res) {
          if (!res.ok) { throw new Error('remote registry HTTP ' + res.status); }
          return res.json();
        });
      })
      .then(applyRegistryPayload)
      .catch(function (err) {
        setStatus('registry failed: ' + err.message, false);
        $('resultCount').textContent = 'Could not load registry.json locally or remotely.';
      });
  }

  // ---- Curated Agent Presets ----

  var BUILTIN_PRESETS = {
    'db-security-auditor': {
      slug: 'db-security-auditor',
      description: 'Database security auditor with Rust/SQL skills and read-only Postgres MCP',
      mode: 'subagent',
      model: 'anthropic/claude-sonnet-4-5',
      prompt: 'Audit SQL queries, schema migrations, and role grants for SQL injection, missing row-level security, and privilege escalation. Never run destructive DDL.',
      skills: ['rust-secure-coding', 'postgres-query-tuning', 'secure-code-audit'],
      mcpConfig: {
        'postgres-prod': { allowAll: true, deniedTools: { drop_table: true }, allowResources: true, customTools: ['drop_table'] },
      },
      mcpEntryIds: ['postgres-mcp-connector'],
    },
    'fullstack-polyglot-agent': {
      slug: 'fullstack-polyglot-agent',
      description: 'Polyglot full-stack engineer with Python, TypeScript, Go, and GitHub MCP',
      mode: 'subagent',
      model: 'anthropic/claude-sonnet-4-5',
      prompt: 'Build and review full-stack web services across Python FastAPI, TypeScript/React, and Go microservices with unit test coverage.',
      skills: ['python-fastapi-service', 'typescript-strict-patterns', 'go-concurrency-patterns', 'unit-property-testing'],
      mcpConfig: {
        github: { allowAll: true, deniedTools: {}, allowResources: false, customTools: [] },
      },
      mcpEntryIds: ['github-code-intel-mcp'],
    },
    'frontend-design-agent': {
      slug: 'frontend-design-agent',
      description: 'Frontend UI specialist pairing WebUI accessibility skills with SaaS DESIGN.md and Figma MCP',
      mode: 'subagent',
      model: 'anthropic/claude-sonnet-4-5',
      prompt: 'Translate Figma design tokens and SaaS DESIGN.md rules into responsive, WCAG AA accessible WebUI components.',
      skills: ['webui-design-systems', 'saas-dashboard-design-md', 'playwright-e2e-testing'],
      mcpConfig: {
        figma: { allowAll: true, deniedTools: {}, allowResources: true, customTools: [] },
      },
      mcpEntryIds: ['figma-design-mcp'],
    },
    'sre-database-agent': {
      slug: 'sre-database-agent',
      description: 'SRE incident responder with Kubernetes and read-only Postgres observability',
      mode: 'subagent',
      model: 'anthropic/claude-sonnet-4-5',
      prompt: 'Diagnose production Kubernetes pod failures, inspect logs, and run read-only Postgres diagnostic queries.',
      skills: ['kubernetes-helm-ops', 'ci-cd-observability-ops', 'postgres-query-tuning'],
      mcpConfig: {
        kubernetes: { allowAll: true, deniedTools: {}, allowResources: false, customTools: [] },
        'postgres-prod': { allowAll: true, deniedTools: {}, allowResources: false, customTools: [] },
      },
      mcpEntryIds: ['k8s-observe-mcp', 'postgres-mcp-connector'],
    },
    'pi-codemode-architect': {
      slug: 'pi-codemode-architect',
      description: 'Pi (earendil-works/pi) architect agent using QuickJS codemode and deferred MCP tool search',
      mode: 'primary',
      model: 'anthropic/claude-opus-4-7',
      prompt: 'Operate inside the Pi terminal harness using QuickJS codemode to compose multi-step file, git, and security review workflows.',
      skills: ['subagent-orchestrator', 'rust-secure-coding', 'typescript-strict-patterns'],
      mcpConfig: {
        github: { allowAll: true, deniedTools: {}, allowResources: true, customTools: [] },
        filesystem: { allowAll: true, deniedTools: { write_file: true }, allowResources: false, customTools: [] },
      },
      mcpEntryIds: ['github-code-intel-mcp', 'filesystem-shell-mcp'],
      harness: 'pi',
      piThinking: 'high',
    },
  };

  function loadAgentPreset(presetKey, silent) {
    var p = BUILTIN_PRESETS[presetKey];
    var regEntry = entryById(presetKey);
    if (!p && regEntry && regEntry.agent_preset) {
      var ap = regEntry.agent_preset;
      var mcpEntryIds = [];
      var mcpCfg = {};
      (ap.mcp_selections || []).forEach(function (sel) {
        var match = findMcpEntryByServerName(sel.server);
        if (match && mcpEntryIds.indexOf(match.id) === -1) mcpEntryIds.push(match.id);
        var deniedMap = {};
        if (match && Array.isArray(sel.tools) && sel.tools.indexOf('*') === -1) {
          toolsOf(match).forEach(function (t) {
            if (sel.tools.indexOf(t) === -1) deniedMap[t] = true;
          });
        }
        mcpCfg[sel.server] = {
          allowAll: !Array.isArray(sel.tools) || sel.tools.indexOf('*') !== -1,
          deniedTools: deniedMap,
          allowResources: Boolean(sel.allow_resources || sel.allowResources),
          customTools: [],
        };
      });
      p = {
        slug: regEntry.id,
        description: regEntry.description || regEntry.tagline || '',
        mode: ap.mode || 'subagent',
        model: ap.model || 'anthropic/claude-sonnet-4-5',
        prompt: ap.prompt || '',
        skills: (ap.skills || []).slice(),
        mcpConfig: mcpCfg,
        mcpEntryIds: mcpEntryIds,
      };
    }
    if (!p) return;

    $('agentSlug').value = p.slug;
    $('agentDescription').value = p.description;
    $('agentMode').value = p.mode || 'subagent';
    $('agentModel').value = p.model || '';
    $('agentPrompt').value = p.prompt || '';

    state.selectedIds = [];
    state.mcpConfig = {};
    (p.skills || []).forEach(function (id) {
      if (entryById(id) && state.selectedIds.indexOf(id) === -1) {
        state.selectedIds.push(id);
      }
    });
    (p.mcpEntryIds || []).forEach(function (id) {
      if (entryById(id) && state.selectedIds.indexOf(id) === -1) {
        state.selectedIds.push(id);
      }
    });
    if (p.mcpConfig) {
      Object.keys(p.mcpConfig).forEach(function (srv) {
        state.mcpConfig[srv] = JSON.parse(JSON.stringify(p.mcpConfig[srv]));
      });
    }
    if (p.piThinking && $('piThinkingLevel')) {
      $('piThinkingLevel').value = p.piThinking;
    }
    if (p.harness) {
      selectTargetHarness(p.harness);
    }
    renderAll();
    runSimulator();
    if (!silent) {
      showToast('Loaded agent preset: ' + p.slug);
    }
  }

  function findMcpEntryByServerName(serverName) {
    var normTarget = Compiler.normalizeMcpId(serverName || '');
    for (var i = 0; i < state.entries.length; i++) {
      var e = state.entries[i];
      if (e.kind === 'mcp-server' && Compiler.normalizeMcpId(serverNameOf(e)) === normTarget) {
        return e;
      }
    }
    return null;
  }

  // ---- Filters + Category Tree ----

  function uniqueSorted(values) {
    var seen = {};
    var out = [];
    values.forEach(function (v) {
      if (typeof v !== 'string' || v === '' || seen[v]) { return; }
      seen[v] = true;
      out.push(v);
    });
    out.sort();
    return out;
  }

  function buildFilters() {
    var harnesses = ['pi'];
    var languages = [];
    var platforms = [];
    state.entries.forEach(function (e) {
      (e.harnesses || []).forEach(function (h) { harnesses.push(h); });
      (e.languages || []).forEach(function (l) { languages.push(l); });
      (e.platforms || []).forEach(function (p) { platforms.push(p); });
    });
    fillSelect($('harnessFilter'), uniqueSorted(harnesses));
    fillSelect($('languageFilter'), uniqueSorted(languages));
    fillSelect($('platformFilter'), uniqueSorted(platforms));
  }

  function fillSelect(sel, values) {
    var first = sel.options[0];
    var cur = sel.value;
    sel.innerHTML = '';
    sel.appendChild(first);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
    sel.value = cur;
  }

  function categoryLabel(node) {
    return node.title || node.id;
  }

  function countForCategory(catId) {
    if (!catId) return state.entries.length;
    var count = 0;
    for (var i = 0; i < state.entries.length; i++) {
      var c = state.entries[i].category || '';
      if (c === catId || c.indexOf(catId + '/') === 0) count++;
    }
    return count;
  }

  function buildCategoryTree() {
    var tree = $('categoryTree');
    tree.innerHTML = '';
    var root = document.createElement('ul');
    var allLi = document.createElement('li');
    allLi.appendChild(treeItem('', 'All Registry Entries (' + state.entries.length + ')'));
    root.appendChild(allLi);
    var cats = (state.registry && state.registry.taxonomy && state.registry.taxonomy.categories) || [];
    cats.forEach(function (top) {
      root.appendChild(treeNode(top));
    });
    tree.appendChild(root);
  }

  function treeNode(node) {
    var li = document.createElement('li');
    var cnt = countForCategory(node.id);
    li.appendChild(treeItem(node.id, categoryLabel(node) + ' (' + cnt + ')'));
    if (Array.isArray(node.children) && node.children.length > 0) {
      var ul = document.createElement('ul');
      node.children.forEach(function (child) {
        ul.appendChild(treeNode(child));
      });
      li.appendChild(ul);
    }
    return li;
  }

  function treeItem(id, label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.category = id;
    if (state.categoryFilter === id) { b.classList.add('active'); }
    b.addEventListener('click', function () {
      setCategoryFilter(id);
    });
    return b;
  }

  function setCategoryFilter(id) {
    state.categoryFilter = id;
    var btns = $('categoryTree').querySelectorAll('button');
    btns.forEach(function (x) {
      x.classList.toggle('active', x.dataset.category === id);
    });
    renderCards();
  }

  function setKindFilter(kind) {
    state.kindFilter = kind;
    var pills = document.querySelectorAll('.kind-pill-btn');
    pills.forEach(function (b) {
      if ((b.dataset.kindPill || '') === kind) {
        b.className = 'kind-pill-btn tab-active px-2.5 py-1 rounded text-[11px] font-mono border border-slate-800 transition';
      } else {
        b.className = 'kind-pill-btn px-2.5 py-1 rounded text-[11px] font-mono text-slate-400 hover:text-slate-200 border border-transparent transition';
      }
    });
    renderCards();
  }

  function clearAllFilters() {
    state.categoryFilter = '';
    state.kindFilter = '';
    state.harnessFilter = '';
    state.languageFilter = '';
    state.platformFilter = '';
    state.query = '';
    $('searchInput').value = '';
    $('harnessFilter').value = '';
    $('languageFilter').value = '';
    $('platformFilter').value = '';
    setKindFilter('');
    buildCategoryTree();
    renderCards();
    showToast('Cleared all explorer filters');
  }

  function updateFilterBreadcrumb() {
    var bar = $('activeFilterBar');
    var txt = $('activeFilterText');
    if (!bar || !txt) return;
    var active = [];
    if (state.kindFilter) active.push('kind=' + state.kindFilter);
    if (state.categoryFilter) active.push('category=' + state.categoryFilter);
    if (state.harnessFilter) active.push('harness=' + state.harnessFilter);
    if (state.languageFilter) active.push('lang=' + state.languageFilter);
    if (state.platformFilter) active.push('platform=' + state.platformFilter);
    if (state.query.trim()) active.push('search="' + state.query.trim() + '"');
    if (active.length === 0) {
      bar.classList.add('hidden');
      bar.classList.remove('flex');
    } else {
      bar.classList.remove('hidden');
      bar.classList.add('flex');
      txt.textContent = 'Active filters: ' + active.join(' · ');
    }
  }

  function filteredEntries() {
    var q = state.query.trim().toLowerCase();
    return state.entries.filter(function (e) {
      if (state.kindFilter && e.kind !== state.kindFilter) {
        return false;
      }
      if (state.categoryFilter && !(e.category === state.categoryFilter ||
          e.category.indexOf(state.categoryFilter + '/') === 0)) {
        return false;
      }
      if (state.harnessFilter) {
        var hList = e.harnesses || [];
        if (state.harnessFilter === 'pi') {
          if (hList.indexOf('pi') === -1 && hList.indexOf('universal') === -1 && hList.indexOf('opencode') === -1) {
            return false;
          }
        } else if (hList.indexOf(state.harnessFilter) === -1 && hList.indexOf('universal') === -1) {
          return false;
        }
      }
      if (state.languageFilter && (e.languages || []).indexOf(state.languageFilter) === -1) { return false; }
      if (state.platformFilter && (e.platforms || []).indexOf(state.platformFilter) === -1) { return false; }
      if (q) {
        var hay = [
          e.id, e.name, e.tagline, e.description, e.category,
          (e.tags || []).join(' '),
          toolsOf(e).join(' '),
        ].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) { return false; }
      }
      return true;
    });
  }

  function renderCards() {
    updateFilterBreadcrumb();
    var list = filteredEntries();
    $('resultCount').textContent = list.length + ' of ' + state.entries.length + ' entries';
    var wrap = $('cards');
    wrap.innerHTML = '';

    if (list.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'col-span-full text-center py-10 px-4 border border-dashed border-slate-800 rounded-xl space-y-2';
      empty.innerHTML = '<p class="text-xs text-slate-300 font-medium">No registry entries match your current filter combination.</p>' +
        '<p class="text-[11px] text-slate-500">Click Reset Filters to view all ' + state.entries.length + ' registry entries.</p>';
      wrap.appendChild(empty);
      return;
    }

    list.slice(0, 400).forEach(function (e) {
      var isAgentPreset = e.kind === 'agent' || e.kind === 'agent-preset' || Boolean(e.agent_preset);
      var already = state.selectedIds.indexOf(e.id) !== -1;
      var card = document.createElement('div');
      card.className = 'entry-card' + (already ? ' selected-card' : '');

      var topDiv = document.createElement('div');

      // Title row with clickable Inspect trigger + external Repo link
      var headerRow = document.createElement('div');
      headerRow.className = 'flex items-start justify-between gap-2 mb-1';

      var h3 = document.createElement('h3');
      h3.className = 'cursor-pointer hover:text-teal-300 transition leading-snug';
      h3.title = 'Click to inspect full entry details, tools, and YAML';
      h3.textContent = e.name;
      h3.addEventListener('click', function () { openEntryDetailModal(e); });
      headerRow.appendChild(h3);

      if (e.repo) {
        var repoA = document.createElement('a');
        repoA.href = e.repo;
        repoA.target = '_blank';
        repoA.rel = 'noopener noreferrer';
        repoA.className = 'text-[10px] font-mono text-slate-400 hover:text-teal-300 shrink-0 no-underline px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800';
        repoA.title = 'Open upstream repository: ' + e.repo;
        repoA.textContent = 'Repo ↗';
        headerRow.appendChild(repoA);
      }
      topDiv.appendChild(headerRow);

      var taglineP = document.createElement('p');
      taglineP.className = 'tagline';
      taglineP.textContent = e.tagline || '';
      topDiv.appendChild(taglineP);

      // Interactive filter badges
      var badgesDiv = document.createElement('div');
      badgesDiv.className = 'badges';

      var kindBadge = document.createElement('button');
      kindBadge.type = 'button';
      kindBadge.className = 'badge kind-' + e.kind;
      kindBadge.title = 'Filter by kind: ' + e.kind;
      kindBadge.textContent = e.kind;
      kindBadge.addEventListener('click', function () {
        setKindFilter(state.kindFilter === e.kind ? '' : e.kind);
        showToast('Filtered by kind: ' + e.kind);
      });
      badgesDiv.appendChild(kindBadge);

      var catBadge = document.createElement('button');
      catBadge.type = 'button';
      catBadge.className = 'badge';
      catBadge.title = 'Filter by category: ' + e.category;
      catBadge.textContent = e.category;
      catBadge.addEventListener('click', function () {
        setCategoryFilter(state.categoryFilter === e.category ? '' : e.category);
        showToast('Filtered by category: ' + e.category);
      });
      badgesDiv.appendChild(catBadge);

      (e.harnesses || []).forEach(function (h) {
        var hb = document.createElement('button');
        hb.type = 'button';
        hb.className = 'badge';
        hb.title = 'Filter by client harness: ' + h;
        hb.textContent = h;
        hb.addEventListener('click', function () {
          $('harnessFilter').value = h;
          state.harnessFilter = h;
          renderCards();
          showToast('Filtered by harness: ' + h);
        });
        badgesDiv.appendChild(hb);
      });

      if (e.kind === 'mcp-server') {
        var tb = document.createElement('button');
        tb.type = 'button';
        tb.className = 'badge kind-mcp-server';
        tb.title = 'Click to inspect MCP tools: ' + toolsOf(e).join(', ');
        tb.textContent = toolsOf(e).length + ' tools';
        tb.addEventListener('click', function () { openEntryDetailModal(e); });
        badgesDiv.appendChild(tb);
      }

      topDiv.appendChild(badgesDiv);
      card.appendChild(topDiv);

      // Action buttons row
      var actionsRow = document.createElement('div');
      actionsRow.className = 'flex items-center gap-1.5 pt-1';

      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      if (isAgentPreset) {
        var isCurrentPreset = ($('agentSlug').value || '').trim() === e.id;
        addBtn.className = 'flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition ' +
          (isCurrentPreset
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
            : 'bg-teal-500 hover:bg-teal-400 text-slate-950');
        addBtn.textContent = isCurrentPreset ? '✓ Preset Active (Reload)' : '⚡ Load Agent Preset';
        addBtn.addEventListener('click', function () {
          loadAgentPreset(e.id, false);
        });
      } else {
        addBtn.className = 'flex-1 py-1.5 px-2.5 rounded-lg text-xs font-semibold transition ' +
          (already
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/40'
            : 'bg-slate-800 hover:bg-teal-500 hover:text-slate-950 text-teal-300 border border-slate-700');
        addBtn.textContent = already ? '✓ In Agent (Remove)' : '+ Add to Agent';
        addBtn.addEventListener('click', function () {
          if (state.selectedIds.indexOf(e.id) !== -1) {
            removeFromAgent(e.id);
          } else {
            addToAgent(e.id);
          }
        });
      }

      var inspectBtn = document.createElement('button');
      inspectBtn.type = 'button';
      inspectBtn.className = 'py-1.5 px-2.5 rounded-lg text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 transition';
      inspectBtn.title = 'Inspect full entry details, tools, and YAML';
      inspectBtn.textContent = 'Inspect';
      inspectBtn.addEventListener('click', function () { openEntryDetailModal(e); });

      actionsRow.appendChild(addBtn);
      actionsRow.appendChild(inspectBtn);
      card.appendChild(actionsRow);
      wrap.appendChild(card);
    });
  }

  // ---- Entry Inspector Modal ----

  function entryToYamlString(e) {
    var lines = [
      'id: ' + e.id,
      'name: ' + JSON.stringify(e.name || e.id),
      'repo: ' + (e.repo || 'https://github.com/Heretek-AI/Agent-Builder'),
      'tagline: ' + JSON.stringify(e.tagline || ''),
      'description: ' + JSON.stringify(e.description || e.tagline || ''),
      'kind: ' + e.kind,
      'category: ' + e.category,
      'harnesses: [' + (e.harnesses || ['universal']).join(', ') + ']',
    ];
    if (e.languages && e.languages.length) lines.push('languages: [' + e.languages.join(', ') + ']');
    if (e.platforms && e.platforms.length) lines.push('platforms: [' + e.platforms.join(', ') + ']');
    if (e.mcp) {
      lines.push('mcp:');
      if (e.mcp.server_name) lines.push('  server_name: ' + e.mcp.server_name);
      if (e.mcp.command) lines.push('  command: ' + e.mcp.command);
      if (e.mcp.args) lines.push('  args: ' + JSON.stringify(e.mcp.args));
      if (e.mcp.tools) lines.push('  tools: [' + e.mcp.tools.join(', ') + ']');
    }
    if (e.license) lines.push('license: ' + e.license);
    return lines.join('\n') + '\n';
  }

  function openEntryDetailModal(entry) {
    if (!entry) return;
    state.inspectedEntryId = entry.id;
    $('entryDetailTitle').textContent = entry.name || entry.id;
    $('entryDetailKind').textContent = entry.kind;
    $('entryDetailIdCat').textContent = entry.id + ' · ' + entry.category;
    $('entryDetailRepoLink').href = entry.repo || 'https://github.com/Heretek-AI/Agent-Builder';

    var html = [];
    html.push('<p class="text-slate-200 leading-relaxed">' + escHtml(entry.description || entry.tagline || '') + '</p>');

    // Metadata grid
    html.push('<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] font-mono">');
    html.push('<div><span class="text-slate-500">Harnesses:</span> <span class="text-teal-300">' + escHtml((entry.harnesses || []).join(', ')) + '</span></div>');
    html.push('<div><span class="text-slate-500">License:</span> <span class="text-slate-200">' + escHtml(entry.license || 'MIT') + '</span></div>');
    if (entry.languages && entry.languages.length) {
      html.push('<div><span class="text-slate-500">Languages:</span> <span class="text-slate-200">' + escHtml(entry.languages.join(', ')) + '</span></div>');
    }
    if (entry.platforms && entry.platforms.length) {
      html.push('<div><span class="text-slate-500">Platforms:</span> <span class="text-slate-200">' + escHtml(entry.platforms.join(', ')) + '</span></div>');
    }
    if (entry.npm) {
      html.push('<div class="sm:col-span-2"><span class="text-slate-500">NPM Package:</span> <a href="https://www.npmjs.com/package/' + encodeURIComponent(entry.npm) + '" target="_blank" rel="noopener" class="text-teal-400 underline">' + escHtml(entry.npm) + ' ↗</a></div>');
    }
    if (entry.source_attribution) {
      html.push('<div class="sm:col-span-2"><span class="text-slate-500">Attribution:</span> <span class="text-slate-400">' + escHtml(entry.source_attribution) + '</span></div>');
    }
    html.push('</div>');

    if (entry.kind === 'mcp-server' && entry.mcp) {
      var srv = serverNameOf(entry);
      var tList = toolsOf(entry);
      var cmdStr = entry.mcp.command ? (entry.mcp.command + ' ' + (entry.mcp.args || []).join(' ')) : (entry.mcp.url || '');
      html.push('<div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">');
      html.push('<div class="flex items-center justify-between"><span class="font-semibold text-teal-300">MCP Server: <code>' + escHtml(srv) + '</code></span><span class="text-[11px] font-mono text-slate-400">' + tList.length + ' verified tools</span></div>');
      if (cmdStr) {
        html.push('<div class="text-[11px] font-mono bg-slate-950 p-2 rounded border border-slate-800 text-slate-300">Command: <code>' + escHtml(cmdStr) + '</code></div>');
      }
      html.push('<div class="flex flex-wrap gap-1.5 pt-1">' + tList.map(function (t) {
        return '<span class="px-2 py-0.5 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-teal-200">' + escHtml(Compiler.normalizeMcpId(srv) + '_' + Compiler.normalizeMcpId(t)) + '</span>';
      }).join('') + '</div>');
      html.push('</div>');
    }

    if (entry.agent_preset) {
      var ap = entry.agent_preset;
      html.push('<div class="p-3 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">');
      html.push('<div class="font-semibold text-emerald-300">Agent Preset Configuration</div>');
      html.push('<div class="text-[11px] font-mono text-slate-300">Mode: <code>' + escHtml(ap.mode || 'subagent') + '</code> · Model: <code>' + escHtml(ap.model || 'default') + '</code></div>');
      html.push('<div class="text-[11px] font-mono bg-slate-950 p-2.5 rounded border border-slate-800 text-slate-200">' + escHtml(ap.prompt || '') + '</div>');
      html.push('</div>');
    }

    var yamlStr = entryToYamlString(entry);
    html.push('<div><div class="text-[11px] font-mono uppercase text-slate-400 mb-1">Catalog Entry YAML</div>' +
      '<pre class="bg-[#05080f] p-3 rounded-xl border border-slate-800 text-[11px] font-mono text-teal-100 max-h-44 overflow-y-auto"><code>' + escHtml(yamlStr) + '</code></pre></div>');

    $('entryDetailBody').innerHTML = html.join('');

    var actBtn = $('entryDetailActionBtn');
    var isAgent = entry.kind === 'agent' || entry.kind === 'agent-preset' || Boolean(entry.agent_preset);
    var already = state.selectedIds.indexOf(entry.id) !== -1;
    if (isAgent) {
      actBtn.textContent = '⚡ Load Agent Preset into Workbench';
      actBtn.onclick = function () {
        loadAgentPreset(entry.id, false);
        $('entryDetailModal').hidden = true;
      };
    } else {
      actBtn.textContent = already ? '✓ Remove from Active Agent' : '+ Add to Active Agent';
      actBtn.onclick = function () {
        if (state.selectedIds.indexOf(entry.id) !== -1) {
          removeFromAgent(entry.id);
        } else {
          addToAgent(entry.id);
        }
        $('entryDetailModal').hidden = true;
      };
    }

    $('entryDetailCopyYamlBtn').onclick = function () {
      copyText(yamlStr, 'Copied YAML for ' + entry.id);
    };

    $('entryDetailModal').hidden = false;
  }

  // ---- Recipe & Selection State ----

  function entryById(id) {
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i].id === id) { return state.entries[i]; }
    }
    return null;
  }

  function addToAgent(id) {
    var entry = entryById(id);
    if (entry && (entry.kind === 'agent' || entry.kind === 'agent-preset' || entry.agent_preset)) {
      loadAgentPreset(id, false);
      return;
    }
    if (state.selectedIds.indexOf(id) === -1) {
      state.selectedIds.push(id);
      if (entry && entry.kind === 'mcp-server') {
        ensureMcpConfig(serverNameOf(entry));
      }
      showToast('Added ' + (entry ? entry.name : id) + ' to active agent');
    }
    renderAll();
    runSimulator();
  }

  function removeFromAgent(id) {
    var entry = entryById(id);
    state.selectedIds = state.selectedIds.filter(function (x) { return x !== id; });
    renderAll();
    runSimulator();
    showToast('Removed ' + (entry ? entry.name : id) + ' from agent', 'warn');
  }

  function selectedEntries() {
    return state.selectedIds.map(entryById).filter(Boolean);
  }

  function readMcpSelections() {
    var selections = [];
    selectedEntries().forEach(function (e) {
      if (e.kind !== 'mcp-server') { return; }
      var server = serverNameOf(e);
      var tools = toolsOf(e);
      var cfg = ensureMcpConfig(server);
      var allowed = [];
      var denied = [];
      tools.forEach(function (t) {
        if (cfg.deniedTools && cfg.deniedTools[t]) {
          denied.push(t);
        } else {
          allowed.push(t);
        }
      });
      selections.push({
        server: server,
        tools: cfg.allowAll ? ['*'] : allowed,
        deniedTools: denied,
        allowResources: Boolean(cfg.allowResources),
      });
    });

    // Include custom added MCP servers
    state.customServers.forEach(function (cs) {
      var cfg = ensureMcpConfig(cs.server);
      var allTools = cs.tools.slice();
      (cfg.customTools || []).forEach(function (ct) {
        if (allTools.indexOf(ct) === -1) allTools.push(ct);
      });
      var allowed = [];
      var denied = [];
      allTools.forEach(function (t) {
        if (cfg.deniedTools && cfg.deniedTools[t]) denied.push(t);
        else allowed.push(t);
      });
      selections.push({
        server: cs.server,
        tools: cfg.allowAll ? ['*'] : allowed,
        deniedTools: denied,
        allowResources: Boolean(cfg.allowResources),
      });
    });

    return selections;
  }

  function currentPiOptions() {
    var toolsRaw = ($('piDefaultTools') && $('piDefaultTools').value) || '+codemode, +tool_search';
    var defaultTools = toolsRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return {
      thinkingLevel: ($('piThinkingLevel') && $('piThinkingLevel').value) || 'medium',
      mcpExposure: ($('piMcpExposure') && $('piMcpExposure').value) || 'codemode',
      defaultTools: defaultTools.length ? defaultTools : ['+codemode', '+tool_search'],
      codemodeMode: 'on',
      inlineBudget: 3000,
    };
  }

  function currentRecipe() {
    var skillIds = selectedEntries()
      .filter(function (e) { return e.kind !== 'mcp-server'; })
      .map(function (e) { return e.id; });
    var slug = ($('agentSlug').value || 'my-agent').trim() || 'my-agent';
    if ($('activeSlugPill')) {
      $('activeSlugPill').textContent = slug;
    }
    return {
      slug: slug,
      description: $('agentDescription').value || '',
      mode: $('agentMode').value || 'subagent',
      model: ($('agentModel').value || '').trim() || undefined,
      prompt: $('agentPrompt').value || '',
      skills: skillIds,
      mcpSelections: readMcpSelections(),
      piOptions: currentPiOptions(),
    };
  }

  function compileCurrent() {
    var recipe = currentRecipe();
    state.lastCompiled = Compiler.compileAgentRecipe(recipe, state.entries);
    return state.lastCompiled;
  }

  // ---- Selected List + Deny-First Scoping Matrix ----

  function renderSelected() {
    var list = $('selectedList');
    list.innerHTML = '';
    var sel = selectedEntries();
    var totalCount = sel.length + state.customServers.length;
    $('selectedCount').textContent = String(totalCount);
    if ($('dockSelectedBadge')) {
      $('dockSelectedBadge').textContent = totalCount + (totalCount === 1 ? ' item' : ' items');
    }

    if (totalCount === 0) {
      var emptyLi = document.createElement('li');
      emptyLi.className = 'text-xs text-slate-400 border-none bg-transparent p-0';
      emptyLi.textContent = 'No skills or MCP servers selected — click "+ Add to Agent" on any card or load a preset above.';
      list.appendChild(emptyLi);
      return;
    }

    sel.forEach(function (e) {
      var li = document.createElement('li');
      var infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'text-left hover:text-teal-300 p-0';
      infoBtn.title = 'Inspect ' + e.name;
      infoBtn.innerHTML = '<strong>' + escHtml(e.id) + '</strong> <span class="muted">(' + escHtml(e.kind) + ')</span>';
      infoBtn.addEventListener('click', function () { openEntryDetailModal(e); });
      li.appendChild(infoBtn);

      var rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '✕';
      rm.title = 'Remove ' + e.id;
      rm.addEventListener('click', function () { removeFromAgent(e.id); });
      li.appendChild(rm);
      list.appendChild(li);
    });

    state.customServers.forEach(function (cs, idx) {
      var li = document.createElement('li');
      li.innerHTML = '<span><strong>' + escHtml(cs.server) + '</strong> <span class="muted">(custom-mcp)</span></span> ';
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '✕';
      rm.title = 'Remove custom MCP ' + cs.server;
      rm.addEventListener('click', function () {
        state.customServers.splice(idx, 1);
        renderAll();
        runSimulator();
        showToast('Removed custom MCP server ' + cs.server, 'warn');
      });
      li.appendChild(rm);
      list.appendChild(li);
    });
  }

  function renderMatrix() {
    var wrap = $('scopeMatrix');
    wrap.innerHTML = '';
    var sel = selectedEntries();
    if (sel.length === 0 && state.customServers.length === 0) {
      wrap.innerHTML = '<p class="muted">Nothing selected yet — click &ldquo;+ Add to Agent&rdquo; in the Registry Explorer or add a custom MCP server above.</p>';
      return;
    }
    var nonMcp = sel.filter(function (e) { return e.kind !== 'mcp-server'; });
    if (nonMcp.length > 0) {
      var div = document.createElement('div');
      div.className = 'scope-server';
      div.innerHTML = '<h3>Allowed Skills / Plugins / DESIGN.md / Prompts (' + nonMcp.length + ')</h3>' +
        '<p class="muted mb-2">Compiled after leading <code>{"action": "skill", "resource": "*", "effect": "deny"}</code>.</p>';
      var ul = document.createElement('ul');
      ul.className = 'flex flex-wrap gap-2 list-none p-0 m-0';
      nonMcp.forEach(function (e) {
        var li = document.createElement('li');
        li.className = 'px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs font-mono text-emerald-300 flex items-center gap-1.5';
        li.innerHTML = '<span>allow: <code>' + escHtml(e.id) + '</code> <span class="muted">(' + escHtml(e.kind) + ')</span></span>';
        var rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'text-slate-400 hover:text-rose-400 ml-1';
        rmBtn.textContent = '✕';
        rmBtn.title = 'Remove ' + e.id;
        rmBtn.addEventListener('click', function () { removeFromAgent(e.id); });
        li.appendChild(rmBtn);
        ul.appendChild(li);
      });
      div.appendChild(ul);
      wrap.appendChild(div);
    }

    sel.filter(function (e) { return e.kind === 'mcp-server'; }).forEach(function (e) {
      wrap.appendChild(mcpServerBlock(e, false));
    });

    state.customServers.forEach(function (cs) {
      wrap.appendChild(mcpServerBlock({
        id: cs.server,
        name: cs.server,
        kind: 'mcp-server',
        mcp: { server_name: cs.server, command: 'npx', args: ['-y', cs.server], tools: cs.tools },
      }, true));
    });
  }

  function isWriteOrDestructiveTool(toolName) {
    return /write|delete|remove|drop|create|update|post|put|patch|exec|run|kill|deploy|modify|send/i.test(toolName);
  }

  function mcpServerBlock(entry, isCustom) {
    var server = serverNameOf(entry);
    var cfg = ensureMcpConfig(server);
    var tools = toolsOf(entry);
    var div = document.createElement('div');
    div.className = 'scope-server space-y-2.5';
    var norm = Compiler.normalizeMcpId(server);

    // Header bar with quick actions
    var topBar = document.createElement('div');
    topBar.className = 'flex flex-wrap items-center justify-between gap-2';
    var h3 = document.createElement('h3');
    h3.className = 'm-0';
    h3.innerHTML = escHtml(server) + ' <span class="muted">(<code>' + escHtml(norm) + '_*</code>)</span>';
    topBar.appendChild(h3);

    var quickBtns = document.createElement('div');
    quickBtns.className = 'flex flex-wrap items-center gap-1.5';

    var roBtn = document.createElement('button');
    roBtn.type = 'button';
    roBtn.className = 'px-2 py-0.5 rounded text-[11px] font-mono bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition';
    roBtn.textContent = '🔒 Read-Only Lockdown';
    roBtn.title = 'Automatically deny write/create/delete/drop tools and allow read/list/search/query tools';
    roBtn.addEventListener('click', function () {
      cfg.deniedTools = {};
      var deniedCount = 0;
      tools.forEach(function (t) {
        if (isWriteOrDestructiveTool(t)) {
          cfg.deniedTools[t] = true;
          deniedCount++;
        }
      });
      renderMatrix();
      renderPreview();
      runSimulator();
      showToast('Applied Read-Only Lockdown on ' + server + ' (' + deniedCount + ' mutating tool(s) denied)');
    });
    quickBtns.appendChild(roBtn);

    var allowAllBtn = document.createElement('button');
    allowAllBtn.type = 'button';
    allowAllBtn.className = 'px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-teal-300 border border-slate-700 transition';
    allowAllBtn.textContent = 'Allow All';
    allowAllBtn.addEventListener('click', function () {
      cfg.allowAll = true;
      cfg.deniedTools = {};
      renderMatrix();
      renderPreview();
      runSimulator();
      showToast('Allowed all tools on ' + server);
    });
    quickBtns.appendChild(allowAllBtn);

    if (!isCustom && entry.mcp && entry.mcp.command) {
      var introBtn = document.createElement('button');
      introBtn.type = 'button';
      introBtn.className = 'px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-purple-300 border border-slate-700 transition';
      introBtn.textContent = '⚡ Introspect';
      introBtn.title = 'Introspect live MCP tools via local CLI bridge (/api/mcp/introspect) or verify catalog tools';
      introBtn.addEventListener('click', function () {
        if (state.localBridgeActive) {
          fetch(withAbTokenUrl('/api/mcp/introspect'), {
            method: 'POST',
            headers: withAbToken({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ command: entry.mcp.command, args: entry.mcp.args || [] }),
          }).then(function (r) { return r.json(); }).then(function (data) {
            if (data && Array.isArray(data.tools)) {
              data.tools.forEach(function (tObj) {
                var tName = typeof tObj === 'string' ? tObj : (tObj && tObj.name);
                if (tName && cfg.customTools.indexOf(tName) === -1) cfg.customTools.push(tName);
              });
              renderMatrix();
              renderPreview();
              showToast('Introspected ' + data.tools.length + ' live tools from ' + server);
            } else {
              showToast('Catalog verified: ' + tools.length + ' tools on ' + server);
            }
          }).catch(function () {
            showToast('Catalog verified: ' + tools.length + ' tools on ' + server);
          });
        } else {
          showToast('Catalog verified: ' + tools.length + ' tools (' + tools.join(', ') + ')');
        }
      });
      quickBtns.appendChild(introBtn);
    }

    topBar.appendChild(quickBtns);
    div.appendChild(topBar);

    var grid = document.createElement('div');
    grid.className = 'tool-grid';

    var allowAllLabel = document.createElement('label');
    var allowAll = document.createElement('input');
    allowAll.type = 'checkbox';
    allowAll.checked = Boolean(cfg.allowAll);
    allowAll.setAttribute('data-server-allow-all', server);
    allowAllLabel.appendChild(allowAll);
    allowAllLabel.appendChild(document.createTextNode(' Allow wildcard (' + norm + '_*)'));
    grid.appendChild(allowAllLabel);

    tools.forEach(function (t) {
      var isDenied = Boolean(cfg.deniedTools && cfg.deniedTools[t]);
      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !isDenied;
      cb.setAttribute('data-server', server);
      cb.setAttribute('data-tool', t);
      label.appendChild(cb);
      var code = document.createElement('code');
      code.textContent = norm + '_' + Compiler.normalizeMcpId(t);
      if (isDenied) code.classList.add('denied');
      label.appendChild(code);
      grid.appendChild(label);
      cb.addEventListener('change', function () {
        if (cb.checked) {
          delete cfg.deniedTools[t];
        } else {
          cfg.deniedTools[t] = true;
        }
        code.classList.toggle('denied', !cb.checked);
        renderPreview();
        runSimulator();
      });
    });
    div.appendChild(grid);

    // Bottom row: Resource access + Add Custom Tool inline
    var bottomRow = document.createElement('div');
    bottomRow.className = 'flex flex-wrap items-center justify-between gap-2 pt-1';

    var resLabel = document.createElement('label');
    resLabel.className = 'text-xs text-slate-300 flex items-center gap-2 cursor-pointer m-0';
    var resCb = document.createElement('input');
    resCb.type = 'checkbox';
    resCb.checked = Boolean(cfg.allowResources);
    resCb.setAttribute('data-server-resources', server);
    resLabel.appendChild(resCb);
    resLabel.appendChild(document.createTextNode(
      ' Allow MCP resource access (opencode_list_mcp_resources / opencode_read_mcp_resource)'));
    bottomRow.appendChild(resLabel);

    var addToolWrap = document.createElement('div');
    addToolWrap.className = 'flex items-center gap-1';
    var toolInp = document.createElement('input');
    toolInp.type = 'text';
    toolInp.placeholder = 'Add tool name (e.g. drop_table)';
    toolInp.className = 'input-field px-2 py-0.5 text-[11px] font-mono w-44';
    var toolAddBtn = document.createElement('button');
    toolAddBtn.type = 'button';
    toolAddBtn.className = 'px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-teal-300 border border-slate-700';
    toolAddBtn.textContent = '+ Tool';
    toolAddBtn.addEventListener('click', function () {
      var val = (toolInp.value || '').trim();
      if (!val) return;
      if (cfg.customTools.indexOf(val) === -1 && tools.indexOf(val) === -1) {
        cfg.customTools.push(val);
      }
      toolInp.value = '';
      renderMatrix();
      renderPreview();
      runSimulator();
      showToast('Added tool ' + val + ' to ' + server);
    });
    addToolWrap.appendChild(toolInp);
    addToolWrap.appendChild(toolAddBtn);
    bottomRow.appendChild(addToolWrap);

    div.appendChild(bottomRow);

    allowAll.addEventListener('change', function () {
      cfg.allowAll = allowAll.checked;
      renderPreview();
      runSimulator();
    });
    resCb.addEventListener('change', function () {
      cfg.allowResources = resCb.checked;
      renderPreview();
      runSimulator();
    });
    return div;
  }

  // ---- Permission Simulator + Trace ----

  function applySimulatorPreset(preset) {
    var recipe = currentRecipe();
    if (preset === 'allowed-skill') {
      $('simAction').value = 'skill';
      $('simResource').value = recipe.skills[0] || 'rust-secure-coding';
    } else if (preset === 'blocked-skill') {
      $('simAction').value = 'skill';
      $('simResource').value = 'unlisted-rogue-skill';
    } else if (preset === 'mcp-tool') {
      var firstMcp = recipe.mcpSelections[0];
      if (firstMcp) {
        var normSrv = Compiler.normalizeMcpId(firstMcp.server);
        var sampleTool = (firstMcp.deniedTools && firstMcp.deniedTools[0]) ||
          (firstMcp.tools && firstMcp.tools[0] !== '*' ? firstMcp.tools[0] : 'execute_query');
        $('simAction').value = normSrv + '_' + Compiler.normalizeMcpId(sampleTool);
      } else {
        $('simAction').value = 'postgres-prod_execute_query';
      }
      $('simResource').value = '*';
    } else if (preset === 'mcp-resource') {
      var srvName = (recipe.mcpSelections[0] && recipe.mcpSelections[0].server) || 'postgres-prod';
      $('simAction').value = 'opencode_read_mcp_resource';
      $('simResource').value = Compiler.normalizeMcpId(srvName) + ':schema/public';
    }
    runSimulator();
  }

  function runSimulator() {
    var action = ($('simAction').value || '').trim();
    var resource = ($('simResource').value || '').trim() || '*';
    var out = $('simResult');
    var traceEl = $('simTraceOutput');
    if (!action) {
      out.textContent = 'enter an action';
      out.className = 'sim-result';
      if (traceEl) traceEl.textContent = '';
      return;
    }
    try {
      var compiled = compileCurrent();
      var perms = compiled.opencodeV2.agents[compiled.slug].permissions;
      var decision = Compiler.evaluateV2Permission(perms, action, resource);
      out.textContent = decision.toUpperCase();
      out.className = 'sim-result ' + decision;

      if (traceEl && typeof Compiler.traceV2Permission === 'function') {
        var tr = Compiler.traceV2Permission(perms, action, resource);
        if (tr.matchedIndex >= 0 && tr.matchedRule) {
          traceEl.innerHTML = 'Winning rule #' + (tr.matchedIndex + 1) + ' of ' + perms.length +
            ': <code>' + escHtml(JSON.stringify(tr.matchedRule)) + '</code>';
        } else {
          traceEl.textContent = 'No explicit rule matched — fell back to default allow.';
        }
      }
    } catch (err) {
      out.textContent = 'error: ' + err.message;
      out.className = 'sim-result';
    }
  }

  // ---- Target Harness <-> Preview Tab Synchronization ----

  function selectTargetHarness(harnessVal) {
    state.harness = harnessVal;
    var radios = document.querySelectorAll('input[name="harness"]');
    radios.forEach(function (r) {
      r.checked = (r.value === harnessVal);
    });
    if ($('activeHarnessPill')) {
      $('activeHarnessPill').textContent = harnessVal;
    }
    var piCard = $('piSettingsCard');
    if (piCard) {
      piCard.style.borderColor = harnessVal === 'pi' ? 'rgba(45, 212, 191, 0.65)' : '';
    }
    var mappedTab = HARNESS_TO_TAB[harnessVal];
    if (mappedTab) {
      selectPreviewTab(mappedTab, true);
    } else {
      renderPreview();
    }
  }

  function selectPreviewTab(tabKey, fromHarnessRadio) {
    state.previewTab = tabKey;
    var tabs = document.querySelectorAll('.preview-tab');
    tabs.forEach(function (t) {
      var isMatch = t.dataset.tab === tabKey;
      t.classList.toggle('active', isMatch);
      t.classList.toggle('tab-active', isMatch);
      if (isMatch) {
        t.className = 'preview-tab active tab-active px-2.5 py-1 rounded text-[11px] font-mono border border-slate-800 transition whitespace-nowrap';
      } else {
        t.className = 'preview-tab px-2.5 py-1 rounded text-[11px] font-mono text-slate-400 hover:text-slate-200 border border-transparent transition whitespace-nowrap';
      }
    });
    if (!fromHarnessRadio && TAB_TO_HARNESS[tabKey]) {
      state.harness = TAB_TO_HARNESS[tabKey];
      var radios = document.querySelectorAll('input[name="harness"]');
      radios.forEach(function (r) {
        r.checked = (r.value === state.harness);
      });
      if ($('activeHarnessPill')) {
        $('activeHarnessPill').textContent = state.harness;
      }
    }
    renderPreview();
  }

  // ---- Preview + Multi-Client Export ----

  var TAB_FILES = {
    v2: function (c) { return 'opencode.' + c.slug + '.v2.json'; },
    v1: function (c) { return 'opencode.' + c.slug + '.v1.json'; },
    opencodeMd: function (c) { return '.opencode/agent/' + c.slug + '.md'; },
    pi: function () { return '.pi/settings.json + .pi/mcp.json'; },
    claude: function (c) { return '.claude/agents/' + c.slug + '.md'; },
    codex: function (c) { return 'codex.' + c.slug + '.toml'; },
    gemini: function () { return '.gemini/settings.json'; },
    cursor: function (c) { return '.cursor/rules/' + c.slug + '.mdc'; },
    windsurf: function () { return '.windsurfrules'; },
    copilot: function () { return '.github/copilot-instructions.md'; },
    install: function (c) { return 'install-' + c.slug + '.txt'; },
  };

  // AB-5.2: the CLI (`bin/agent-builder.js install`) accepts
  // `--recipe <file.json|base64url|inline JSON>` via loadRecipe and has no
  // `--slug` flag, so the Install tab emits a pastable
  // `--recipe <base64url>` command.
  function installCommand(recipe) {
    var r = (recipe && typeof recipe === 'object') ? recipe : currentRecipe();
    return 'node bin/agent-builder.js install --recipe ' + base64UrlEncode(JSON.stringify(r));
  }

  function tabText(tab, compiled) {
    switch (tab) {
      case 'v2': return JSON.stringify(compiled.opencodeV2, null, 2) + '\n';
      case 'v1': return JSON.stringify(compiled.opencodeV1, null, 2) + '\n';
      case 'opencodeMd': return compiled.opencodeMarkdown;
      case 'pi':
        return '// --- .pi/settings.json ---\n' +
          JSON.stringify(compiled.piSettingsJson, null, 2) +
          '\n\n// --- .pi/mcp.json ---\n' +
          JSON.stringify(compiled.piMcpJson, null, 2) +
          '\n\n# --- .pi/AGENTS.md ---\n' +
          (compiled.piAgentsMd || '');
      case 'claude':
        return compiled.claudeCodeAgentMd +
          '\n--- .mcp.json ---\n' +
          JSON.stringify(compiled.claudeCodeMcp, null, 2) + '\n';
      case 'codex': return compiled.codexConfigToml;
      case 'gemini':
        return JSON.stringify(compiled.geminiSettingsJson, null, 2) +
          '\n\n# --- GEMINI.md ---\n' +
          (compiled.geminiMd || '');
      case 'cursor':
        return (compiled.cursorRuleMdc || '') +
          '\n--- .cursor/mcp.json ---\n' +
          JSON.stringify(compiled.cursorMcpJson, null, 2) + '\n';
      case 'windsurf': return (compiled.windsurfRules || '') + '\n--- .codeium/windsurf/mcp_config.json ---\n' + JSON.stringify(compiled.windsurfMcpJson, null, 2) + '\n';
      case 'copilot':
        return (compiled.copilotInstructionsMd || '') +
          '\n--- .vscode/mcp.json ---\n' +
          JSON.stringify(compiled.vscodeMcpJson, null, 2) + '\n';
      case 'install': return installCommand(currentRecipe()) + '\n\n# Or shell installer script:\n' + compiled.installScriptSh;
      default: return '';
    }
  }

  function renderPreview() {
    try {
      var compiled = compileCurrent();
      if ($('previewTargetPath') && TAB_FILES[state.previewTab]) {
        $('previewTargetPath').textContent = TAB_FILES[state.previewTab](compiled);
      }
      $('previewContent').innerHTML = highlight(tabText(state.previewTab, compiled));
    } catch (err) {
      $('previewContent').textContent = 'Error: ' + err.message;
    }
  }

  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
  }

  function downloadCurrentFile() {
    var compiled = compileCurrent();
    var fn = TAB_FILES[state.previewTab](compiled).split(' ')[0].replace(/\//g, '_');
    download(fn, tabText(state.previewTab, compiled));
    showToast('Downloaded ' + fn);
  }

  function downloadBundle() {
    var compiled = compileCurrent();
    compiled.bundleFiles.forEach(function (f, i) {
      setTimeout(function () { download(f.path.replace(/\//g, '_'), f.content); }, i * 250);
    });
    showToast('Downloading ' + compiled.bundleFiles.length + ' multi-client bundle files...');
  }

  // ---- Smart Scout & Categorizer Lab (View 4) ----

  var SCOUT_SAMPLES = {
    pi: {
      name: 'pi-codemode-orchestrator',
      repo: 'https://github.com/earendil-works/pi',
      desc: 'Pi coding agent extension for QuickJS sandboxed codemode tool orchestration and deferred MCP discovery.',
      keywords: 'pi-package, codemode, mcp, subagent, typescript',
      deps: '@mariozechner/pi-coding-agent',
    },
    ghidra: {
      name: 'ghidra-binary-triage-mcp',
      repo: 'https://github.com/Heretek-AI/Agent-Builder',
      desc: 'Model Context Protocol server for Ghidra reverse engineering, firmware unpacking, decompilation, and YARA malware triage.',
      keywords: 'mcp-server, ghidra, reverse-engineering, malware, security',
      deps: '@modelcontextprotocol/sdk',
    },
    rust: {
      name: 'rust-tokio-zero-copy-skill',
      repo: 'https://github.com/tokio-rs/tokio',
      desc: 'SKILL.md playbook for memory-safe Rust async Tokio services, custom allocators, and cargo clippy security audits.',
      keywords: 'skill, rust, cargo, tokio',
      deps: '',
    },
    design: {
      name: 'linear-saas-design-system',
      repo: 'https://github.com/VoltAgent/awesome-design-md',
      desc: 'DESIGN.md specification for dark-mode SaaS productivity dashboards, typography hierarchy, and WCAG AA token scales.',
      keywords: 'design-md, saas, dashboard, design-system, tailwind',
      deps: '',
    },
  };

  function runScoutClassifier() {
    if (!window.Classifier || !$('scoutPkgName')) return;
    var name = ($('scoutPkgName').value || 'custom-pkg').trim();
    var repo = ($('scoutRepoUrl').value || 'https://github.com/Heretek-AI/Agent-Builder').trim();
    var desc = ($('scoutDescription').value || '').trim();
    var kw = ($('scoutKeywords').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var depList = ($('scoutDeps').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var deps = {};
    depList.forEach(function (d) { deps[d] = '*'; });

    var rawRes = Classifier.classifyManifest(
      { name: name, description: desc },
      { description: desc, keywords: kw, dependencies: deps }
    );
    var res = {
      kind: rawRes.kind,
      category: rawRes.category,
      harnesses: rawRes.harnesses || ['universal'],
      detectedClients: rawRes.isPiPackage ? ['pi'] : [],
      languages: (rawRes.topics || []).filter(function (t) { return ['rust','python','typescript','go','c-cpp','zig','sql','lua'].indexOf(t) !== -1; }),
      platforms: [],
      topics: rawRes.topics || [],
      confidence: rawRes.confidence >= 60 ? 'high' : 'medium',
      score: rawRes.confidence || 75,
      reasons: rawRes.reasons || [],
    };

    var id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-entry';
    var folderMap = {
      plugin: 'plugins',
      skill: 'skills',
      'mcp-server': 'mcp-servers',
      'design-md': 'design-md',
      prompt: 'prompts',
      agent: 'agents',
    };
    var folder = folderMap[res.kind] || 'plugins';
    var sub = res.category.indexOf(folder + '/') === 0 ? res.category.slice(folder.length + 1) : res.category;
    var targetFile = 'data/' + folder + '/' + sub + '/' + id + '.yaml';
    if ($('scoutTargetFile')) $('scoutTargetFile').textContent = targetFile;

    var yamlLines = [
      'id: ' + id,
      'name: ' + JSON.stringify(name),
      'repo: ' + repo,
      'tagline: ' + JSON.stringify(desc.slice(0, 110) || name),
      'description: ' + JSON.stringify(desc || name),
      'kind: ' + res.kind,
      'category: ' + res.category,
      'harnesses: [' + res.harnesses.join(', ') + ']',
    ];
    if (res.languages.length > 0) yamlLines.push('languages: [' + res.languages.join(', ') + ']');
    if (res.platforms.length > 0) yamlLines.push('platforms: [' + res.platforms.join(', ') + ']');
    if (res.topics.length > 0) yamlLines.push('tags: [' + res.topics.join(', ') + ']');
    yamlLines.push('license: MIT');
    yamlLines.push('source_attribution: "Submitted via Agent-Builder Smart Scout (MIT)."');

    var yamlText = yamlLines.join('\n') + '\n';
    if ($('scoutYamlOutput')) $('scoutYamlOutput').textContent = yamlText;

    state.lastScoutEntry = {
      id: id,
      name: name,
      repo: repo,
      tagline: desc.slice(0, 110) || name,
      description: desc || name,
      kind: res.kind,
      category: res.category,
      harnesses: res.harnesses,
      languages: res.languages,
      platforms: res.platforms,
      tags: res.topics,
      mcp: res.kind === 'mcp-server' ? {
        server_name: id.replace(/-mcp$/, ''),
        transport: 'stdio',
        command: 'npx',
        args: ['-y', name],
        tools: ['read_context', 'search', 'inspect'],
      } : undefined,
      license: 'MIT',
      source_attribution: 'Submitted via Agent-Builder Smart Scout (MIT).',
    };

    // Update the pre-filled GitHub Issue link for add-entry.yml -> issues.yml Auto-PR
    var issueLink = $('submitEntryIssueLink');
    if (issueLink) {
      var issueBody = [
        '### Entry name *',
        '',
        name,
        '',
        '### Kind *',
        '',
        res.kind,
        '',
        '### Category *',
        '',
        res.category,
        '',
        '### Repository URL *',
        '',
        repo,
        '',
        '### Tagline *',
        '',
        desc.slice(0, 110) || name,
        '',
        '### Description *',
        '',
        desc || name,
        '',
        '### Supported harnesses *',
        '',
        res.harnesses.map(function (h) { return '- [x] (' + h + ')'; }).join('\n'),
        '',
        '### Languages',
        '',
        res.languages.join(', '),
        '',
        '### License',
        '',
        'MIT',
      ].join('\n');

      issueLink.href = GITHUB_ISSUE_BASE +
        '?template=add-entry.yml' +
        '&labels=new-entry' +
        '&title=' + encodeURIComponent('[entry] ' + name) +
        '&entry_name=' + encodeURIComponent(name) +
        '&kind=' + encodeURIComponent(res.kind) +
        '&category=' + encodeURIComponent(res.category) +
        '&repo=' + encodeURIComponent(repo) +
        '&tagline=' + encodeURIComponent(desc.slice(0, 110) || name) +
        '&description=' + encodeURIComponent(desc || name) +
        '&languages=' + encodeURIComponent(res.languages.join(', ')) +
        '&license=MIT' +
        '&body=' + encodeURIComponent(issueBody);
    }

    var card = $('scoutResultCard');
    if (card) {
      var confBadge = res.confidence === 'high'
        ? '<span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[11px]">HIGH CONFIDENCE (score ' + res.score + ')</span>'
        : '<span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono text-[11px]">' + res.confidence.toUpperCase() + ' (score ' + res.score + ')</span>';
      card.innerHTML =
        '<div class="flex items-center justify-between border-b border-slate-800 pb-2">' +
          '<span class="font-semibold text-white">Classification Verdict</span>' + confBadge +
        '</div>' +
        '<div class="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">' +
          '<div><span class="text-slate-400">Kind:</span> <strong class="text-teal-300">' + escHtml(res.kind) + '</strong></div>' +
          '<div><span class="text-slate-400">Category:</span> <strong class="text-teal-300">' + escHtml(res.category) + '</strong></div>' +
          '<div><span class="text-slate-400">Clients:</span> <span class="text-slate-200">' + escHtml(Array.from(new Set(res.harnesses.concat(res.detectedClients || []))).join(', ')) + '</span></div>' +
          '<div><span class="text-slate-400">Languages:</span> <span class="text-slate-200">' + escHtml(res.languages.join(', ') || 'universal') + '</span></div>' +
        '</div>' +
        '<div class="pt-1 text-[11px] text-slate-400">Signals: <code>' + escHtml(res.reasons.join(' · ') || 'default') + '</code></div>';
    }
  }

  // ---- Config Upload & Sample Importers ----

  var SAMPLE_IMPORTS = {
    'opencode-v2': {
      name: 'sample-opencode.json',
      content: JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        agents: {
          'imported-sec-auditor': {
            description: 'Imported OpenCode v2 security auditor with deny-first rules',
            mode: 'subagent',
            model: 'anthropic/claude-sonnet-4-5',
            permissions: [
              { action: 'skill', resource: '*', effect: 'deny' },
              { action: 'skill', resource: 'rust-secure-coding', effect: 'allow' },
              { action: 'skill', resource: 'yara-malware-triage', effect: 'allow' },
              { action: 'postgres-prod_*', resource: '*', effect: 'deny' },
              { action: 'postgres-prod_execute_query', resource: '*', effect: 'allow' },
              { action: 'postgres-prod_list_tables', resource: '*', effect: 'allow' },
              { action: 'postgres-prod_drop_table', resource: '*', effect: 'deny' },
              { action: 'opencode_read_mcp_resource', resource: 'postgres-prod:*', effect: 'allow' },
            ],
          },
        },
      }, null, 2),
    },
    'claude-mcp': {
      name: 'sample-.mcp.json',
      content: JSON.stringify({
        mcpServers: {
          github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
          figma: { command: 'npx', args: ['-y', 'figma-mcp-server'] },
        },
      }, null, 2),
    },
    'pi-settings': {
      name: 'sample-pi-settings.json',
      content: JSON.stringify({
        $schema: 'https://pi.dev/schemas/settings.schema.json',
        defaultProvider: 'anthropic',
        defaultModel: 'claude-opus-4-7',
        defaultThinkingLevel: 'high',
        defaultTools: ['+codemode', '+tool_search', '+grep'],
      }, null, 2),
    },
  };

  function handleUploadedFile(name, text) {
    var status = $('uploadStatus');
    try {
      var recipes = Importer.parseUploadedConfig(name, text);
      if (!recipes || recipes.length === 0) {
        throw new Error('no agent recipes found in file');
      }
      var r = recipes[0];
      $('agentSlug').value = r.slug || $('agentSlug').value;
      if (r.description) { $('agentDescription').value = r.description; }
      if (r.mode) { $('agentMode').value = r.mode; }
      if (r.model) { $('agentModel').value = r.model; }
      if (r.prompt) { $('agentPrompt').value = r.prompt; }
      if (r.piOptions) {
        if (r.piOptions.thinkingLevel && $('piThinkingLevel')) {
          $('piThinkingLevel').value = r.piOptions.thinkingLevel;
        }
        if (Array.isArray(r.piOptions.defaultTools) && $('piDefaultTools')) {
          $('piDefaultTools').value = r.piOptions.defaultTools.join(', ');
        }
        selectTargetHarness('pi');
      }
      (r.skills || []).forEach(function (s) {
        if (entryById(s) && state.selectedIds.indexOf(s) === -1) {
          state.selectedIds.push(s);
        }
      });
      (r.mcpSelections || []).forEach(function (ms) {
        var match = findMcpEntryByServerName(ms.server);
        var srvKey = match ? serverNameOf(match) : ms.server;
        if (match && state.selectedIds.indexOf(match.id) === -1) {
          state.selectedIds.push(match.id);
        } else if (!match && ms.server) {
          var existsCustom = state.customServers.some(function (c) { return c.server === ms.server; });
          if (!existsCustom) {
            state.customServers.push({
              server: ms.server,
              tools: Array.isArray(ms.tools) && ms.tools[0] !== '*' ? ms.tools.slice() : ['query', 'list'],
            });
          }
        }
        var deniedMap = {};
        (ms.deniedTools || []).forEach(function (dt) { deniedMap[dt] = true; });
        var knownTools = match ? toolsOf(match) : [];
        if (Array.isArray(ms.tools) && ms.tools.indexOf('*') === -1) {
          knownTools.forEach(function (kt) {
            if (ms.tools.indexOf(kt) === -1) deniedMap[kt] = true;
          });
        }
        state.mcpConfig[srvKey] = {
          allowAll: !Array.isArray(ms.tools) || ms.tools.indexOf('*') !== -1,
          deniedTools: deniedMap,
          allowResources: Boolean(ms.allowResources),
          customTools: (ms.deniedTools || []).slice(),
        };
      });
      status.textContent = '✓ Imported ' + recipes.length + ' recipe(s) from ' + name +
        ' — merged "' + r.slug + '" into the active agent.';
      renderAll();
      runSimulator();
      showToast('Imported config from ' + name);
    } catch (err) {
      status.textContent = 'Import failed for ' + name + ': ' + err.message;
      showToast('Import failed: ' + err.message, 'warn');
    }
  }

  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function () { handleUploadedFile(file.name, String(reader.result || '')); };
    reader.onerror = function () { $('uploadStatus').textContent = 'Could not read ' + file.name; };
    reader.readAsText(file);
  }

  // ---- Helper Agent Drawer ----

  function loadHelperSettings() {
    var stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(LS_LLM_KEY) || '{}');
    } catch (_e) { stored = {}; }
    if (stored.baseUrl) { $('helperBaseUrl').value = stored.baseUrl; }
    if (stored.model) { $('helperModel').value = stored.model; }
    if (stored.apiKey) { $('helperKey').value = stored.apiKey; }
  }

  function saveHelperSettings() {
    try {
      localStorage.setItem(LS_LLM_KEY, JSON.stringify({
        baseUrl: $('helperBaseUrl').value || '',
        model: $('helperModel').value || '',
        apiKey: $('helperKey').value || '',
      }));
    } catch (_e) { /* ignore */ }
  }

  function registrySummary() {
    var lines = state.entries.slice(0, 200).map(function (e) {
      var extra = e.kind === 'mcp-server' ? ' tools=' + toolsOf(e).join(',') : '';
      return '- ' + e.id + ' [' + e.kind + '|' + e.category + ']' + extra;
    });
    return 'Registry (' + state.entries.length + ' entries; showing 200):\n' + lines.join('\n');
  }

  function keywordSuggest(request) {
    var words = String(request).toLowerCase().split(/[^a-z0-9]+/).filter(function (w) { return w.length > 2; });
    var scored = state.entries.map(function (e) {
      var hay = [e.id, e.name, e.tagline, e.description, e.category, (e.tags || []).join(' '), (e.languages || []).join(' ')]
        .join(' ').toLowerCase();
      var score = 0;
      words.forEach(function (w) {
        if (e.id.toLowerCase().indexOf(w) !== -1) score += 3;
        else if (hay.indexOf(w) !== -1) score += 1;
      });
      return { entry: e, score: score };
    }).filter(function (x) { return x.score > 0; });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 6).map(function (x) { return x.entry; });
  }

  function applySmartOfflineBuild(request) {
    var sug = keywordSuggest(request);
    var added = [];
    var isReadOnly = /read-only|readonly|audit|observe|safe|triage/i.test(request);
    sug.forEach(function (e) {
      if (e.kind === 'agent') return;
      if (state.selectedIds.indexOf(e.id) === -1) {
        state.selectedIds.push(e.id);
        added.push(e.id);
      }
      if (e.kind === 'mcp-server') {
        var srv = serverNameOf(e);
        var cfg = ensureMcpConfig(srv);
        if (isReadOnly) {
          toolsOf(e).forEach(function (t) {
            if (isWriteOrDestructiveTool(t)) cfg.deniedTools[t] = true;
          });
        }
      }
    });
    var slugWords = String(request).toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').trim().split(/\s+/)
      .filter(function (w) { return ['build', 'me', 'a', 'an', 'the', 'with', 'and', 'for', 'using'].indexOf(w) === -1; })
      .slice(0, 3);
    if (slugWords.length > 0) {
      $('agentSlug').value = slugWords.join('-');
    }
    $('agentDescription').value = request.slice(0, 140);
    $('agentPrompt').value = 'You are a least-privilege specialist agent built for: ' + request.trim() +
      '\n\nFollow deny-first tool hygiene and verify all changes before reporting completion.';
    renderAll();
    runSimulator();
    showToast('AI Helper configured agent with ' + sug.length + ' matched registry items');
    return 'Configured agent "' + $('agentSlug').value + '" with ' +
      (added.length ? added.join(', ') : sug.map(function (e) { return e.id; }).join(', ')) +
      (isReadOnly ? ' (Read-Only MCP lockdown applied).' : '.');
  }

  function applyHelperActions(actions) {
    if (!actions || typeof actions !== 'object') { return 'No actions returned.'; }
    var notes = [];
    (actions.addSkills || actions.addEntries || []).forEach(function (id) {
      var e = entryById(String(id));
      if (e && state.selectedIds.indexOf(e.id) === -1) {
        state.selectedIds.push(e.id);
        notes.push('added ' + e.id);
      }
    });
    (actions.mcpSelections || []).forEach(function (ms) {
      var match = findMcpEntryByServerName(ms.server || '');
      if (match && state.selectedIds.indexOf(match.id) === -1) {
        state.selectedIds.push(match.id);
        ensureMcpConfig(serverNameOf(match));
        notes.push('added MCP ' + match.id);
      }
    });
    if (typeof actions.prompt === 'string' && actions.prompt.trim()) {
      $('agentPrompt').value = actions.prompt;
      notes.push('updated system prompt');
    }
    if (typeof actions.slug === 'string' && actions.slug.trim()) {
      $('agentSlug').value = actions.slug.trim();
    }
    renderAll();
    runSimulator();
    showToast('Helper applied ' + notes.length + ' update(s)');
    return notes.length > 0 ? 'Applied: ' + notes.join(', ') : 'No changes applied.';
  }

  function helperSystemPrompt() {
    return 'You are the Agent Builder helper. Given the registry summary and the current ' +
      'AgentRecipe JSON, respond with ONLY a JSON object like ' +
      '{"addSkills": ["<entry-id>"], "mcpSelections": [{"server": "<name>", "tools": ["*"]}], ' +
      '"prompt": "<refined system prompt>", "slug": "<slug>"} using only entry ids from the summary.';
  }

  function getAbToken() {
    try {
      var m = document.querySelector('meta[name="ab-token"]');
      if (m && m.getAttribute('content')) {
        return m.getAttribute('content');
      }
    } catch (_e) { /* ignore */ }
    try {
      if (typeof window !== 'undefined' && window.__AB_TOKEN__) {
        return String(window.__AB_TOKEN__);
      }
    } catch (_e) { /* ignore */ }
    try {
      var mm = location.search.match(/[?&]token=([^&]+)/);
      if (mm) {
        return decodeURIComponent(mm[1]);
      }
    } catch (_e) { /* ignore */ }
    return '';
  }

  function withAbToken(headers) {
    var t = getAbToken();
    if (t) {
      headers['x-ab-token'] = t;
    }
    return headers;
  }

  function withAbTokenUrl(url) {
    var t = getAbToken();
    if (!t) {
      return url;
    }
    if (url.indexOf('/api/') !== -1 && url.indexOf('token=') === -1) {
      return url + (url.indexOf('?') === -1 ? '?token=' : '&token=') + encodeURIComponent(t);
    }
    return url;
  }

  function askHelper() {
    var out = $('helperOutput');
    var request = ($('helperPrompt').value || '').trim();
    if (!request) {
      out.textContent = 'Describe the agent you want first (or click one of the Try buttons above).';
      return;
    }
    saveHelperSettings();
    var useMcp = $('helperMcpToggle').checked;
    var useProxy = $('helperProxyToggle').checked;
    var recipe = currentRecipe();

    if (useMcp) {
      out.textContent = 'Calling local MCP connector /api/mcp/call …';
      fetch(withAbTokenUrl('/api/mcp/call'), {
        method: 'POST',
        headers: withAbToken({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          tool: 'build_agent',
          args: { request: request, recipe: recipe, registrySummary: registrySummary() },
        }),
      }).then(function (res) {
        if (!res.ok) { throw new Error('MCP connector HTTP ' + res.status); }
        return res.json();
      }).then(function (data) {
        var actions = data && data.actions ? data.actions : data;
        out.textContent = applyHelperActions(actions) + '\n' + JSON.stringify(actions, null, 2);
      }).catch(function () {
        out.textContent = applySmartOfflineBuild(request);
      });
      return;
    }

    var baseUrl = ($('helperBaseUrl').value || '').trim();
    var model = ($('helperModel').value || '').trim();
    var apiKey = $('helperKey').value || '';
    if (!useProxy && (!baseUrl || !model)) {
      out.textContent = applySmartOfflineBuild(request);
      return;
    }

    out.textContent = 'Thinking …';
    var url = useProxy ? withAbTokenUrl('/api/llm/chat') : baseUrl.replace(/\/$/, '') + '/chat/completions';
    var headers = withAbToken({ 'Content-Type': 'application/json' });
    if (!useProxy && apiKey) { headers.Authorization = 'Bearer ' + apiKey; }
    fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        model: useProxy ? undefined : model,
        messages: [
          { role: 'system', content: helperSystemPrompt() },
          { role: 'user', content: 'REQUEST: ' + request + '\n\nREGISTRY:\n' +
            registrySummary() + '\n\nCURRENT RECIPE:\n' + JSON.stringify(recipe, null, 2) },
        ],
        temperature: 0.2,
      }),
    }).then(function (res) {
      if (!res.ok) { throw new Error('LLM endpoint HTTP ' + res.status); }
      return res.json();
    }).then(function (data) {
      var text = data && data.choices && data.choices[0] &&
        data.choices[0].message && data.choices[0].message.content;
      if (!text) { throw new Error('empty LLM response'); }
      var actions;
      try {
        actions = JSON.parse(text);
      } catch (_e) {
        var m = String(text).match(/\{[\s\S]*\}/);
        if (!m) { throw new Error('helper did not return JSON'); }
        actions = JSON.parse(m[0]);
      }
      out.textContent = applyHelperActions(actions) + '\n' + JSON.stringify(actions, null, 2);
    }).catch(function () {
      out.textContent = applySmartOfflineBuild(request);
    });
  }

  // ---- Publish Modal & Pre-filled Issue-to-PR Link ----

  function recipeToYaml(recipe) {
    var lines = [
      'slug: ' + recipe.slug,
      'description: ' + JSON.stringify(recipe.description || ''),
      'mode: ' + (recipe.mode || 'subagent'),
    ];
    if (recipe.model) { lines.push('model: ' + JSON.stringify(recipe.model)); }
    lines.push('prompt: ' + JSON.stringify(recipe.prompt || ''));
    lines.push('skills:');
    (recipe.skills || []).forEach(function (s) { lines.push('  - ' + s); });
    lines.push('mcp_selections:');
    (recipe.mcpSelections || []).forEach(function (ms) {
      lines.push('  - server: ' + ms.server);
      lines.push('    tools: [' + (ms.tools || []).join(', ') + ']');
      if (ms.deniedTools && ms.deniedTools.length > 0) {
        lines.push('    denied_tools: [' + ms.deniedTools.join(', ') + ']');
      }
      if (ms.allowResources) { lines.push('    allow_resources: true'); }
    });
    return lines.join('\n') + '\n';
  }

  function openPublish() {
    var recipe = currentRecipe();
    var permalink = location.origin + location.pathname + '?recipe=' +
      base64UrlEncode(JSON.stringify(recipe));
    $('permalink').value = permalink;
    var yaml = recipeToYaml(recipe);
    $('recipeYamlPreview').textContent = yaml;

    var title = '[agent] ' + recipe.slug;
    var promptVal = recipe.prompt || ('Scoped agent preset for ' + recipe.slug);
    var descVal = recipe.description || ('Scoped agent preset ' + recipe.slug);
    var skillsCsv = (recipe.skills || []).join(', ');
    var mcpJson = JSON.stringify(recipe.mcpSelections || []);
    var formHarness = state.harness.indexOf('opencode') === 0 ? 'opencode' :
      (state.harness === 'claude' ? 'claude-code' :
      (state.harness === 'codex' ? 'codex' : 'universal'));

    // Also provide ### Label sections in body so both YAML Issue Forms and
    // plain markdown issue views parse cleanly via scripts/submit-entry.js!
    var body = [
      '### Agent name / slug *',
      '',
      recipe.slug,
      '',
      '### Description *',
      '',
      descVal,
      '',
      '### Model',
      '',
      recipe.model || '',
      '',
      '### System prompt *',
      '',
      promptVal,
      '',
      '### Skills',
      '',
      skillsCsv,
      '',
      '### MCP selections (JSON)',
      '',
      mcpJson,
      '',
      '### Target harness',
      '',
      formHarness,
      '',
      '### Recipe YAML',
      '',
      yaml,
    ].join('\n');

    $('publishIssueLink').href = GITHUB_ISSUE_BASE +
      '?template=publish-agent.yml' +
      '&labels=new-agent,publish-agent' +
      '&title=' + encodeURIComponent(title) +
      '&agent_name=' + encodeURIComponent(recipe.slug) +
      '&description=' + encodeURIComponent(descVal) +
      '&model=' + encodeURIComponent(recipe.model || '') +
      '&prompt=' + encodeURIComponent(promptVal) +
      '&skills=' + encodeURIComponent(skillsCsv) +
      '&mcp=' + encodeURIComponent(mcpJson) +
      '&harness=' + encodeURIComponent(formHarness) +
      '&recipe=' + encodeURIComponent(yaml) +
      '&body=' + encodeURIComponent(body);
    $('publishModal').hidden = false;
  }

  function restoreRecipeFromUrl() {
    var m = location.search.match(/[?&]recipe=([^&]+)/);
    if (!m) { return; }
    try {
      var recipe = JSON.parse(base64UrlDecode(decodeURIComponent(m[1])));
      if (recipe.slug) { $('agentSlug').value = recipe.slug; }
      if (recipe.description) { $('agentDescription').value = recipe.description; }
      if (recipe.mode) { $('agentMode').value = recipe.mode; }
      if (recipe.model) { $('agentModel').value = recipe.model; }
      if (recipe.prompt) { $('agentPrompt').value = recipe.prompt; }
      state.selectedIds = [];
      (recipe.skills || []).forEach(function (id) {
        if (entryById(String(id)) && state.selectedIds.indexOf(String(id)) === -1) {
          state.selectedIds.push(String(id));
        }
      });
      (recipe.mcpSelections || []).forEach(function (ms) {
        var match = findMcpEntryByServerName(ms.server);
        if (match && state.selectedIds.indexOf(match.id) === -1) {
          state.selectedIds.push(match.id);
        }
        var deniedMap = {};
        (ms.deniedTools || []).forEach(function (dt) { deniedMap[dt] = true; });
        state.mcpConfig[ms.server] = {
          allowAll: !Array.isArray(ms.tools) || ms.tools.indexOf('*') !== -1,
          deniedTools: deniedMap,
          allowResources: Boolean(ms.allowResources),
          customTools: [],
        };
      });
      showToast('Restored agent recipe from URL permalink');
    } catch (_e) { /* malformed permalink: ignore */ }
  }

  // ---- Theme ----

  function toggleTheme() {
    var current = document.body.dataset.theme;
    if (current === 'dark') { document.body.dataset.theme = 'light'; }
    else if (current === 'light') { document.body.dataset.theme = 'dark'; }
    else {
      document.body.dataset.theme = 'light';
    }
    showToast('Switched to ' + document.body.dataset.theme + ' theme');
  }

  // ---- Wiring ----

  function renderAll() {
    renderSelected();
    renderMatrix();
    renderCards();
    renderPreview();
  }

  function init() {
    if (!window.Compiler || !window.Importer) {
      setStatus('core scripts failed to load (./core/*.js)', false);
      return;
    }

    // Studio top navigation tabs
    document.querySelectorAll('.studio-tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchStudioTab(btn.dataset.studioTab, true);
      });
    });

    // Kind filter pills
    document.querySelectorAll('.kind-pill-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setKindFilter(btn.dataset.kindPill || '');
      });
    });

    if ($('clearFiltersBtn')) {
      $('clearFiltersBtn').addEventListener('click', clearAllFilters);
    }
    if ($('resetFiltersInlineBtn')) {
      $('resetFiltersInlineBtn').addEventListener('click', clearAllFilters);
    }
    if ($('selectAllFilteredBtn')) {
      $('selectAllFilteredBtn').addEventListener('click', function () {
        var list = filteredEntries().filter(function (e) {
          return e.kind !== 'agent' && e.kind !== 'agent-preset' && !e.agent_preset;
        }).slice(0, 12);
        var addedCount = 0;
        list.forEach(function (e) {
          if (state.selectedIds.indexOf(e.id) === -1) {
            state.selectedIds.push(e.id);
            if (e.kind === 'mcp-server') ensureMcpConfig(serverNameOf(e));
            addedCount++;
          }
        });
        renderAll();
        runSimulator();
        showToast('Added ' + addedCount + ' visible entries to active agent');
      });
    }

    if ($('clearSelectedBtn')) {
      $('clearSelectedBtn').addEventListener('click', function () {
        state.selectedIds = [];
        state.customServers = [];
        renderAll();
        runSimulator();
        showToast('Cleared all selected items', 'warn');
      });
    }
    if ($('jumpToScopeBtn')) {
      $('jumpToScopeBtn').addEventListener('click', function () {
        if (state.studioTab !== 'all' && state.studioTab !== 'scope') {
          switchStudioTab('scope', true);
        } else {
          var sc = $('view-scope');
          if (sc && sc.scrollIntoView) sc.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    }

    if ($('presetAgentSelect')) {
      $('presetAgentSelect').addEventListener('change', function (e) {
        if (e.target.value) {
          loadAgentPreset(e.target.value, false);
          e.target.value = '';
        }
      });
    }

    $('searchInput').addEventListener('input', function (e) {
      state.query = e.target.value;
      renderCards();
    });
    $('harnessFilter').addEventListener('change', function (e) {
      state.harnessFilter = e.target.value;
      renderCards();
    });
    $('languageFilter').addEventListener('change', function (e) {
      state.languageFilter = e.target.value;
      renderCards();
    });
    $('platformFilter').addEventListener('change', function (e) {
      state.platformFilter = e.target.value;
      renderCards();
    });

    // Target Harness radio buttons -> immediately sync Preview Tab!
    var harnessRadios = document.querySelectorAll('input[name="harness"]');
    harnessRadios.forEach(function (r) {
      r.addEventListener('change', function () {
        var val = document.querySelector('input[name="harness"]:checked').value;
        selectTargetHarness(val);
        showToast('Target client switched to ' + val);
      });
    });

    ['agentSlug', 'agentDescription', 'agentPrompt', 'agentMode', 'agentModel'].forEach(function (id) {
      if ($(id)) {
        $(id).addEventListener('input', renderPreview);
        $(id).addEventListener('change', renderPreview);
      }
    });

    ['piThinkingLevel', 'piMcpExposure', 'piDefaultTools'].forEach(function (id) {
      if ($(id)) {
        $(id).addEventListener('input', function () {
          selectTargetHarness('pi');
        });
        $(id).addEventListener('change', function () {
          selectTargetHarness('pi');
        });
      }
    });
    if ($('previewPiBtn')) {
      $('previewPiBtn').addEventListener('click', function () {
        selectTargetHarness('pi');
        showToast('Switched live preview to Pi (.pi/settings.json + .pi/mcp.json)');
      });
    }

    // Custom MCP Server addition
    if ($('addCustomMcpServerBtn')) {
      $('addCustomMcpServerBtn').addEventListener('click', function () {
        var inp = $('customMcpServerInput');
        var srv = (inp && inp.value || '').trim();
        if (!srv) {
          showToast('Enter a custom MCP server name first', 'warn');
          return;
        }
        var exists = state.customServers.some(function (c) { return c.server === srv; });
        if (!exists) {
          state.customServers.push({
            server: srv,
            tools: ['read_query', 'list_items', 'write_item', 'delete_item'],
          });
          ensureMcpConfig(srv);
        }
        inp.value = '';
        renderAll();
        runSimulator();
        showToast('Added custom MCP server: ' + srv);
      });
    }

    // File upload + Sample Config quick-loaders
    $('fileInput').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) { readFile(e.target.files[0]); }
      e.target.value = '';
    });
    var dz = $('dropZone');
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('dragover'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('dragover'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) { readFile(e.dataTransfer.files[0]); }
    });
    dz.addEventListener('click', function (e) {
      if (e.target !== $('fileInput')) $('fileInput').click();
    });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { $('fileInput').click(); }
    });

    document.querySelectorAll('.sample-import-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sample = SAMPLE_IMPORTS[btn.dataset.sampleImport];
        if (sample) {
          handleUploadedFile(sample.name, sample.content);
        }
      });
    });

    // Simulator + Presets
    $('simButton').addEventListener('click', runSimulator);
    ['simAction', 'simResource'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('input', runSimulator);
    });
    document.querySelectorAll('.sim-preset-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applySimulatorPreset(btn.dataset.simPreset);
      });
    });

    // Preview Tabs
    var tabs = document.querySelectorAll('.preview-tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        selectPreviewTab(t.dataset.tab, false);
      });
    });

    if ($('copyPreviewBtn')) {
      $('copyPreviewBtn').addEventListener('click', function () {
        var compiled = compileCurrent();
        copyText(tabText(state.previewTab, compiled), 'Copied ' + TAB_FILES[state.previewTab](compiled));
      });
    }
    $('downloadFile').addEventListener('click', downloadCurrentFile);
    $('downloadBundle').addEventListener('click', downloadBundle);

    // Smart Scout Lab wiring
    if ($('runScoutClassifyBtn')) {
      $('runScoutClassifyBtn').addEventListener('click', function () {
        runScoutClassifier();
        showToast('Classified package with 4-tier weighted taxonomy engine');
      });
    }
    ['scoutPkgName', 'scoutRepoUrl', 'scoutDescription', 'scoutKeywords', 'scoutDeps'].forEach(function (id) {
      if ($(id)) $(id).addEventListener('input', runScoutClassifier);
    });
    document.querySelectorAll('.scout-sample-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = SCOUT_SAMPLES[btn.dataset.scoutSample];
        if (!s) return;
        $('scoutPkgName').value = s.name;
        $('scoutRepoUrl').value = s.repo;
        $('scoutDescription').value = s.desc;
        $('scoutKeywords').value = s.keywords;
        $('scoutDeps').value = s.deps;
        runScoutClassifier();
        showToast('Loaded scout sample: ' + s.name);
      });
    });
    if ($('injectScoutEntryBtn')) {
      $('injectScoutEntryBtn').addEventListener('click', function () {
        runScoutClassifier();
        if (!state.lastScoutEntry) return;
        var existing = entryById(state.lastScoutEntry.id);
        if (!existing) {
          state.entries.unshift(state.lastScoutEntry);
        }
        if (state.selectedIds.indexOf(state.lastScoutEntry.id) === -1) {
          state.selectedIds.push(state.lastScoutEntry.id);
        }
        if (state.lastScoutEntry.kind === 'mcp-server') {
          ensureMcpConfig(serverNameOf(state.lastScoutEntry));
        }
        if ($('badgeRegistryCount')) {
          $('badgeRegistryCount').textContent = String(state.entries.length);
        }
        buildCategoryTree();
        renderAll();
        runSimulator();
        showToast('Added "' + state.lastScoutEntry.name + '" to live session registry & active agent');
      });
    }
    if ($('copyScoutYamlBtn')) {
      $('copyScoutYamlBtn').addEventListener('click', function () {
        copyText(($('scoutYamlOutput') && $('scoutYamlOutput').textContent) || '', 'Copied catalog YAML');
      });
    }

    // Helper Drawer
    $('helperBtn').addEventListener('click', function () {
      $('helperDrawer').hidden = false;
    });
    $('helperClose').addEventListener('click', function () {
      $('helperDrawer').hidden = true;
    });
    $('helperSend').addEventListener('click', askHelper);
    document.querySelectorAll('.helper-sample-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $('helperPrompt').value = btn.dataset.helperSample || '';
        askHelper();
      });
    });

    // Entry Detail Modal
    if ($('entryDetailClose')) {
      $('entryDetailClose').addEventListener('click', function () {
        $('entryDetailModal').hidden = true;
      });
    }
    if ($('entryDetailModal')) {
      $('entryDetailModal').addEventListener('click', function (e) {
        if (e.target === $('entryDetailModal')) $('entryDetailModal').hidden = true;
      });
    }

    // Publish Modal
    $('publishBtn').addEventListener('click', openPublish);
    $('publishClose').addEventListener('click', function () {
      $('publishModal').hidden = true;
    });
    $('publishModal').addEventListener('click', function (e) {
      if (e.target === $('publishModal')) $('publishModal').hidden = true;
    });
    $('copyPermalink').addEventListener('click', function () {
      copyText($('permalink').value || '', 'Copied shareable recipe permalink');
    });
    if ($('copyPublishYamlBtn')) {
      $('copyPublishYamlBtn').addEventListener('click', function () {
        copyText(($('recipeYamlPreview') && $('recipeYamlPreview').textContent) || '', 'Copied recipe YAML');
      });
    }

    $('themeToggle').addEventListener('click', toggleTheme);

    loadHelperSettings();
    probeLocalBridge();
    loadRegistry();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
