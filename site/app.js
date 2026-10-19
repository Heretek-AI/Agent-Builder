/* Agent Builder WebUI — zero-build plain JS (no bundler, no npm deps).
 *
 * Depends on ./core/compiler.js (global `Compiler`) and
 * ./core/importer.js (global `Importer`), loaded via <script> tags.
 * Registry: fetch('./registry.json') first, fall back to the GitHub Pages URL.
 */
(function () {
  'use strict';

  var REGISTRY_LOCAL = './registry.json';
  var REGISTRY_REMOTE = 'https://heretek-ai.github.io/Agent-Builder/registry.json';
  var LS_LLM_KEY = 'heretek_agent_builder_llm_key';
  var GITHUB_ISSUE_BASE = 'https://github.com/Heretek-AI/Agent-Builder/issues/new';

  var state = {
    registry: null, // { taxonomy, entries, stats }
    entries: [],
    categoryFilter: '',
    harnessFilter: '',
    languageFilter: '',
    platformFilter: '',
    query: '',
    selectedIds: [], // registry entry ids (skills, plugins, design-md, prompts)
    harness: 'opencode-v2',
    previewTab: 'v2',
    lastCompiled: null,
  };

  function $(id) { return document.getElementById(id); }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Minimal JSON/YAML-ish syntax highlight for <code> preview blocks.
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
    el.textContent = text;
    el.style.borderColor = ok === undefined ? '' : (ok ? 'var(--allow)' : 'var(--deny)');
  }

  function loadRegistry() {
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
      .then(function (data) {
        if (!data || !Array.isArray(data.entries)) {
          throw new Error('registry payload has no entries array');
        }
        state.registry = data;
        state.entries = data.entries;
        setStatus(data.entries.length + ' entries loaded', true);
        buildFilters();
        buildCategoryTree();
        renderCards();
        restoreRecipeFromUrl();
        renderAll();
      })
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

  function categoryLabel(node) {
    return node.title || node.id;
  }

  function buildCategoryTree() {
    var tree = $('categoryTree');
    tree.innerHTML = '';
    var root = document.createElement('ul');
    var allLi = document.createElement('li');
    allLi.appendChild(treeItem('', 'All entries'));
    root.appendChild(allLi);
    var cats = (state.registry && state.registry.taxonomy && state.registry.taxonomy.categories) || [];
    cats.forEach(function (top) {
      root.appendChild(treeNode(top));
    });
    tree.appendChild(root);
  }

  function treeNode(node) {
    var li = document.createElement('li');
    li.appendChild(treeItem(node.id, categoryLabel(node)));
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
      if (state.harnessFilter && (e.harnesses || []).indexOf(state.harnessFilter) === -1) { return false; }
      if (state.languageFilter && (e.languages || []).indexOf(state.languageFilter) === -1) { return false; }
      if (state.platformFilter && (e.platforms || []).indexOf(state.platformFilter) === -1) { return false; }
      if (q) {
        var hay = [e.id, e.name, e.tagline, e.description, e.category, (e.tags || []).join(' ')]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) { return false; }
      }
      return true;
    });
  }

  function renderCards() {
    var list = filteredEntries();
    $('resultCount').textContent = list.length + ' of ' + state.entries.length + ' entries';
    var wrap = $('cards');
    wrap.innerHTML = '';
    list.slice(0, 400).forEach(function (e) {
      var card = document.createElement('div');
      card.className = 'entry-card';
      var badges = (e.harnesses || []).map(function (h) {
        return '<span class="badge">' + escHtml(h) + '</span>';
      }).join('');
      var toolInfo = e.kind === 'mcp-server' ? ' <span class="badge">' + toolsOf(e).length + ' tools</span>' : '';
      card.innerHTML =
        '<h3>' + escHtml(e.name) + '</h3>' +
        '<p class="tagline">' + escHtml(e.tagline || '') + '</p>' +
        '<div class="badges"><span class="badge">' + escHtml(e.kind) + '</span>' +
        '<span class="badge">' + escHtml(e.category) + '</span>' + badges + toolInfo + '</div>';
      var btn = document.createElement('button');
      btn.type = 'button';
      var already = state.selectedIds.indexOf(e.id) !== -1;
      btn.textContent = already ? 'Added ✓' : '+ Add to Agent';
      btn.disabled = already;
      btn.addEventListener('click', function () { addToAgent(e.id); });
      card.appendChild(btn);
      wrap.appendChild(card);
    });
    if (list.length > 400) {
      var more = document.createElement('p');
      more.className = 'muted';
      more.textContent = 'Showing first 400 — refine filters to narrow.';
      wrap.appendChild(more);
    }
  }

  // ---- Recipe ----

  function entryById(id) {
    for (var i = 0; i < state.entries.length; i++) {
      if (state.entries[i].id === id) { return state.entries[i]; }
    }
    return null;
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

  // The permission simulator and exports need stable tool-level state per
  // MCP server: which tools are allowed, which are explicitly denied, and
  // whether resource access is granted. This is derived from the DOM
  // checkboxes when present, otherwise defaults to wildcard-allow.
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
    return {
      slug: ($('agentSlug').value || 'my-agent').trim() || 'my-agent',
      description: $('agentDescription').value || '',
      mode: $('agentMode').value || 'subagent',
      model: ($('agentModel').value || '').trim() || undefined,
      prompt: $('agentPrompt').value || '',
      skills: skillIds,
      mcpSelections: readMcpSelections(),
    };
  }

  function compileCurrent() {
    var recipe = currentRecipe();
    state.lastCompiled = Compiler.compileAgentRecipe(recipe, state.entries);
    return state.lastCompiled;
  }

  // ---- Selected list + scoping matrix ----

  function renderSelected() {
    var list = $('selectedList');
    list.innerHTML = '';
    selectedEntries().forEach(function (e) {
      var li = document.createElement('li');
      li.innerHTML = '<span><strong>' + escHtml(e.id) + '</strong> <span class="muted">' +
        escHtml(e.kind) + '</span></span> ';
      var rm = document.createElement('button');
      rm.type = 'button';
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
      wrap.innerHTML = '<p class="muted">Nothing selected yet — use “+ Add to Agent” in the explorer.</p>';
      return;
    }
    var nonMcp = sel.filter(function (e) { return e.kind !== 'mcp-server'; });
    if (nonMcp.length > 0) {
      var div = document.createElement('div');
      div.className = 'scope-server';
      div.innerHTML = '<h3>Skills / Plugins / DESIGN.md / Prompts (' + nonMcp.length + ')</h3>' +
        '<p class="muted">Each becomes an <code>allow</code> skill rule after the leading <code>deny "*"</code>.</p>';
      var ul = document.createElement('ul');
      nonMcp.forEach(function (e) {
        var li = document.createElement('li');
        li.innerHTML = '<code>' + escHtml(e.id) + '</code> <span class="muted">' + escHtml(e.kind) + '</span>';
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
    div.className = 'scope-server';
    var norm = Compiler.normalizeMcpId(server);
    div.innerHTML = '<h3>' + escHtml(server) + ' <span class="muted">(<code>' +
      escHtml(norm) + '_*</code>)</span></h3>';
    var grid = document.createElement('div');
    grid.className = 'tool-grid';

    var allowAllLabel = document.createElement('label');
    var allowAll = document.createElement('input');
    allowAll.type = 'checkbox';
    allowAll.checked = true;
    allowAll.setAttribute('data-server-allow-all', server);
    allowAllLabel.appendChild(allowAll);
    allowAllLabel.appendChild(document.createTextNode(' Allow all tools (' + norm + '_*)'));
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
    resLabel.className = 'radio';
    var resCb = document.createElement('input');
    resCb.type = 'checkbox';
    resCb.setAttribute('data-server-resources', server);
    resLabel.appendChild(resCb);
    resLabel.appendChild(document.createTextNode(
      ' Allow resource access (opencode_list_mcp_resources / opencode_read_mcp_resource)'));
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
    } catch (err) {
      out.textContent = 'error: ' + err.message;
      out.className = 'sim-result';
    }
  }

  // ---- Preview + export ----

  var TAB_FILES = {
    v2: function (c) { return 'opencode.' + c.slug + '.v2.json'; },
    v1: function (c) { return 'opencode.' + c.slug + '.v1.json'; },
    opencodeMd: function (c) { return '.opencode/agent/' + c.slug + '.md'; },
    claude: function (c) { return '.claude/agents/' + c.slug + '.md'; },
    codex: function (c) { return 'codex.' + c.slug + '.toml'; },
    install: function (c) { return 'install-' + c.slug + '.txt'; },
  };

  // AB-5.2: the CLI (`bin/agent-builder.js install`) accepts
  // `--recipe <file.json|base64url|inline JSON>` via loadRecipe and has no
  // `--slug` flag, so the Install tab emits a pastable
  // `--recipe <base64url>` command. base64url is shell-safe (no
  // spaces/quotes) and the CLI decodes it with decodeBase64Url.
  function installCommand(recipe) {
    var r = (recipe && typeof recipe === 'object') ? recipe : currentRecipe();
    return 'node bin/agent-builder.js install --recipe ' + base64UrlEncode(JSON.stringify(r));
  }

  function tabText(tab, compiled) {
    switch (tab) {
      case 'v2': return JSON.stringify(compiled.opencodeV2, null, 2) + '\n';
      case 'v1': return JSON.stringify(compiled.opencodeV1, null, 2) + '\n';
      case 'opencodeMd': return compiled.opencodeMarkdown;
      case 'claude':
        return compiled.claudeCodeAgentMd +
          '\n--- .mcp.json ---\n' +
          JSON.stringify(compiled.claudeCodeMcp, null, 2) + '\n';
      case 'codex': return compiled.codexConfigToml;
      case 'install': return installCommand(currentRecipe()) + '\n';
      default: return '';
    }
  }

  function renderPreview() {
    try {
      var compiled = compileCurrent();
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
    download(TAB_FILES[state.previewTab](compiled), tabText(state.previewTab, compiled));
  }

  function downloadBundle() {
    var compiled = compileCurrent();
    // Download every workspace file sequentially (Blob, no server needed).
    compiled.bundleFiles.forEach(function (f, i) {
      setTimeout(function () { download(f.path.replace(/\//g, '_'), f.content); }, i * 400);
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
      // Merge the first recipe into the active one (append skills, union MCP).
      var r = recipes[0];
      $('agentSlug').value = r.slug || $('agentSlug').value;
      if (r.description) { $('agentDescription').value = r.description; }
      if (r.mode) { $('agentMode').value = r.mode; }
      if (r.model) { $('agentModel').value = r.model; }
      if (r.prompt) { $('agentPrompt').value = r.prompt; }
      (r.skills || []).forEach(function (s) {
        if (state.selectedIds.indexOf(s) === -1) { state.selectedIds.push(s); }
      });
      // MCP selections from the upload are applied via the matrix on next
      // render: ensure those servers are selected when known in the registry.
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
    // API key lives in localStorage only — never in exports or URLs.
    try {
      localStorage.setItem(LS_LLM_KEY, JSON.stringify({
        baseUrl: $('helperBaseUrl').value || '',
        model: $('helperModel').value || '',
        apiKey: $('helperKey').value || '',
      }));
    } catch (e) { /* storage unavailable: keep session-only */ }
  }

  function registrySummary() {
    var lines = state.entries.slice(0, 200).map(function (e) {
      var extra = e.kind === 'mcp-server' ? ' tools=' + toolsOf(e).join(',') : '';
      return '- ' + e.id + ' [' + e.kind + '|' + e.category + ']' + extra;
    });
    return 'Registry (' + state.entries.length + ' entries; showing 200):\n' + lines.join('\n');
  }

  function keywordSuggest(request) {
    // Offline fallback when no LLM endpoint is configured: match request
    // keywords against entry ids/names/tags.
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
  // header or ?token= query param). The local server injects
  // <meta name="ab-token" content="..."> into same-origin index.html (or
  // window.__AB_TOKEN__ / ?token= launch URL). All same-origin /api/*
  // callers (/api/llm/chat, /api/mcp/introspect, /api/install) must send it.
  function getAbToken() {
    try {
      var m = document.querySelector('meta[name="ab-token"]');
      if (m && m.getAttribute('content')) {
        return m.getAttribute('content');
      }
    } catch (_e) { /* no DOM meta: fall through */ }
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
    // Header is primary; ?token= is the fallback getRequestToken also accepts.
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
        // Fall back to offline keyword suggestions so the drawer is useful
        // without a running local server.
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
      out.textContent = 'No endpoint configured — keyword fallback selected: ' +
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
    } catch (e) { /* malformed permalink: ignore, fail closed to defaults */ }
  }

  // ---- Theme ----

  function toggleTheme() {
    var current = document.body.dataset.theme;
    if (current === 'dark') { document.body.dataset.theme = 'light'; }
    else if (current === 'light') { document.body.dataset.theme = 'dark'; }
    else {
      var dark = window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.body.dataset.theme = dark ? 'light' : 'dark';
    }
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

    var harnessRadios = document.querySelectorAll('input[name="harness"]');
    harnessRadios.forEach(function (r) {
      r.addEventListener('change', function () {
        state.harness = document.querySelector('input[name="harness"]:checked').value;
        renderPreview();
      });
    });

    ['agentSlug', 'agentDescription', 'agentPrompt', 'agentMode', 'agentModel'].forEach(function (id) {
      $(id).addEventListener('input', renderPreview);
      $(id).addEventListener('change', renderPreview);
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
        tabs.forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        state.previewTab = t.dataset.tab;
        renderPreview();
      });
    });
    $('downloadFile').addEventListener('click', downloadCurrentFile);
    $('downloadBundle').addEventListener('click', downloadBundle);

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
      if (navigator.clipboard) {
        navigator.clipboard.writeText(input.value).catch(function () {
          document.execCommand('copy');
        });
      } else {
        document.execCommand('copy');
      }
    });

    $('themeToggle').addEventListener('click', toggleTheme);

    loadHelperSettings();
    loadRegistry();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
