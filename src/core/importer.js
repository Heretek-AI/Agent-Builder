// src/core/importer.js
// Config importer for @heretek-ai/agent-builder.
//
// Usable in both Node.js (CommonJS `require`) and the browser WebUI
// (plain `<script>` tag: exposes `Importer` on the global scope).
//
// `parseUploadedConfig(filename, rawContent)` accepts:
//   - `opencode.json` / `opencode.jsonc` (v2 `agents.<name>.permissions` array
//     or v1 `agent.<name>.permission` object)
//   - `.opencode/agent/<name>.md` or `.claude/agents/<name>.md` or `.cursor/rules/<name>.mdc`
//   - Claude / Pi / Cursor / Gemini `.mcp.json`, `mcp.json`, `claude.json`, `.gemini/settings.json` (`mcpServers`)
//   - Pi `settings.json` (`$schema: "https://pi.dev/schemas/settings.schema.json"` or `defaultTools`/`defaultModel`)
//   - VS Code `.vscode/mcp.json` (`servers`)
// and returns a normalized list of AgentRecipe objects ready to edit in the WebUI:
//   [{ slug, description, mode, model, prompt, skills, mcpSelections }]

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Importer = api;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.Importer = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var yamlLib = null;
  try {
    if (typeof require === 'function' && typeof module !== 'undefined' && module.exports) {
      yamlLib = require('js-yaml');
    }
  } catch (e) {
    yamlLib = null;
  }

  var RESOURCE_ACTIONS = ['opencode_list_mcp_resources', 'opencode_read_mcp_resource'];

  function normalizeMcpId(str) {
    return String(str).trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function stripJsonComments(input) {
    var text = String(input);
    var out = '';
    var i = 0;
    var inString = false;
    var escaped = false;
    var lineComment = false;
    var blockComment = false;
    while (i < text.length) {
      var ch = text[i];
      var next = i + 1 < text.length ? text[i + 1] : '';
      if (lineComment) {
        if (ch === '\n') {
          lineComment = false;
          out += ch;
        }
        i++;
        continue;
      }
      if (blockComment) {
        if (ch === '*' && next === '/') {
          blockComment = false;
          i += 2;
        } else {
          if (ch === '\n') {
            out += ch;
          }
          i++;
        }
        continue;
      }
      if (inString) {
        out += ch;
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        i++;
        continue;
      }
      if (ch === '"') {
        inString = true;
        out += ch;
        i++;
        continue;
      }
      if (ch === '/' && next === '/') {
        lineComment = true;
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        blockComment = true;
        i += 2;
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  }

  function parseScalarToken(token) {
    var v = token.trim();
    if (v.length >= 2 && ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))) {
      var quote = v[0];
      var inner = v.slice(1, -1);
      if (quote === '"') {
        inner = inner.replace(/\\(.)/g, function (m, c) {
          if (c === 'n') { return '\n'; }
          if (c === 't') { return '\t'; }
          if (c === 'r') { return '\r'; }
          return c;
        });
      }
      return inner;
    }
    return v;
  }

  function colonOutsideQuotes(s) {
    var quote = null;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (quote) {
        if (ch === '\\' && quote === '"') {
          i++;
        } else if (ch === quote) {
          quote = null;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ':') {
        return i;
      }
    }
    return -1;
  }

  function parseYamlish(lines) {
    var ls = lines.map(function (l) { return String(l).replace(/\r$/, ''); });
    var pos = 0;

    function indentOf(s) {
      var m = s.match(/^ */);
      return m ? m[0].length : 0;
    }

    function parseBlock(minIndent) {
      var k = pos;
      while (k < ls.length && ls[k].trim() === '') {
        k++;
      }
      if (k >= ls.length || indentOf(ls[k]) < minIndent) {
        return {};
      }
      if (ls[k].trim().indexOf('- ') === 0) {
        var arr = [];
        while (pos < ls.length) {
          var line = ls[pos];
          if (line.trim() === '') {
            pos++;
            continue;
          }
          if (indentOf(line) < minIndent) {
            break;
          }
          var t = line.trim();
          if (t.indexOf('- ') !== 0) {
            break;
          }
          arr.push(parseScalarToken(t.slice(2)));
          pos++;
        }
        return arr;
      }
      var obj = {};
      while (pos < ls.length) {
        var cur = ls[pos];
        if (cur.trim() === '') {
          pos++;
          continue;
        }
        var ind = indentOf(cur);
        if (ind < minIndent) {
          break;
        }
        if (ind > minIndent) {
          throw new Error('parseUploadedConfig: malformed frontmatter indentation at line: ' + cur.trim());
        }
        var trimmed = cur.trim();
        if (trimmed.indexOf('- ') === 0) {
          break;
        }
        var ci = colonOutsideQuotes(trimmed);
        if (ci === -1) {
          throw new Error('parseUploadedConfig: malformed frontmatter line: ' + trimmed);
        }
        var key = parseScalarToken(trimmed.slice(0, ci));
        var rest = trimmed.slice(ci + 1).trim();
        pos++;
        if (rest !== '') {
          obj[key] = parseScalarToken(rest);
        } else {
          var n = pos;
          while (n < ls.length && ls[n].trim() === '') {
            n++;
          }
          if (n < ls.length && indentOf(ls[n]) > ind) {
            obj[key] = parseBlock(indentOf(ls[n]));
          } else {
            obj[key] = {};
          }
        }
      }
      return obj;
    }

    return parseBlock(0);
  }

  function parseFrontmatter(raw, filename) {
    var text = String(raw).replace(/\r\n/g, '\n');
    var lines = text.split('\n');
    if (lines.length === 0 || lines[0].trim() !== '---') {
      throw new Error('parseUploadedConfig: "' + filename + '" must start with --- YAML frontmatter');
    }
    var end = -1;
    for (var i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        end = i;
        break;
      }
    }
    if (end === -1) {
      throw new Error('parseUploadedConfig: "' + filename + '" has unterminated frontmatter (missing closing ---)');
    }
    var fmText = lines.slice(1, end).join('\n');
    var body = lines.slice(end + 1).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    var data;
    if (yamlLib && typeof yamlLib.load === 'function') {
      try {
        data = yamlLib.load(fmText);
      } catch (e) {
        throw new Error('parseUploadedConfig: "' + filename + '" frontmatter YAML error: ' + e.message);
      }
      if (data === undefined || data === null) {
        data = {};
      }
    } else {
      data = parseYamlish(fmText.split('\n'));
    }
    if (!isPlainObject(data)) {
      throw new Error('parseUploadedConfig: "' + filename + '" frontmatter must be a key/value mapping');
    }
    return { data: data, body: body };
  }

  function slugFromFilename(filename) {
    var base = String(filename).split('/').pop().split('\\').pop();
    base = base.replace(/^\.+/, '');
    var dot = base.indexOf('.');
    var name = (dot === -1 ? base : base.slice(0, dot)).trim().toLowerCase();
    name = name.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return name || 'imported-agent';
  }

  function normalizeEffect(value, slug) {
    var eff = String(value).trim();
    if (eff !== 'allow' && eff !== 'deny') {
      throw new Error(
        'parseUploadedConfig: agent "' + slug + '" has invalid permission effect ' +
        JSON.stringify(value) + ' (expected "allow" or "deny")'
      );
    }
    return eff;
  }

  function longestServerPrefix(action, knownNorms) {
    var best = null;
    for (var i = 0; i < knownNorms.length; i++) {
      var k = knownNorms[i];
      if (action.length > k.length && action.indexOf(k + '_') === 0) {
        if (best === null || k.length > best.length) {
          best = k;
        }
      }
    }
    return best;
  }

  function buildSelectionsFromRules(rules) {
    var knownNorms = [];
    rules.forEach(function (r) {
      if (!r || typeof r.action !== 'string') {
        return;
      }
      if (r.action === 'skill' || RESOURCE_ACTIONS.indexOf(r.action) !== -1) {
        return;
      }
      if (r.action.length > 2 && r.action.slice(-2) === '_*') {
        var n = r.action.slice(0, -2);
        if (knownNorms.indexOf(n) === -1) {
          knownNorms.push(n);
        }
      }
    });
    var order = [];
    var accs = {};
    function accFor(norm) {
      if (!accs[norm]) {
        accs[norm] = { server: norm, tools: [], wildcard: false, denied: [], allowResources: false };
        order.push(norm);
      }
      return accs[norm];
    }
    var skillAllows = [];
    rules.forEach(function (r) {
      if (!r || typeof r.action !== 'string' || typeof r.resource !== 'string') {
        throw new Error('parseUploadedConfig: permission rule must have string action/resource');
      }
      if (r.effect !== 'allow' && r.effect !== 'deny') {
        throw new Error(
          'parseUploadedConfig: permission rule for action ' + JSON.stringify(r.action) +
          ' has invalid effect ' + JSON.stringify(r.effect) + ' (expected "allow" or "deny")'
        );
      }
      var a = r.action;
      if (a === 'skill') {
        if (r.effect === 'allow' && r.resource !== '*') {
          skillAllows.push(r.resource);
        }
        return;
      }
      if (RESOURCE_ACTIONS.indexOf(a) !== -1) {
        if (r.effect === 'allow' && r.resource !== '*') {
          var base = r.resource.slice(-2) === ':*' ? r.resource.slice(0, -2) : r.resource;
          var baseNorm = normalizeMcpId(base);
          var target = null;
          var i;
          for (i = 0; i < order.length; i++) {
            if (normalizeMcpId(order[i]) === baseNorm) {
              target = order[i];
              break;
            }
          }
          if (!target) {
            for (i = 0; i < knownNorms.length; i++) {
              if (normalizeMcpId(knownNorms[i]) === baseNorm) {
                target = knownNorms[i];
                break;
              }
            }
          }
          if (target) {
            accFor(target).allowResources = true;
          } else if (baseNorm) {
            accFor(baseNorm).allowResources = true;
          }
        }
        return;
      }
      if (a.length > 2 && a.slice(-2) === '_*') {
        if (r.effect === 'allow') {
          accFor(a.slice(0, -2)).wildcard = true;
        }
        return;
      }
      var prefix = longestServerPrefix(a, knownNorms.concat(order));
      var server;
      var tool;
      if (prefix) {
        server = prefix;
        tool = a.slice(prefix.length + 1);
      } else {
        var us = a.indexOf('_');
        if (us === -1) {
          throw new Error('parseUploadedConfig: cannot map action to an MCP server: ' + JSON.stringify(a));
        }
        server = a.slice(0, us);
        tool = a.slice(us + 1);
        if (knownNorms.indexOf(server) === -1) {
          knownNorms.push(server);
        }
      }
      if (tool.length === 0) {
        throw new Error('parseUploadedConfig: cannot map action to an MCP tool: ' + JSON.stringify(a));
      }
      var acc = accFor(server);
      if (r.effect === 'allow') {
        if (acc.tools.indexOf(tool) === -1) {
          acc.tools.push(tool);
        }
      } else if (acc.denied.indexOf(tool) === -1) {
        acc.denied.push(tool);
      }
    });
    var selections = [];
    order.forEach(function (norm) {
      var acc = accs[norm];
      if (!acc.wildcard && acc.tools.length === 0 && acc.denied.length === 0 && !acc.allowResources) {
        return;
      }
      selections.push({
        server: norm,
        tools: acc.wildcard ? ['*'] : acc.tools,
        deniedTools: acc.denied,
        allowResources: acc.allowResources
      });
    });
    return { skills: skillAllows, selections: selections };
  }

  function recipeMeta(cfg, slug) {
    if (!isPlainObject(cfg)) {
      throw new Error('parseUploadedConfig: agent "' + slug + '" must be an object');
    }
    return {
      description: cfg.description === undefined ? '' : String(cfg.description),
      mode: cfg.mode === undefined ? 'subagent' : String(cfg.mode),
      model: cfg.model === undefined ? undefined : String(cfg.model),
      prompt: cfg.prompt !== undefined ? String(cfg.prompt)
        : cfg.systemPrompt !== undefined ? String(cfg.systemPrompt)
        : ''
    };
  }

  function warnDenyOnly(slug) {
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(
        'parseUploadedConfig: agent "' + slug + '" has no allow rules ' +
        '(no skills, no MCP tools); imported as deny-only — every skill ' +
        'and MCP action will be denied until you scope explicit allows.'
      );
    }
  }

  function recipeFromV2(slug, cfg) {
    var meta = recipeMeta(cfg, slug);
    var perms = Array.isArray(cfg.permissions) ? cfg.permissions : [];
    var parts = buildSelectionsFromRules(perms);
    if (parts.skills.length === 0 && parts.selections.length === 0) {
      warnDenyOnly(slug);
    }
    return {
      slug: slug,
      description: meta.description,
      mode: meta.mode,
      model: meta.model,
      prompt: meta.prompt,
      skills: parts.skills,
      mcpSelections: parts.selections
    };
  }

  function recipeFromV1(slug, cfg) {
    var meta = recipeMeta(cfg, slug);
    var perm = isPlainObject(cfg.permission) ? cfg.permission : {};
    var rules = [];
    Object.keys(perm).forEach(function (key) {
      var val = perm[key];
      if (key === 'skill') {
        if (!isPlainObject(val)) {
          throw new Error('parseUploadedConfig: agent "' + slug + '" permission.skill must be an object');
        }
        Object.keys(val).forEach(function (sk) {
          rules.push({ action: 'skill', resource: sk, effect: normalizeEffect(val[sk], slug) });
        });
        return;
      }
      rules.push({ action: key, resource: '*', effect: normalizeEffect(val, slug) });
    });
    var parts = buildSelectionsFromRules(rules);
    if (parts.skills.length === 0 && parts.selections.length === 0) {
      warnDenyOnly(slug);
    }
    return {
      slug: slug,
      description: meta.description,
      mode: meta.mode,
      model: meta.model,
      prompt: meta.prompt,
      skills: parts.skills,
      mcpSelections: parts.selections
    };
  }

  // Supports Claude `.mcp.json`, Pi `mcp.json` (with `toolExposure`),
  // Gemini `.gemini/settings.json` (with `includeTools`/`excludeTools`),
  // and Cursor/Windsurf `mcpServers`.
  function recipesFromMcpServers(servers, filename) {
    if (!isPlainObject(servers)) {
      throw new Error('parseUploadedConfig: "' + filename + '" mcpServers must be an object');
    }
    var slug = slugFromFilename(filename);
    var selections = Object.keys(servers).map(function (s) {
      var srv = servers[s] || {};
      var tools = ['*'];
      var denied = [];
      // Pi `toolExposure` support
      if (isPlainObject(srv.toolExposure)) {
        var allowedList = [];
        Object.keys(srv.toolExposure).forEach(function (tk) {
          var exp = srv.toolExposure[tk];
          if (exp === 'hidden') {
            if (tk !== '*') denied.push(tk);
          } else if (tk !== '*') {
            allowedList.push(tk);
          }
        });
        if (srv.exposure === 'hidden') {
          // Fail-closed: a hidden server must never fall back to a wildcard
          // allow. The explicit allow list stands even when empty (deny-only).
          tools = allowedList;
        }
      } else if (srv.exposure === 'hidden') {
        // Fail-closed (CWE-284): hidden with no toolExposure map is
        // deny-only — never fall back to wildcard allow.
        tools = [];
      }
      // Gemini CLI `includeTools` / `excludeTools` support
      if (Array.isArray(srv.includeTools) && srv.includeTools.length > 0) {
        tools = srv.includeTools.map(String);
      }
      if (Array.isArray(srv.excludeTools)) {
        srv.excludeTools.forEach(function (d) {
          if (denied.indexOf(String(d)) === -1) denied.push(String(d));
        });
      }
      return { server: s, tools: tools, deniedTools: denied, allowResources: false };
    });
    if (selections.length === 0) {
      warnDenyOnly(slug);
    }
    return [{
      slug: slug,
      description: 'Imported from ' + String(filename).split('/').pop(),
      mode: 'subagent',
      model: undefined,
      prompt: '',
      skills: [],
      mcpSelections: selections
    }];
  }

  // Pi `settings.json` (`https://pi.dev/schemas/settings.schema.json`)
  function recipesFromPiSettings(parsed, filename) {
    var slug = slugFromFilename(filename);
    var model;
    if (typeof parsed.defaultProvider === 'string' && typeof parsed.defaultModel === 'string') {
      model = parsed.defaultProvider + '/' + parsed.defaultModel;
    } else if (typeof parsed.defaultModel === 'string') {
      model = parsed.defaultModel;
    }
    var skills = [];
    if (Array.isArray(parsed.skills)) {
      parsed.skills.forEach(function (sp) {
        var clean = String(sp).replace(/^\.?\/?(?:\.pi\/)?skills\//, '').replace(/\/+$/, '');
        if (clean) skills.push(clean);
      });
    }
    if (skills.length === 0) {
      warnDenyOnly(slug);
    }
    return [{
      slug: slug,
      description: 'Imported Pi settings from ' + String(filename).split('/').pop(),
      mode: 'primary',
      model: model,
      prompt: '',
      skills: skills,
      mcpSelections: []
    }];
  }

  function extractGenericSkills(body) {
    var skills = [];
    function pushSkill(s) {
      var v = String(s).trim();
      if (v && skills.indexOf(v) === -1) {
        skills.push(v);
      }
    }
    var patterns = [
      /\.claude\/skills\/([^/\s`'"]+)\/SKILL\.md/g,
      /\.pi\/skills\/([^/\s`'"]+)\/SKILL\.md/g,
      /\.windsurf\/skills\/([^/\s`'"]+)\/SKILL\.md/g,
      /\.cursor\/rules\/([^/\s`'"]+)\.mdc/g
    ];
    patterns.forEach(function (re) {
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(body)) !== null) {
        pushSkill(m[1]);
      }
    });
    // Backticked skill refs under Scoped Skills / Active Skills / Referenced
    // Playbooks / Enabled Skills sections (Cursor, Windsurf, Copilot, Pi, Gemini).
    var sectionRe = /##\s+(?:Scoped Skills|Active Skills|Referenced Playbooks|Enabled Skills)[^\n]*\n([\s\S]*?)(?=\n##\s+|\n?$)/i;
    var sec = sectionRe.exec(body);
    if (sec) {
      var backtickRe = /`([^`\n]+)`/g;
      var b;
      while ((b = backtickRe.exec(sec[1])) !== null) {
        var raw = String(b[1]).trim();
        var pathSkill = /(?:\.pi\/skills\/|\.windsurf\/skills\/|\.claude\/skills\/)([^/\s`'"]+)\/SKILL\.md/.exec(raw);
        if (pathSkill) {
          pushSkill(pathSkill[1]);
        } else {
          pushSkill(raw);
        }
      }
      // Plain `- skill-id` list items (Gemini `## Active Skills` emits no
      // backticks): accept kebab-case tokens so the round-trip preserves them.
      var lines = sec[1].split('\n');
      lines.forEach(function (ln) {
        var t = ln.trim();
        if (t.indexOf('- ') !== 0) {
          return;
        }
        var item = t.slice(2).trim().replace(/^`|`$/g, '').trim();
        if (/^[a-z0-9][a-z0-9_-]*$/i.test(item)) {
          pushSkill(item);
        }
      });
    }
    return skills;
  }

  function recipeFromPlainMarkdown(filename, raw) {
    var text = String(raw).replace(/\r\n/g, '\n').trim() + '\n';
    var slug = slugFromFilename(filename);
    var skills = extractGenericSkills(text);
    var descMatch = /^#\s+([^\n]+)/.exec(text);
    var description = descMatch ? descMatch[1].trim().slice(0, 512) : 'Imported from ' + String(filename).split('/').pop();
    if (skills.length === 0) {
      warnDenyOnly(slug);
    }
    return [{
      slug: slug,
      description: description,
      mode: 'subagent',
      model: undefined,
      prompt: text.trim() + '\n',
      skills: skills,
      mcpSelections: []
    }];
  }

  function recipeFromClaudeMarkdown(data, body, filename) {
    var rawName = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : slugFromFilename(filename);
    var tools = Array.isArray(data.tools) ? data.tools : [];
    var byServer = {};
    var order = [];
    tools.forEach(function (t) {
      var entry = String(t).trim();
      if (entry === 'Skill' || entry === '*') {
        return;
      }
      if (entry.indexOf('mcp__') !== 0) {
        return;
      }
      var rest = entry.slice('mcp__'.length);
      var parts = rest.split('__');
      var server = parts[0];
      var tool = parts.slice(1).join('__');
      if (!server) {
        return;
      }
      if (!byServer[server]) {
        byServer[server] = [];
        order.push(server);
      }
      if (tool && tool !== '*' && byServer[server].indexOf(tool) === -1) {
        byServer[server].push(tool);
      } else if (!tool) {
        byServer[server] = ['*'];
      }
    });
    var selections = order.map(function (server) {
      return { server: server, tools: byServer[server].length > 0 ? byServer[server] : ['*'], deniedTools: [], allowResources: false };
    });
    var skills = extractGenericSkills(body);
    return {
      slug: rawName,
      description: data.description === undefined ? (typeof data.globs === 'string' || Array.isArray(data.globs) ? slugFromFilename(filename) + ' cursor rule' : '') : String(data.description),
      mode: 'subagent',
      model: data.model === undefined ? undefined : String(data.model),
      prompt: body,
      skills: skills,
      mcpSelections: selections
    };
  }

  function isMarkdownFilename(filename) {
    var base = String(filename).split('/').pop().split('\\').pop();
    if (/\.markdown?$/i.test(filename) || /\.(md|mdc)$/i.test(filename)) {
      return true;
    }
    if (/^(AGENTS|GEMINI)(\..*)?$/i.test(base)) {
      return true;
    }
    if (/windsurfrules/i.test(base) || /copilot-instructions/i.test(base)) {
      return true;
    }
    if (/\.windsurfrules(\..*)?$/i.test(filename)) {
      return true;
    }
    return false;
  }

  function isPlainMarkdownFilename(filename) {
    var base = String(filename).split('/').pop().split('\\').pop();
    if (/^(AGENTS|GEMINI)(\..*)?$/i.test(base)) {
      return true;
    }
    if (/windsurfrules/i.test(base) || /copilot-instructions/i.test(base)) {
      return true;
    }
    return false;
  }

  function recipeFromMarkdown(filename, raw) {
    var text = String(raw);
    var trimmedStart = text.replace(/^\s+/, '');
    if (trimmedStart.slice(0, 3) !== '---') {
      // Plain client markdown without frontmatter (GEMINI.md, AGENTS.md,
      // .windsurfrules, copilot-instructions.md): prompt + skill refs.
      // All other agent markdown (.opencode/agent/*.md, .claude/agents/*.md,
      // .cursor/rules/*.mdc) requires frontmatter — fail closed.
      if (isPlainMarkdownFilename(filename)) {
        return recipeFromPlainMarkdown(filename, text);
      }
      throw new Error('parseUploadedConfig: "' + filename + '" must start with --- YAML frontmatter');
    }
    var fm = parseFrontmatter(raw, filename);
    var data = fm.data;
    if (isPlainObject(data.permission)) {
      var slug = typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : slugFromFilename(filename);
      var perm = data.permission;
      var rules = [];
      Object.keys(perm).forEach(function (key) {
        var val = perm[key];
        if (key === 'skill') {
          if (!isPlainObject(val)) {
            throw new Error('parseUploadedConfig: "' + filename + '" permission.skill must be a mapping');
          }
          Object.keys(val).forEach(function (sk) {
            rules.push({ action: 'skill', resource: sk, effect: normalizeEffect(val[sk], slug) });
          });
          return;
        }
        rules.push({ action: key, resource: '*', effect: normalizeEffect(val, slug) });
      });
      var parts = buildSelectionsFromRules(rules);
      return [{
        slug: slug,
        description: data.description === undefined ? '' : String(data.description),
        mode: data.mode === undefined ? 'subagent' : String(data.mode),
        model: data.model === undefined ? undefined : String(data.model),
        prompt: fm.body,
        skills: parts.skills,
        mcpSelections: parts.selections
      }];
    }
    return [recipeFromClaudeMarkdown(data, fm.body, filename)];
  }

  function parseUploadedConfig(filename, rawContent) {
    if (typeof filename !== 'string' || filename.length === 0) {
      throw new Error('parseUploadedConfig: filename must be a non-empty string');
    }
    if (typeof rawContent !== 'string') {
      throw new Error('parseUploadedConfig: rawContent must be a string');
    }
    if (isMarkdownFilename(filename)) {
      return recipeFromMarkdown(filename, rawContent);
    }
    var stripped = stripJsonComments(rawContent);
    var parsed;
    try {
      parsed = JSON.parse(stripped);
    } catch (e) {
      throw new Error('parseUploadedConfig: "' + filename + '" is not valid JSON: ' + e.message);
    }
    if (!isPlainObject(parsed)) {
      throw new Error('parseUploadedConfig: "' + filename + '" must contain a JSON object');
    }
    if (isPlainObject(parsed.agents)) {
      return Object.keys(parsed.agents).map(function (slug) {
        return recipeFromV2(slug, parsed.agents[slug]);
      });
    }
    if (isPlainObject(parsed.agent)) {
      return Object.keys(parsed.agent).map(function (slug) {
        return recipeFromV1(slug, parsed.agent[slug]);
      });
    }
    if (parsed.mcpServers !== undefined) {
      return recipesFromMcpServers(parsed.mcpServers, filename);
    }
    if (isPlainObject(parsed.servers)) {
      return recipesFromMcpServers(parsed.servers, filename);
    }
    if (
      (typeof parsed.$schema === 'string' && parsed.$schema.indexOf('pi.dev/schemas/settings') !== -1) ||
      parsed.defaultTools !== undefined ||
      parsed.defaultThinkingLevel !== undefined
    ) {
      return recipesFromPiSettings(parsed, filename);
    }
    throw new Error(
      'parseUploadedConfig: "' + filename + '" does not look like opencode.json ' +
      '(agents/agent), claude.json / .mcp.json (mcpServers), Pi settings.json, or agent Markdown'
    );
  }

  return {
    parseUploadedConfig: parseUploadedConfig,
    stripJsonComments: stripJsonComments
  };
}));
