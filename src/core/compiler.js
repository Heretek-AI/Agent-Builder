// src/core/compiler.js
// Multi-harness agent config compiler for @heretek-ai/agent-builder.
//
// Usable in both Node.js (CommonJS `require`) and the browser WebUI
// (plain `<script>` tag: exposes `Compiler` on the global scope).
//
// Implements the Verified OpenCode Per-Agent Skill & MCP Scoping Rules:
// deny-first ordering (OpenCode evaluates rules in order and the last
// matching rule wins), MCP tool naming normalization
// (`<serverName>_<toolName>` with all non-alphanumerics mapped to `_`),
// and deterministic exports for OpenCode v2 JSON, OpenCode v1 JSON,
// OpenCode agent Markdown, Claude Code (`.mcp.json` + agent `.md`),
// Codex CLI (`config.toml`), a safe placeholder install script, and a
// workspace bundle file list.

(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Compiler = api;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.Compiler = api;
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var V1_SCHEMA_URL = 'https://opencode.ai/config.json';
  var RESOURCE_ACTIONS = ['opencode_list_mcp_resources', 'opencode_read_mcp_resource'];

  // Verified normalization: all non-alphanumeric runs become `_`,
  // with leading/trailing underscores trimmed.
  function normalizeMcpId(str) {
    return String(str).trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  }

  function escapeRegExpPart(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function wildcardToRegExp(pattern) {
    return new RegExp('^' + String(pattern).split('*').map(escapeRegExpPart).join('.*') + '$');
  }

  // Deterministic permission simulator: last matching rule wins,
  // `*` matches any sequence, default decision is `allow` (no match).
  function evaluateV2Permission(permissions, action, resource) {
    if (!Array.isArray(permissions)) {
      throw new Error('evaluateV2Permission: permissions must be an array');
    }
    if (typeof action !== 'string' || action.length === 0) {
      throw new Error('evaluateV2Permission: action must be a non-empty string');
    }
    var res = resource === undefined ? '*' : String(resource);
    var decision = 'allow';
    for (var i = 0; i < permissions.length; i++) {
      var rule = permissions[i];
      if (!rule || typeof rule.action !== 'string' || typeof rule.resource !== 'string') {
        throw new Error('evaluateV2Permission: rule at index ' + i + ' must have string action/resource');
      }
      if (rule.effect !== 'allow' && rule.effect !== 'deny') {
        throw new Error(
          'evaluateV2Permission: rule at index ' + i +
          ' has invalid effect ' + JSON.stringify(rule.effect) + ' (expected "allow" or "deny")'
        );
      }
      if (wildcardToRegExp(rule.action).test(action) && wildcardToRegExp(rule.resource).test(res)) {
        decision = rule.effect;
      }
    }
    return decision;
  }

  function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function asStringArray(value, field, what) {
    if (!Array.isArray(value)) {
      throw new Error('compileAgentRecipe: ' + what + ' field "' + field + '" must be an array');
    }
    return value.map(function (entry, i) {
      if (typeof entry !== 'string' || entry.trim().length === 0) {
        throw new Error('compileAgentRecipe: ' + what + ' field "' + field + '" entry at index ' + i + ' must be a non-empty string');
      }
      return entry.trim();
    });
  }

  // Accepts `{ server, tools?, deniedTools?/deny?, allowResources? }` objects
  // or bare server-name strings (wildcard allow). `tools` may contain `'*'`
  // (allow every tool on that server) or explicit tool names. A missing or
  // empty `tools` list means deny-only (least privilege, fail closed).
  function normalizeSelection(sel, index) {
    var label = 'mcpSelections entry at index ' + index;
    if (typeof sel === 'string') {
      if (sel.trim().length === 0) {
        throw new Error('compileAgentRecipe: ' + label + ' must be a non-empty string');
      }
      return { server: sel.trim(), tools: ['*'], deniedTools: [], allowResources: false };
    }
    if (!isPlainObject(sel)) {
      throw new Error('compileAgentRecipe: ' + label + ' must be an object or server-name string');
    }
    var server = sel.server !== undefined ? sel.server
      : sel.server_name !== undefined ? sel.server_name
      : sel.name !== undefined ? sel.name
      : sel.id;
    if (typeof server !== 'string' || server.trim().length === 0) {
      throw new Error('compileAgentRecipe: ' + label + ' requires a non-empty server name (server/server_name/name/id)');
    }
    var rawTools = sel.tools !== undefined ? sel.tools
      : sel.allow !== undefined ? sel.allow
      : sel.allowedTools !== undefined ? sel.allowedTools
      : sel.enabledTools !== undefined ? sel.enabledTools
      : [];
    var tools;
    if (typeof rawTools === 'string') {
      tools = [rawTools.trim()];
    } else if (Array.isArray(rawTools)) {
      tools = rawTools.map(function (t, i) {
        if (typeof t !== 'string' || t.trim().length === 0) {
          throw new Error('compileAgentRecipe: ' + label + ' tool at index ' + i + ' must be a non-empty string');
        }
        return t.trim();
      });
    } else {
      throw new Error('compileAgentRecipe: ' + label + ' tools must be a string, an array of strings, or omitted');
    }
    var rawDeny = sel.deniedTools !== undefined ? sel.deniedTools
      : sel.deny !== undefined ? sel.deny
      : sel.denied !== undefined ? sel.denied
      : sel.excludedTools !== undefined ? sel.excludedTools
      : sel.disabledTools !== undefined ? sel.disabledTools
      : [];
    var deniedTools;
    if (typeof rawDeny === 'string') {
      deniedTools = [rawDeny.trim()];
    } else if (Array.isArray(rawDeny)) {
      deniedTools = rawDeny.map(function (t, i) {
        if (typeof t !== 'string' || t.trim().length === 0) {
          throw new Error('compileAgentRecipe: ' + label + ' denied tool at index ' + i + ' must be a non-empty string');
        }
        return t.trim();
      });
    } else {
      throw new Error('compileAgentRecipe: ' + label + ' denied tools must be a string, an array of strings, or omitted');
    }
    var allowResources = sel.allowResources !== undefined ? sel.allowResources
      : sel.resources !== undefined ? sel.resources
      : sel.allow_resources !== undefined ? sel.allow_resources
      : false;
    return {
      server: server.trim(),
      tools: tools,
      deniedTools: deniedTools,
      allowResources: Boolean(allowResources)
    };
  }

  // Known servers = union of registry `mcp-server` entries
  // (`mcp.server_name`, falling back to `id`) and recipe selections,
  // deduplicated by normalized name. Registry entries come first so
  // deny-rule ordering is deterministic.
  function collectKnownServers(selections, registryEntries) {
    var servers = [];
    var seen = {};
    function add(raw) {
      var norm = normalizeMcpId(raw);
      if (norm.length === 0 || seen[norm]) {
        return;
      }
      seen[norm] = true;
      servers.push({ raw: String(raw), norm: norm });
    }
    registryEntries.forEach(function (entry) {
      if (!isPlainObject(entry)) {
        return;
      }
      if (entry.kind !== 'mcp-server' && !entry.mcp && entry.server === undefined) {
        return;
      }
      var raw = entry.mcp !== undefined && isPlainObject(entry.mcp) &&
        (entry.mcp.server_name || entry.mcp.serverName)
        ? (entry.mcp.server_name || entry.mcp.serverName)
        : entry.server !== undefined ? entry.server
        : entry.id !== undefined ? entry.id
        : entry.name;
      if (typeof raw === 'string' && raw.trim().length > 0) {
        add(raw.trim());
      }
    });
    selections.forEach(function (sel) {
      add(sel.server);
    });
    return servers;
  }

  function findRegistryMcp(serverRaw, registryEntries) {
    var want = normalizeMcpId(serverRaw);
    for (var i = 0; i < registryEntries.length; i++) {
      var entry = registryEntries[i];
      if (!isPlainObject(entry)) {
        continue;
      }
      var raw = entry.mcp !== undefined && isPlainObject(entry.mcp) &&
        (entry.mcp.server_name || entry.mcp.serverName)
        ? (entry.mcp.server_name || entry.mcp.serverName)
        : entry.server !== undefined ? entry.server
        : entry.id !== undefined ? entry.id
        : entry.name;
      if (typeof raw === 'string' && normalizeMcpId(raw) === want) {
        return entry;
      }
    }
    return null;
  }

  function yamlDq(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function tomlQ(s) {
    return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }

  function tomlKey(s) {
    return /^[A-Za-z0-9_-]+$/.test(s) ? s : tomlQ(s);
  }

  function shQ(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  function buildClaudeTools(selections, registryEntries, deniedByServer) {
    var tools = [];
    function pushUnique(t) {
      if (tools.indexOf(t) === -1) {
        tools.push(t);
      }
    }
    selections.forEach(function (sel) {
      var norm = normalizeMcpId(sel.server);
      var denied = deniedByServer[norm] || [];
      var wildcard = sel.tools.some(function (t) { return String(t).trim() === '*'; });
      if (wildcard) {
        var reg = findRegistryMcp(sel.server, registryEntries);
        var regTools = reg && isPlainObject(reg.mcp) && Array.isArray(reg.mcp.tools) ? reg.mcp.tools : null;
        if (regTools) {
          regTools.forEach(function (t) {
            var nt = normalizeMcpId(t);
            if (nt.length > 0 && denied.indexOf(nt) === -1) {
              pushUnique('mcp__' + norm + '__' + nt);
            }
          });
        } else {
          pushUnique('mcp__' + norm);
        }
      } else {
        sel.tools.forEach(function (t) {
          var nt = normalizeMcpId(t);
          if (nt.length > 0 && denied.indexOf(nt) === -1) {
            pushUnique('mcp__' + norm + '__' + nt);
          }
        });
      }
    });
    return tools;
  }

  function compileAgentRecipe(recipe, registryEntries) {
    if (!isPlainObject(recipe)) {
      throw new Error('compileAgentRecipe: recipe must be an object');
    }
    var regs = registryEntries === undefined ? [] : registryEntries;
    if (!Array.isArray(regs)) {
      throw new Error('compileAgentRecipe: registryEntries must be an array');
    }
    var slugRaw = recipe.slug !== undefined ? recipe.slug
      : recipe.name !== undefined ? recipe.name
      : recipe.id;
    if (typeof slugRaw !== 'string' || slugRaw.trim().length === 0) {
      throw new Error('compileAgentRecipe: recipe requires a non-empty slug (slug/name/id)');
    }
    var slug = slugRaw.trim();
    var description = recipe.description === undefined ? '' : String(recipe.description);
    var modeProvided = recipe.mode !== undefined;
    var mode = modeProvided ? String(recipe.mode) : 'subagent';
    if (mode !== 'subagent' && mode !== 'primary') {
      throw new Error('compileAgentRecipe: mode must be "subagent" or "primary", got ' + JSON.stringify(mode));
    }
    var model = recipe.model === undefined ? undefined : String(recipe.model);
    var prompt = recipe.prompt !== undefined ? String(recipe.prompt)
      : recipe.systemPrompt !== undefined ? String(recipe.systemPrompt)
      : recipe.instructions !== undefined ? String(recipe.instructions)
      : '';
    var skills = recipe.skills === undefined ? [] : asStringArray(recipe.skills, 'skills', 'recipe');
    var rawSels = recipe.mcpSelections !== undefined ? recipe.mcpSelections
      : recipe.mcp !== undefined ? recipe.mcp
      : [];
    if (!Array.isArray(rawSels)) {
      throw new Error('compileAgentRecipe: mcpSelections/mcp must be an array');
    }
    var selections = rawSels.map(function (sel, i) { return normalizeSelection(sel, i); });
    var known = collectKnownServers(selections, regs);

    // ---- Deny-first v2 permission list (order matters: last match wins) ----
    var permissions = [];
    permissions.push({ action: 'skill', resource: '*', effect: 'deny' });
    skills.forEach(function (s) {
      permissions.push({ action: 'skill', resource: s, effect: 'allow' });
    });
    known.forEach(function (ks) {
      permissions.push({ action: ks.norm + '_*', resource: '*', effect: 'deny' });
    });
    selections.forEach(function (sel) {
      var norm = normalizeMcpId(sel.server);
      if (norm.length === 0) {
        throw new Error('compileAgentRecipe: selection server name ' + JSON.stringify(sel.server) + ' normalizes to an empty id');
      }
      var wildcard = sel.tools.some(function (t) { return String(t).trim() === '*'; });
      if (wildcard) {
        permissions.push({ action: norm + '_*', resource: '*', effect: 'allow' });
      } else {
        sel.tools.forEach(function (t) {
          var nt = normalizeMcpId(t);
          if (nt.length === 0) {
            throw new Error('compileAgentRecipe: selection tool name ' + JSON.stringify(t) + ' normalizes to an empty id');
          }
          permissions.push({ action: norm + '_' + nt, resource: '*', effect: 'allow' });
        });
      }
      // Explicit tool denies come after allows so they win (last match wins).
      sel.deniedTools.forEach(function (d) {
        var raw = String(d).trim();
        if (raw === '*') {
          return; // covered by the server-level deny rule
        }
        var nd = normalizeMcpId(raw);
        if (nd.length === 0) {
          throw new Error('compileAgentRecipe: denied tool name ' + JSON.stringify(d) + ' normalizes to an empty id');
        }
        permissions.push({ action: norm + '_' + nd, resource: '*', effect: 'deny' });
      });
    });
    RESOURCE_ACTIONS.forEach(function (a) {
      permissions.push({ action: a, resource: '*', effect: 'deny' });
    });
    selections.forEach(function (sel) {
      if (!sel.allowResources) {
        return;
      }
      RESOURCE_ACTIONS.forEach(function (a) {
        permissions.push({ action: a, resource: sel.server, effect: 'allow' });
        permissions.push({ action: a, resource: sel.server + ':*', effect: 'allow' });
      });
    });

    // ---- OpenCode v2 ----
    var agentV2 = { description: description, mode: mode, permissions: permissions };
    if (model !== undefined) {
      // Keep description/mode/model/permission key order stable.
      agentV2 = { description: description, mode: mode, model: model, permissions: permissions };
    }
    var opencodeV2 = { $schema: V1_SCHEMA_URL, agents: {} };
    opencodeV2.agents[slug] = agentV2;

    // ---- OpenCode v1 (key insertion order = evaluation order) ----
    var v1perm = { skill: { '*': 'deny' } };
    skills.forEach(function (s) {
      v1perm.skill[s] = 'allow';
    });
    var v1flat = [];
    known.forEach(function (ks) {
      v1flat.push([ks.norm + '_*', 'deny']);
    });
    selections.forEach(function (sel) {
      var norm = normalizeMcpId(sel.server);
      var wildcard = sel.tools.some(function (t) { return String(t).trim() === '*'; });
      if (wildcard) {
        v1flat.push([norm + '_*', 'allow']);
      } else {
        sel.tools.forEach(function (t) {
          v1flat.push([norm + '_' + normalizeMcpId(t), 'allow']);
        });
      }
      sel.deniedTools.forEach(function (d) {
        var raw = String(d).trim();
        if (raw === '*') {
          return;
        }
        v1flat.push([norm + '_' + normalizeMcpId(raw), 'deny']);
      });
    });
    v1flat.forEach(function (pair) {
      v1perm[pair[0]] = pair[1];
    });
    var agentV1 = { description: description, permission: v1perm };
    if (modeProvided) {
      agentV1.mode = mode;
    }
    if (model !== undefined) {
      agentV1.model = model;
    }
    var opencodeV1 = { $schema: V1_SCHEMA_URL, agent: {} };
    opencodeV1.agent[slug] = agentV1;

    // ---- OpenCode agent Markdown ----
    var fm = [];
    fm.push('description: ' + yamlDq(description));
    fm.push('mode: ' + mode);
    if (model !== undefined) {
      fm.push('model: ' + yamlDq(model));
    }
    fm.push('permission:');
    fm.push('  skill:');
    fm.push('    "*": deny');
    skills.forEach(function (s) {
      fm.push('    ' + yamlDq(s) + ': allow');
    });
    v1flat.forEach(function (pair) {
      fm.push('  ' + yamlDq(pair[0]) + ': ' + pair[1]);
    });
    var opencodeMarkdown = '---\n' + fm.join('\n') + '\n---\n\n' + prompt + '\n';

    // ---- Claude Code export ----
    var claudeServers = {};
    selections.forEach(function (sel) {
      var reg = findRegistryMcp(sel.server, regs);
      if (reg && isPlainObject(reg.mcp)) {
        var def = {};
        if (typeof reg.mcp.command === 'string') {
          def.command = reg.mcp.command;
        } else if (typeof reg.mcp.url === 'string') {
          def.url = reg.mcp.url;
        } else {
          def.command = 'npx';
        }
        if (Array.isArray(reg.mcp.args)) {
          def.args = reg.mcp.args.slice();
        }
        if (isPlainObject(reg.mcp.env)) {
          def.env = {};
          Object.keys(reg.mcp.env).forEach(function (k) {
            def.env[k] = reg.mcp.env[k];
          });
        }
        if (typeof reg.mcp.transport === 'string') {
          def.transport = reg.mcp.transport;
        }
        claudeServers[sel.server] = def;
      } else {
        // Safe placeholder without secrets; reviewer fills in transport details.
        claudeServers[sel.server] = { command: 'npx', args: ['-y', sel.server], env: {} };
      }
    });
    var claudeCodeMcp = { mcpServers: claudeServers };

    var deniedByServer = {};
    selections.forEach(function (sel) {
      deniedByServer[normalizeMcpId(sel.server)] = sel.deniedTools.map(function (d) {
        return normalizeMcpId(d);
      });
    });
    var claudeTools = buildClaudeTools(selections, regs, deniedByServer);
    if (skills.length > 0 && claudeTools.indexOf('Skill') === -1) {
      // The built-in Skill tool must be listed for skill references to load.
      claudeTools.unshift('Skill');
    }
    var mdLines = ['---', 'name: ' + slug, 'description: ' + yamlDq(description)];
    if (claudeTools.length === 0) {
      mdLines.push('tools: []');
    } else {
      mdLines.push('tools:');
      claudeTools.forEach(function (t) {
        mdLines.push('  - ' + (/^[A-Za-z0-9_]+$/.test(t) ? t : yamlDq(t)));
      });
    }
    if (model !== undefined) {
      mdLines.push('model: ' + yamlDq(model));
    }
    mdLines.push('---', '', prompt);
    if (skills.length > 0) {
      mdLines.push('', '## Skills', '');
      skills.forEach(function (s) {
        mdLines.push('- `.claude/skills/' + s + '/SKILL.md`');
      });
    }
    var claudeCodeAgentMd = mdLines.join('\n') + '\n';

    // ---- Codex CLI export ----
    var tomlBlocks = selections.map(function (sel) {
      var wildcard = sel.tools.some(function (t) { return String(t).trim() === '*'; });
      var enabled;
      if (wildcard) {
        var reg = findRegistryMcp(sel.server, regs);
        if (reg && isPlainObject(reg.mcp) && Array.isArray(reg.mcp.tools)) {
          var deniedNorms = deniedByServer[normalizeMcpId(sel.server)] || [];
          enabled = reg.mcp.tools.map(function (t) { return String(t); }).filter(function (t) {
            return deniedNorms.indexOf(normalizeMcpId(t)) === -1;
          });
        } else {
          enabled = ['*'];
        }
      } else {
        enabled = sel.tools.map(function (t) { return String(t); });
      }
      var disabled = sel.deniedTools.map(function (t) { return String(t).trim(); }).filter(function (t) {
        return t !== '*';
      });
      var block = ['[mcp_servers.' + tomlKey(sel.server) + ']'];
      block.push('enabled_tools = [' + enabled.map(tomlQ).join(', ') + ']');
      if (disabled.length > 0) {
        block.push('disabled_tools = [' + disabled.map(tomlQ).join(', ') + ']');
      }
      return block.join('\n');
    });
    var codexConfigToml = tomlBlocks.length > 0
      ? tomlBlocks.join('\n\n') + '\n'
      : '# No MCP servers selected for agent ' + tomlQ(slug) + '.\n';

    // ---- Safe placeholder install script (no secrets, mkdir + echo only) ----
    var installScriptSh = [
      '#!/bin/sh',
      '# Generated by @heretek-ai/agent-builder - installs agent ' + shQ(slug) + '.',
      '# Safe placeholder script: creates directories and prints next steps. No secrets embedded.',
      'set -eu',
      'AGENT_SLUG=' + shQ(slug),
      'mkdir -p ".opencode/agent" ".claude/agents" ".agents/skills"',
      'echo "Installing agent ${AGENT_SLUG}..."',
      'echo " - OpenCode v2/v1 : merge opencode.${AGENT_SLUG}.v2.json / opencode.${AGENT_SLUG}.v1.json into opencode.json"',
      'echo " - OpenCode agent : .opencode/agent/${AGENT_SLUG}.md"',
      'echo " - Claude Code    : .claude/agents/${AGENT_SLUG}.md and .mcp.${AGENT_SLUG}.json"',
      'echo " - Codex CLI      : merge codex.${AGENT_SLUG}.toml into config.toml"',
      'echo "Done. Review the deny-first permission rules before running the agent."',
      ''
    ].join('\n');

    // ---- Workspace bundle ----
    var bundleFiles = [
      { path: 'opencode.' + slug + '.v2.json', content: JSON.stringify(opencodeV2, null, 2) + '\n' },
      { path: 'opencode.' + slug + '.v1.json', content: JSON.stringify(opencodeV1, null, 2) + '\n' },
      { path: '.opencode/agent/' + slug + '.md', content: opencodeMarkdown },
      { path: '.claude/agents/' + slug + '.md', content: claudeCodeAgentMd },
      { path: '.mcp.' + slug + '.json', content: JSON.stringify(claudeCodeMcp, null, 2) + '\n' },
      { path: 'codex.' + slug + '.toml', content: codexConfigToml },
      { path: 'install-' + slug + '.sh', content: installScriptSh }
    ];

    return {
      slug: slug,
      opencodeV2: opencodeV2,
      opencodeV1: opencodeV1,
      opencodeMarkdown: opencodeMarkdown,
      claudeCodeMcp: claudeCodeMcp,
      claudeCodeAgentMd: claudeCodeAgentMd,
      codexConfigToml: codexConfigToml,
      installScriptSh: installScriptSh,
      bundleFiles: bundleFiles
    };
  }

  return {
    normalizeMcpId: normalizeMcpId,
    evaluateV2Permission: evaluateV2Permission,
    compileAgentRecipe: compileAgentRecipe
  };
}));
