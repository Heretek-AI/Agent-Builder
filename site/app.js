/* Agent-Builder Studio v2.0 — zero-build plain JS (no bundler, no npm deps).
 *
 * Depends on ./core/compiler.js (`Compiler`), ./core/importer.js (`Importer`),
 * and ./core/classifier.js (`Classifier`).
 * Registry: embedded fallback or fetch('./registry.json') -> GitHub Pages URL.
 */
(function () {
  'use strict';

  var REGISTRY_LOCAL = './registry.json';
  var REGISTRY_REMOTE = 'https://heretek-ai.github.io/Agent-Builder/registry.json';
  var LS_LLM_KEY = 'heretek_agent_builder_llm_key';
  var GITHUB_ISSUE_BASE = 'https://github.com/Heretek-AI/Agent-Builder/issues/new';

  var state = {
    registry: null,
    entries: [],
    categoryFilter: '',
    kindFilter: '',
    harnessFilter: '',
    languageFilter: '',
    platformFilter: '',
    query: '',
    selectedIds: [],
    harness: 'opencode-v2',
    previewTab: 'v2',
    studioTab: 'explorer',
    lastCompiled: null,
    lastScoutClassification: null,
  };

  function $(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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
    if (entry && entry.mcp && Array.isArray(entry.mcp.tools)) {
      return entry.mcp.tools.map(function (t) { return String(t); });
    }
    return [];
  }

  // ---- Registry loading ----

  function setStatus(text, ok) {
    var el = $('registryStatus');
    if (!el) return;
    el.textContent = text;
    el.style.borderColor = ok === undefined ? '' : (ok ? 'var(--allow)' : 'var(--deny)');
  }

  function applyRegistryData(data) {
    if (!data || !Array.isArray(data.entries)) {
      throw new Error('registry payload has no entries array');
    }
    state.registry = data;
    state.entries = data.entries;
    setStatus(data.entries.length + ' entries loaded', true);
    if ($('badgeRegistryCount')) {
      $('badgeRegistryCount').textContent = String(data.entries.length);
    }
    buildFilters();
    buildCategoryTree();
    renderCards();
    restoreRecipeFromUrl();
    renderAll();
  }

  function loadRegistry() {
    if (typeof window !== 'undefined' && window.__EMBEDDED_REGISTRY__ && Array.isArray(window.__EMBEDDED_REGISTRY__.entries)) {
      try {
        applyRegistryData(window.__EMBEDDED_REGISTRY__);
        return Promise.resolve();
      } catch (_e) { /* fall through to fetch */ }
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
      .then(applyRegistryData)
      .catch(function (err) {
        setStatus('registry failed: ' + err.message, false);
        $('resultCount').textContent = 'Could not load registry.json locally or remotely.';
      });
  }

  // ---- Filters + category tree ----

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
    var harnesses = [];
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
    if (!sel) return;
    var first = sel.options[0];
    sel.innerHTML = '';
    sel.appendChild(first);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
  }

  function countForCategoryPrefix(catId) {
    if (!catId) return state.entries.length;
    var c = 0;
    for (var i = 0; i < state.entries.length; i++) {
      var ec = state.entries[i].category || '';
      if (ec === catId || ec.indexOf(catId + '/') === 0) {
        c++;
      }
    }
    return c;
  }

  function categoryLabel(node) {
    return node.title || node.id;
  }

  function buildCategoryTree() {
    var tree = $('categoryTree');
    if (!tree) return;
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
    var count = countForCategoryPrefix(node.id);
    li.appendChild(treeItem(node.id, categoryLabel(node) + ' (' + count + ')'));
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
      state.categoryFilter = id;
      var btns = $('categoryTree').querySelectorAll('button');
      btns.forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      renderCards();
    });
    return b;
  }

  function filteredEntries() {
    var q = state.query.trim().toLowerCase();
    return state.entries.filter(function (e) {
      if (state.categoryFilter && !(e.category === state.categoryFilter ||
          e.category.indexOf(state.categoryFilter + '/') === 0)) {
        return false;
      }
      if (state.kindFilter && e.kind !== state.kindFilter) { return false; }
      if (state.harnessFilter && (e.harnesses || []).indexOf(state.harnessFilter) === -1) { return false; }
      if (state.languageFilter && (e.languages || []).indexOf(state.languageFilter) === -1) { return false; }
      if (state.platformFilter && (e.platforms || []).indexOf(state.platformFilter) === -1) { return false; }
      if (q) {
        var toolStr = toolsOf(e).join(' ');
        var hay = [e.id, e.name, e.tagline, e.description, e.category, (e.tags || []).join(' '), toolStr]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) { return false; }
      }
      return true;
    });
  }

  function kindBadgeColor(kind) {
    switch (kind) {
      case 'mcp-server': return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'skill': return 'bg-teal-500/20 text-teal-300 border-teal-500/30';
      case 'plugin': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'design-md': return 'bg-pink-500/20 text-pink-300 border-pink-500/30';
      case 'prompt': return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case 'agent': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      default: return 'bg-slate-800 text-slate-300 border-slate-700';
    }
  }

  function renderCards() {
    var list = filteredEntries();
    $('resultCount').textContent = 'Showing ' + list.length + ' of ' + state.entries.length + ' registry entries';
    var wrap = $('cards');
    wrap.innerHTML = '';
    list.slice(0, 400).forEach(function (e) {
      var card = document.createElement('div');
      card.className = 'entry-card';
      var badges = (e.harnesses || []).map(function (h) {
        return '<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">' + escHtml(h) + '</span>';
      }).join('');
      var tools = toolsOf(e);
      var toolInfo = e.kind === 'mcp-server'
        ? '<div class="mt-1.5 flex flex-wrap gap-1">' + tools.map(function (t) {
            return '<code class="text-[10px] px-1.5 py-0.2 rounded bg-slate-900 text-teal-300 border border-slate-800">' + escHtml(t) + '</code>';
          }).join('') + '</div>'
        : '';

      var topDiv = document.createElement('div');
      topDiv.innerHTML =
        '<div class="flex items-start justify-between gap-2 mb-1">' +
          '<h3>' + escHtml(e.name) + '</h3>' +
          '<span class="px-2 py-0.5 rounded text-[10px] font-mono border shrink-0 ' + kindBadgeColor(e.kind) + '">' + escHtml(e.kind) + '</span>' +
        '</div>' +
        '<p class="text-xs text-slate-400 mb-2">' + escHtml(e.tagline || '') + '</p>' +
        '<div class="flex flex-wrap gap-1 mb-1">' +
          '<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-900 text-slate-400 border border-slate-800">' + escHtml(e.category) + '</span>' +
          badges +
        '</div>' +
        toolInfo;

      var actionsDiv = document.createElement('div');
      actionsDiv.className = 'flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80';

      var repoLink = document.createElement('a');
      repoLink.href = e.repo || '#';
      repoLink.target = '_blank';
      repoLink.rel = 'noopener noreferrer';
      repoLink.className = 'text-[11px] font-mono text-slate-400 hover:text-teal-300 truncate';
      repoLink.textContent = e.id;
      actionsDiv.appendChild(repoLink);

      var btn = document.createElement('button');
      btn.type = 'button';
      var already = state.selectedIds.indexOf(e.id) !== -1;
      if (e.kind === 'agent' && e.agent_preset) {
        btn.className = 'px-2.5 py-1 rounded text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition shrink-0';
        btn.textContent = '⚡ Load Preset';
        btn.addEventListener('click', function () { loadAgentPresetById(e.id); });
      } else {
        btn.className = already
          ? 'px-2.5 py-1 rounded text-xs font-medium bg-teal-500/20 text-teal-300 border border-teal-500/40 shrink-0'
          : 'px-2.5 py-1 rounded text-xs font-semibold bg-teal-500 hover:bg-teal-400 text-slate-950 transition shrink-0';
        btn.textContent = already ? 'Added ✓' : '+ Add to Agent';
        btn.addEventListener('click', function () {
          if (already) { removeFromAgent(e.id); }
          else { addToAgent(e.id); }
        });
      }
      actionsDiv.appendChild(btn);

      card.appendChild(topDiv);
      card.appendChild(actionsDiv);
      wrap.appendChild(card);
    });
  }

  // ---- Recipe & Presets ----

  function entryById(id) {
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i].id === id) { return state.entries[i]; }
    }
    return null;
  }

  function loadAgentPresetById(presetId) {
    if (presetId === 'pi-codemode-architect') {
      $('agentSlug').value = 'pi-codemode-architect';
      $('agentDescription').value = 'Pi coding architect using QuickJS codemode and scoped GitHub/Filesystem MCP tools';
      $('agentMode').value = 'primary';
      $('agentModel').value = 'anthropic/claude-sonnet-4-5';
      $('agentPrompt').value = 'Architect, implement, and verify multi-file changes using Pi codemode scripts and least-privilege MCP tools.';
      state.selectedIds = ['typescript-strict-patterns', 'rust-secure-coding', 'github-mcp', 'filesystem-mcp'].filter(function (id) {
        return Boolean(entryById(id));
      });
      state.previewTab = 'pi';
      syncPreviewTabs();
      renderAll();
      return;
    }

    var e = entryById(presetId);
    if (!e || !e.agent_preset) return;
    var ap = e.agent_preset;
    $('agentSlug').value = e.id;
    $('agentDescription').value = e.tagline || e.description || '';
    $('agentMode').value = ap.mode || 'subagent';
    $('agentModel').value = ap.model || 'anthropic/claude-sonnet-4-5';
    $('agentPrompt').value = ap.prompt || '';
    state.selectedIds = [];
    (ap.skills || []).forEach(function (s) {
      if (entryById(s) && state.selectedIds.indexOf(s) === -1) {
        state.selectedIds.push(s);
      }
    });
    (ap.mcp_selections || []).forEach(function (ms) {
      state.entries.forEach(function (ce) {
        if (ce.kind === 'mcp-server' &&
            Compiler.normalizeMcpId(serverNameOf(ce)) === Compiler.normalizeMcpId(ms.server)) {
          if (state.selectedIds.indexOf(ce.id) === -1) {
            state.selectedIds.push(ce.id);
          }
        }
      });
    });
    renderAll();
  }

  function addToAgent(id) {
    if (state.selectedIds.indexOf(id) === -1) {
      state.selectedIds.push(id);
    }
    renderAll();
  }

  function removeFromAgent(id) {
    state.selectedIds = state.selectedIds.filter(function (x) { return x !== id; });
    renderAll();
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
      var box = document.querySelector('input[data-server-allow-all="' + cssEsc(server) + '"]');
      var allowAll = box ? box.checked : true;
      var allowed = [];
      var denied = [];
      tools.forEach(function (t) {
        var cb = document.querySelector(
          'input[data-server="' + cssEsc(server) + '"][data-tool="' + cssEsc(t) + '"]');
        if (!cb || cb.checked) { allowed.push(t); }
        else { denied.push(t); }
      });
      var resCb = document.querySelector('input[data-server-resources="' + cssEsc(server) + '"]');
      selections.push({
        server: server,
        tools: allowAll ? ['*'] : allowed,
        deniedTools: denied,
        allowResources: resCb ? resCb.checked : false,
      });
    });
    return selections;
  }

  function cssEsc(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) { return CSS.escape(String(s)); }
    return String(s).replace(/["\\]/g, '\\$&');
  }

  function currentRecipe() {
    var skillIds = selectedEntries()
      .filter(function (e) { return e.kind !== 'mcp-server'; })
      .map(function (e) { return e.id; });
    var piToolsRaw = $('piDefaultTools') ? $('piDefaultTools').value : '+codemode, +tool_search';
    var piTools = piToolsRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return {
      slug: ($('agentSlug').value || 'my-agent').trim() || 'my-agent',
      description: $('agentDescription').value || '',
      mode: $('agentMode').value || 'subagent',
      model: ($('agentModel').value || '').trim() || undefined,
      prompt: $('agentPrompt').value || '',
      skills: skillIds,
      mcpSelections: readMcpSelections(),
      piOptions: {
        thinkingLevel: $('piThinkingLevel') ? $('piThinkingLevel').value : 'medium',
        mcpExposure: $('piMcpExposure') ? $('piMcpExposure').value : 'codemode',
        defaultTools: piTools
      }
    };
  }

  function compileCurrent() {
    var recipe = currentRecipe();
    if ($('activeSlugPill')) {
      $('activeSlugPill').textContent = recipe.slug;
    }
    state.lastCompiled = Compiler.compileAgentRecipe(recipe, state.entries);
    return state.lastCompiled;
  }

  // ---- Selected list + scoping matrix ----

  function renderSelected() {
    var list = $('selectedList');
    list.innerHTML = '';
    selectedEntries().forEach(function (e) {
      var li = document.createElement('li');
      li.className = 'px-2.5 py-1 rounded-full text-xs font-mono bg-slate-900 border border-slate-700 flex items-center gap-2';
      li.innerHTML = '<span><strong class="text-teal-300">' + escHtml(e.id) + '</strong> <span class="text-slate-400">(' +
        escHtml(e.kind) + ')</span></span> ';
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'text-slate-400 hover:text-rose-400';
      rm.textContent = '✕';
      rm.title = 'Remove ' + e.id;
      rm.addEventListener('click', function () { removeFromAgent(e.id); });
      li.appendChild(rm);
      list.appendChild(li);
    });
    $('selectedCount').textContent = String(state.selectedIds.length);
  }

  function renderMatrix() {
    var wrap = $('scopeMatrix');
    wrap.innerHTML = '';
    var sel = selectedEntries();
    if (sel.length === 0) {
      wrap.innerHTML = '<div class="p-6 text-center rounded-xl border border-dashed border-slate-800 text-xs text-slate-400">Nothing selected yet &mdash; click <strong>+ Add to Agent</strong> on any Skill or MCP Server in the Registry Explorer, or pick a preset from the top bar.</div>';
      return;
    }
    var nonMcp = sel.filter(function (e) { return e.kind !== 'mcp-server'; });
    if (nonMcp.length > 0) {
      var div = document.createElement('div');
      div.className = 'scope-server';
      div.innerHTML = '<h3>Skills / Plugins / DESIGN.md / Prompts (' + nonMcp.length + ')</h3>' +
        '<p class="text-xs text-slate-400 mb-2">Each item compiles to an explicit <code>allow</code> rule immediately after the leading <code>deny "*"</code> rule.</p>';
      var ul = document.createElement('ul');
      ul.className = 'flex flex-wrap gap-2 list-none p-0 m-0';
      nonMcp.forEach(function (e) {
        var li = document.createElement('li');
        li.className = 'px-2.5 py-1 rounded bg-emerald-500/10 border border-emerald-500/30 text-xs font-mono text-emerald-300';
        li.innerHTML = 'allow skill: <code>' + escHtml(e.id) + '</code>';
        ul.appendChild(li);
      });
      div.appendChild(ul);
      wrap.appendChild(div);
    }
    sel.filter(function (e) { return e.kind === 'mcp-server'; }).forEach(function (e) {
      wrap.appendChild(mcpServerBlock(e));
    });
  }

  function mcpServerBlock(entry) {
    var server = serverNameOf(entry);
    var tools = toolsOf(entry);
    var div = document.createElement('div');
    div.className = 'scope-server space-y-3';
    var norm = Compiler.normalizeMcpId(server);
    div.innerHTML = '<h3>MCP Server: <span class="text-teal-300 font-mono">' + escHtml(server) + '</span> <span class="text-xs text-slate-400">(<code>' +
      escHtml(norm) + '_*</code>)</span></h3>';
    var grid = document.createElement('div');
    grid.className = 'tool-grid';

    var allowAllLabel = document.createElement('label');
    var allowAll = document.createElement('input');
    allowAll.type = 'checkbox';
    allowAll.checked = true;
    allowAll.setAttribute('data-server-allow-all', server);
    allowAllLabel.appendChild(allowAll);
    allowAllLabel.appendChild(document.createTextNode(' Allow all (' + norm + '_*)'));
    grid.appendChild(allowAllLabel);

    tools.forEach(function (t) {
      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.setAttribute('data-server', server);
      cb.setAttribute('data-tool', t);
      label.appendChild(cb);
      var code = document.createElement('code');
      code.textContent = norm + '_' + Compiler.normalizeMcpId(t);
      label.appendChild(code);
      grid.appendChild(label);
      cb.addEventListener('change', function () {
        code.classList.toggle('denied', !cb.checked);
        renderPreview();
      });
    });
    div.appendChild(grid);

    var resLabel = document.createElement('label');
    resLabel.className = 'flex items-center gap-2 text-xs text-slate-300 pt-1 cursor-pointer';
    var resCb = document.createElement('input');
    resCb.type = 'checkbox';
    resCb.setAttribute('data-server-resources', server);
    resLabel.appendChild(resCb);
    resLabel.appendChild(document.createTextNode(
      ' Allow MCP resource access (opencode_list_mcp_resources / opencode_read_mcp_resource)'));
    div.appendChild(resLabel);

    allowAll.addEventListener('change', renderPreview);
    resCb.addEventListener('change', renderPreview);
    return div;
  }

  // ---- Permission simulator ----

  function runSimulator() {
    var action = ($('simAction').value || '').trim();
    var resource = ($('simResource').value || '').trim() || '*';
    var out = $('simResult');
    var traceEl = $('simTraceOutput');
    if (!action) {
      out.textContent = 'enter an action';
      out.className = 'sim-result';
      return;
    }
    try {
      var compiled = compileCurrent();
      var perms = compiled.opencodeV2.agents[compiled.slug].permissions;
      var decision = Compiler.evaluateV2Permission(perms, action, resource);
      out.textContent = decision.toUpperCase();
      out.className = 'sim-result ' + decision;
      if (traceEl && Compiler.traceV2Permission) {
        var tr = Compiler.traceV2Permission(perms, action, resource);
        if (tr.matchedRule) {
          traceEl.textContent = 'Winning rule [#' + tr.matchedIndex + ']: action="' +
            tr.matchedRule.action + '", resource="' + tr.matchedRule.resource +
            '" -> ' + tr.matchedRule.effect.toUpperCase();
        } else {
          traceEl.textContent = 'No rule matched; default fallback decision is ALLOW.';
        }
      }
    } catch (err) {
      out.textContent = 'error: ' + err.message;
      out.className = 'sim-result';
    }
  }

  // ---- Smart Scout & Multi-Signal Categorizer Lab ----

  var SCOUT_SAMPLES = {
    pi: {
      name: '@earendil-works/pi-review',
      repo: 'https://github.com/earendil-works/pi-review',
      desc: 'Practical code review workflow extension for Pi adding /review and /end-review slash commands.',
      keywords: 'pi-package, code-review, extension',
      deps: '@earendil-works/pi-coding-agent'
    },
    ghidra: {
      name: 'ghidra-binary-triage-mcp',
      repo: 'https://github.com/example/ghidra-binary-triage-mcp',
      desc: 'Model Context Protocol server for Ghidra reverse engineering, firmware unpacking, decompilation, and YARA malware triage.',
      keywords: 'mcp-server, ghidra, reverse-engineering, security',
      deps: '@modelcontextprotocol/sdk'
    },
    rust: {
      name: 'tokio-unsafe-audit-skill',
      repo: 'https://github.com/example/tokio-unsafe-audit-skill',
      desc: 'SKILL.md playbook for auditing unsafe Rust blocks, async Tokio cancellation safety, and Cargo workspace lifetimes.',
      keywords: 'skill, rust, cargo, tokio',
      deps: ''
    },
    design: {
      name: 'linear-saas-design-md',
      repo: 'https://github.com/example/linear-saas-design-md',
      desc: 'Drop-in DESIGN.md brand and UI design system for high-density SaaS dashboards and analytics workspaces.',
      keywords: 'design-md, saas, dashboard',
      deps: ''
    }
  };

  function runScoutLab() {
    if (!window.Classifier) return;
    var name = ($('scoutPkgName').value || 'sample-pkg').trim();
    var repo = ($('scoutRepoUrl').value || 'https://github.com/example/' + name).trim();
    var desc = ($('scoutDescription').value || '').trim();
    var kw = ($('scoutKeywords').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var depsList = ($('scoutDeps').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var depsObj = {};
    depsList.forEach(function (d) { depsObj[d] = '*'; });

    var cls = window.Classifier.classifyManifest(
      { name: name, description: desc },
      { name: name, description: desc, keywords: kw, dependencies: depsObj }
    );
    state.lastScoutClassification = { name: name, repo: repo, desc: desc, cls: cls };

    var card = $('scoutResultCard');
    var reasonsHtml = (cls.reasons || []).map(function (r) {
      return '<li class="text-slate-300">' + escHtml(r) + '</li>';
    }).join('');
    var altHtml = (cls.alternativeCategories || []).map(function (a) {
      return '<span class="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px]">' + escHtml(a.category) + ' (' + a.score + 'pt)</span>';
    }).join(' ');

    card.innerHTML =
      '<div class="flex items-center justify-between border-b border-slate-800 pb-2">' +
        '<div><span class="text-slate-400">Predicted Kind &amp; Category:</span> <strong class="text-teal-300 font-mono">' + escHtml(cls.kind) + ' &rarr; ' + escHtml(cls.category) + '</strong></div>' +
        '<span class="px-2 py-0.5 rounded-full text-[11px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">' + escHtml(cls.confidence) + '% Confidence</span>' +
      '</div>' +
      '<div class="flex flex-wrap gap-1.5 items-center">' +
        '<span class="text-slate-400">Harnesses:</span> ' +
        cls.harnesses.map(function (h) { return '<code class="px-1.5 py-0.2 rounded bg-slate-800 text-teal-300">' + escHtml(h) + '</code>'; }).join(' ') +
      '</div>' +
      (altHtml ? '<div class="flex flex-wrap gap-1.5 items-center"><span class="text-slate-400">Runner-up leaves:</span> ' + altHtml + '</div>' : '') +
      '<ul class="list-disc pl-4 space-y-0.5 text-[11px] pt-1">' + reasonsHtml + '</ul>';

    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-entry';
    var folderMap = { plugin: 'plugins', skill: 'skills', 'mcp-server': 'mcp-servers', 'design-md': 'design-md', prompt: 'prompts', agent: 'agents' };
    var folder = folderMap[cls.kind] || 'plugins';
    var sub = cls.category.indexOf(folder + '/') === 0 ? cls.category.slice(folder.length + 1) : cls.category;
    $('scoutTargetFile').textContent = 'data/' + folder + '/' + sub + '/' + slug + '.yaml';

    var yamlLines = [
      'id: ' + slug,
      'name: ' + JSON.stringify(name),
      'repo: ' + repo,
      'tagline: ' + JSON.stringify(desc.slice(0, 110) || name),
      'description: ' + JSON.stringify(desc || name),
      'kind: ' + cls.kind,
      'category: ' + cls.category,
      'harnesses:'
    ];
    cls.harnesses.forEach(function (h) { yamlLines.push('  - ' + h); });
    if (cls.topics && cls.topics.length > 0) {
      yamlLines.push('tags:');
      cls.topics.forEach(function (t) { yamlLines.push('  - ' + t); });
    }
    yamlLines.push('license: MIT');
    $('scoutYamlOutput').textContent = yamlLines.join('\n') + '\n';
  }

  function injectScoutCandidateIntoSession() {
    if (!state.lastScoutClassification) { runScoutLab(); }
    var sc = state.lastScoutClassification;
    if (!sc) return;
    var slug = sc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'custom-entry';
    if (!entryById(slug)) {
      var newEntry = {
        id: slug,
        name: sc.name,
        repo: sc.repo,
        tagline: sc.desc.slice(0, 120) || sc.name,
        description: sc.desc || sc.name,
        kind: sc.cls.kind,
        category: sc.cls.category,
        harnesses: sc.cls.harnesses,
        tags: sc.cls.topics || [],
        license: 'MIT'
      };
      if (sc.cls.kind === 'mcp-server') {
        newEntry.mcp = {
          server_name: slug,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', sc.name],
          tools: ['inspect', 'query', 'analyze']
        };
      }
      state.entries.unshift(newEntry);
    }
    addToAgent(slug);
    buildCategoryTree();
    renderAll();
  }

  // ---- Preview + export ----

  var TAB_FILES = {
    v2: function (c) { return 'opencode.' + c.slug + '.v2.json'; },
    v1: function (c) { return 'opencode.' + c.slug + '.v1.json'; },
    opencodeMd: function (c) { return '.opencode/agent/' + c.slug + '.md'; },
    pi: function (c) { return '.pi/settings.' + c.slug + '.json'; },
    claude: function (c) { return '.claude/agents/' + c.slug + '.md'; },
    codex: function (c) { return 'codex.' + c.slug + '.toml'; },
    gemini: function (c) { return '.gemini/settings.' + c.slug + '.json'; },
    cursor: function (c) { return '.cursor/rules/' + c.slug + '.mdc'; },
    windsurf: function (c) { return '.windsurfrules'; },
    copilot: function (c) { return '.github/copilot-instructions.md'; },
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
          '\n\n// --- .pi/mcp.json (with per-tool exposure) ---\n' +
          JSON.stringify(compiled.piMcpJson, null, 2) +
          '\n\n# --- AGENTS.md ---\n' +
          compiled.piAgentsMd;
      case 'claude':
        return compiled.claudeCodeAgentMd +
          '\n--- .mcp.json ---\n' +
          JSON.stringify(compiled.claudeCodeMcp, null, 2) + '\n';
      case 'codex': return compiled.codexConfigToml;
      case 'gemini':
        return '// --- .gemini/settings.json ---\n' +
          JSON.stringify(compiled.geminiSettingsJson, null, 2) +
          '\n\n# --- GEMINI.md ---\n' +
          compiled.geminiMd;
      case 'cursor':
        return compiled.cursorRuleMdc +
          '\n// --- .cursor/mcp.json ---\n' +
          JSON.stringify(compiled.cursorMcpJson, null, 2) + '\n';
      case 'windsurf':
        return compiled.windsurfRules +
          '\n// --- .windsurf/mcp_config.json ---\n' +
          JSON.stringify(compiled.windsurfMcpJson, null, 2) + '\n';
      case 'copilot':
        return compiled.copilotInstructionsMd +
          '\n// --- .vscode/mcp.json ---\n' +
          JSON.stringify(compiled.vscodeMcpJson, null, 2) + '\n';
      case 'install':
        return installCommand(currentRecipe()) + '\n\n' + compiled.installScriptSh;
      default: return '';
    }
  }

  function syncPreviewTabs() {
    var tabs = document.querySelectorAll('.preview-tab');
    tabs.forEach(function (x) {
      var active = x.dataset.tab === state.previewTab;
      x.classList.toggle('tab-active', active);
      x.classList.toggle('active', active);
    });
  }

  function renderPreview() {
    try {
      var compiled = compileCurrent();
      if ($('previewTargetPath') && TAB_FILES[state.previewTab]) {
        $('previewTargetPath').textContent = TAB_FILES[state.previewTab](compiled);
      }
      $('previewContent').innerHTML = highlight(tabText(state.previewTab, compiled));
      runSimulator();
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
    download(TAB_FILES[state.previewTab](compiled), tabText(state.previewTab, compiled));
  }

  function downloadBundle() {
    var compiled = compileCurrent();
    compiled.bundleFiles.forEach(function (f, i) {
      setTimeout(function () { download(f.path.replace(/\//g, '_'), f.content); }, i * 350);
    });
  }

  // ---- Config upload (importer) ----

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
      (r.skills || []).forEach(function (s) {
        if (state.selectedIds.indexOf(s) === -1) { state.selectedIds.push(s); }
      });
      (r.mcpSelections || []).forEach(function (ms) {
        var match = null;
        state.entries.forEach(function (e) {
          if (e.kind === 'mcp-server' &&
              Compiler.normalizeMcpId(serverNameOf(e)) === Compiler.normalizeMcpId(ms.server)) {
            match = e;
          }
        });
        if (match && state.selectedIds.indexOf(match.id) === -1) {
          state.selectedIds.push(match.id);
        }
      });
      status.textContent = 'Imported ' + recipes.length + ' recipe(s) from ' + name +
        ' — merged "' + r.slug + '" into the active agent.';
      renderAll();
    } catch (err) {
      status.textContent = 'Import failed for ' + name + ': ' + err.message;
    }
  }

  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function () { handleUploadedFile(file.name, String(reader.result || '')); };
    reader.onerror = function () { $('uploadStatus').textContent = 'Could not read ' + file.name; };
    reader.readAsText(file);
  }

  // ---- Helper agent drawer ----

  function loadHelperSettings() {
    var stored = {};
    try {
      stored = JSON.parse(localStorage.getItem(LS_LLM_KEY) || '{}');
    } catch (e) { stored = {}; }
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
    } catch (e) { /* storage unavailable */ }
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
      var hay = [e.id, e.name, e.tagline, e.description, e.category, (e.tags || []).join(' ')]
        .join(' ').toLowerCase();
      var score = 0;
      words.forEach(function (w) { if (hay.indexOf(w) !== -1) { score += 1; } });
      return { entry: e, score: score };
    }).filter(function (x) { return x.score > 0; });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 8).map(function (x) { return x.entry; });
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
      var match = null;
      state.entries.forEach(function (e) {
        if (e.kind === 'mcp-server' &&
            Compiler.normalizeMcpId(serverNameOf(e)) === Compiler.normalizeMcpId(ms.server || '')) {
          match = e;
        }
      });
      if (match && state.selectedIds.indexOf(match.id) === -1) {
        state.selectedIds.push(match.id);
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
    return notes.length > 0 ? 'Applied: ' + notes.join(', ') : 'No changes applied.';
  }

  function helperSystemPrompt() {
    return 'You are the Agent Builder helper. Given the registry summary and the current ' +
      'AgentRecipe JSON, respond with ONLY a JSON object like ' +
      '{"addSkills": ["<entry-id>"], "mcpSelections": [{"server": "<name>", "tools": ["*"]}], ' +
      '"prompt": "<refined system prompt>", "slug": "<slug>"} using only entry ids from the summary.';
  }

  // Same-origin per-boot token bridge (getRequestToken contract: x-ab-token
  // header or ?token= query param).
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
      out.textContent = 'Describe the agent you want first.';
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
      }).catch(function (err) {
        var sug = keywordSuggest(request);
        sug.forEach(function (e) { addToAgentSilent(e.id); });
        renderAll();
        out.textContent = 'Local MCP unavailable (' + err.message + '). ' +
          'Keyword fallback selected: ' + sug.map(function (e) { return e.id; }).join(', ');
      });
      return;
    }

    var baseUrl = ($('helperBaseUrl').value || '').trim();
    var model = ($('helperModel').value || '').trim();
    var apiKey = $('helperKey').value || '';
    if (!useProxy && (!baseUrl || !model)) {
      var sug = keywordSuggest(request);
      sug.forEach(function (e) { addToAgentSilent(e.id); });
      renderAll();
      out.textContent = 'Smart Offline Keyword Match selected: ' +
        sug.map(function (e) { return e.id; }).join(', ');
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
      } catch (e) {
        var m = String(text).match(/\{[\s\S]*\}/);
        if (!m) { throw new Error('helper did not return JSON'); }
        actions = JSON.parse(m[0]);
      }
      out.textContent = applyHelperActions(actions) + '\n' + JSON.stringify(actions, null, 2);
    }).catch(function (err) {
      out.textContent = 'Helper failed: ' + err.message;
    });
  }

  function addToAgentSilent(id) {
    if (state.selectedIds.indexOf(id) === -1) { state.selectedIds.push(id); }
  }

  // ---- Publish modal ----

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
    var title = 'Publish agent: ' + recipe.slug;
    var body = 'Agent crafted in the Agent Builder WebUI.\n\n' +
      'Permalink: ' + permalink + '\n\n' +
      '```yaml\n' + yaml + '```\n';
    $('publishIssueLink').href = GITHUB_ISSUE_BASE +
      '?template=publish-agent.yml' +
      '&title=' + encodeURIComponent(title) +
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
      (recipe.skills || []).forEach(function (id) {
        if (entryById(String(id)) && state.selectedIds.indexOf(String(id)) === -1) {
          state.selectedIds.push(String(id));
        }
      });
    } catch (e) { /* malformed permalink: ignore */ }
  }

  // ---- Theme ----

  function toggleTheme() {
    var current = document.body.dataset.theme;
    if (current === 'light') {
      document.body.dataset.theme = 'dark';
    } else {
      document.body.dataset.theme = 'light';
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function () { fallbackCopyText(text); });
    } else {
      fallbackCopyText(text);
    }
  }

  function fallbackCopyText(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_e) { /* ignore */ }
    ta.remove();
  }

  // ---- Studio Navigation ----

  function switchStudioTab(tabName) {
    state.studioTab = tabName;
    document.querySelectorAll('.studio-tab-btn').forEach(function (btn) {
      var active = btn.dataset.studioTab === tabName;
      btn.classList.toggle('tab-active', active);
      btn.classList.toggle('text-slate-400', !active);
    });
    var mapId = {
      explorer: 'view-explorer',
      harness: 'view-harness',
      scope: 'view-scope',
      scout: 'view-scout'
    };
    Object.keys(mapId).forEach(function (k) {
      var el = $(mapId[k]);
      if (el) {
        el.classList.toggle('hidden', k !== tabName);
      }
    });
  }

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
        switchStudioTab(btn.dataset.studioTab);
      });
    });

    // Kind filter pills
    document.querySelectorAll('.kind-pill-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.kindFilter = btn.dataset.kindPill || '';
        document.querySelectorAll('.kind-pill-btn').forEach(function (b) {
          var act = (b.dataset.kindPill || '') === state.kindFilter;
          b.classList.toggle('tab-active', act);
          b.classList.toggle('text-slate-400', !act);
        });
        renderCards();
      });
    });

    if ($('clearFiltersBtn')) {
      $('clearFiltersBtn').addEventListener('click', function () {
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
        buildCategoryTree();
        renderCards();
      });
    }

    if ($('clearSelectedBtn')) {
      $('clearSelectedBtn').addEventListener('click', function () {
        state.selectedIds = [];
        renderAll();
      });
    }

    if ($('presetAgentSelect')) {
      $('presetAgentSelect').addEventListener('change', function (e) {
        if (e.target.value) {
          loadAgentPresetById(e.target.value);
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

    var harnessMapToTab = {
      'opencode-v2': 'v2',
      'opencode-v1': 'v1',
      'opencode-md': 'opencodeMd',
      'pi': 'pi',
      'claude': 'claude',
      'codex': 'codex',
      'gemini': 'gemini',
      'cursor': 'cursor',
      'windsurf': 'windsurf',
      'copilot': 'copilot'
    };

    var harnessRadios = document.querySelectorAll('input[name="harness"]');
    harnessRadios.forEach(function (r) {
      r.addEventListener('change', function () {
        state.harness = document.querySelector('input[name="harness"]:checked').value;
        if (harnessMapToTab[state.harness]) {
          state.previewTab = harnessMapToTab[state.harness];
          syncPreviewTabs();
        }
        renderPreview();
      });
    });

    ['agentSlug', 'agentDescription', 'agentPrompt', 'agentMode', 'agentModel', 'piThinkingLevel', 'piMcpExposure', 'piDefaultTools'].forEach(function (id) {
      var el = $(id);
      if (el) {
        el.addEventListener('input', renderPreview);
        el.addEventListener('change', renderPreview);
      }
    });

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
    dz.addEventListener('click', function () { $('fileInput').click(); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { $('fileInput').click(); }
    });

    $('simButton').addEventListener('click', runSimulator);

    var tabs = document.querySelectorAll('.preview-tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        state.previewTab = t.dataset.tab;
        syncPreviewTabs();
        renderPreview();
      });
    });
    $('downloadFile').addEventListener('click', downloadCurrentFile);
    $('downloadBundle').addEventListener('click', downloadBundle);
    if ($('copyPreviewBtn')) {
      $('copyPreviewBtn').addEventListener('click', function () {
        var compiled = compileCurrent();
        copyText(tabText(state.previewTab, compiled));
      });
    }

    // Scout Lab wiring
    if ($('runScoutClassifyBtn')) {
      $('runScoutClassifyBtn').addEventListener('click', runScoutLab);
    }
    if ($('injectScoutEntryBtn')) {
      $('injectScoutEntryBtn').addEventListener('click', injectScoutCandidateIntoSession);
    }
    if ($('copyScoutYamlBtn')) {
      $('copyScoutYamlBtn').addEventListener('click', function () {
        copyText($('scoutYamlOutput').textContent || '');
      });
    }
    document.querySelectorAll('.scout-sample-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var s = SCOUT_SAMPLES[btn.dataset.scoutSample];
        if (!s) return;
        $('scoutPkgName').value = s.name;
        $('scoutRepoUrl').value = s.repo;
        $('scoutDescription').value = s.desc;
        $('scoutKeywords').value = s.keywords;
        $('scoutDeps').value = s.deps;
        runScoutLab();
      });
    });

    $('helperBtn').addEventListener('click', function () {
      $('helperDrawer').hidden = false;
    });
    $('helperClose').addEventListener('click', function () {
      $('helperDrawer').hidden = true;
    });
    $('helperSend').addEventListener('click', askHelper);

    $('publishBtn').addEventListener('click', openPublish);
    $('publishClose').addEventListener('click', function () {
      $('publishModal').hidden = true;
    });
    $('copyPermalink').addEventListener('click', function () {
      var input = $('permalink');
      input.select();
      copyText(input.value);
    });

    $('themeToggle').addEventListener('click', toggleTheme);

    loadHelperSettings();
    loadRegistry().then(function () {
      runScoutLab();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
