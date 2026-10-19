# Contributing to Agent-Builder

Thank you for contributing to the multi-harness AI Agent Registry & Awesome List.
This guide covers how to add entries, validate them, and regenerate artifacts.

## Quick workflow

```bash
# 1. Scaffold a new entry
node scripts/new-entry.js --id my-skill --name "My Skill" --kind skill \
  --category skills/coding/rust --repo https://github.com/org/repo \
  --tagline "Short summary"

# 2. Edit the generated YAML under data/<category>/<id>.yaml

# 3. Normalize formatting, regenerate artifacts, validate
npm run fmt
npm run validate
npm run export
npm run generate
npm run site

# 4. Run the test suite
npm test
```

Or submit without cloning via the **Add Entry** and **Publish Agent** issue forms
under `.github/ISSUE_TEMPLATE/` — maintainers convert them with
`node scripts/submit-entry.js --issue issue.json`.

## Schema guide (`data/schema.json`, Draft-07)

Required fields on every `data/**/*.yaml` entry:

| Field         | Meaning                                                        |
| :------------ | :------------------------------------------------------------- |
| `id`          | Kebab-case unique id (`^[a-z0-9][a-z0-9-]*$`), e.g. `rust-secure-coding` |
| `name`        | Human-readable display name                                    |
| `repo`        | Upstream `https://` repository URL                             |
| `tagline`     | One-line summary (used in README tables and WebUI cards)       |
| `description` | Longer description (one paragraph or more)                     |
| `kind`        | One of `plugin`, `skill`, `mcp-server`, `design-md`, `prompt`, `agent` (`agent-preset` also accepted) |
| `category`    | Leaf id from `data/taxonomy.json`, e.g. `skills/coding/rust`   |
| `harnesses`   | Non-empty array of harness ids from `data/taxonomy.json` (`opencode`, `claude-code`, `codex`, `gemini-cli`, `cursor`, `windsurf`, `copilot`, `universal`) |

Optional fields: `path`, `npm`, `homepage`, `languages[]`, `platforms[]`,
`tags[]`, `compat`, `scope`, `min_version`, `installation`, `license`,
`source_attribution`, `content_file` (repo-relative markdown bundled into
`dist/content/<id>.md`), `mcp` (`server_name`, `transport`, `command`, `args`,
`url`, `env`, `tools[]` as tool-name strings, `resources[]`), and
`agent_preset` (`mode`, `model`, `prompt`, `skills[]`, `mcp_selections[]`,
`plugins[]`). No other top-level keys are allowed
(`additionalProperties: false`).

Rules:

- `category` must exist in `data/taxonomy.json`. When porting upstream
  headings that do not map cleanly, fall back to `skills/coding/python` or
  `skills/data-ai/agent-orchestration` and note the unmapped heading in
  `docs/NOTES.md` instead of crashing the importer.
- `id` must be globally unique; `(repo, path, kind, id)` tuples must be unique.
- Keep YAML key order as printed by `npm run fmt`:
  `id`, `name`, `repo`, `path`, `npm`, `homepage`, `tagline`, `description`,
  `kind`, `category`, `harnesses`, `languages`, `platforms`, `mcp`,
  `agent_preset`, `content_file`, `tags`, `compat`, `scope`, `min_version`,
  `installation`, `license`, `source_attribution`.

## Category placement

The registry uses two layers (see `data/taxonomy.json`):

1. **Primary hierarchical `category`** — where the entry renders in `README.md`
   and the WebUI category tree (e.g. `skills/cybersecurity/reverse-engineering`).
2. **Facets (`harnesses`, `languages`, `platforms`, `tags`)** — cross-cutting
   WebUI filters (e.g. all `cybersecurity` skills supporting `opencode` + `rust`
   on `linux`).

Pick the most specific leaf category available. MCP servers go under
`mcp-servers/*` with their real exported tool names in `mcp.tools`.

## Deny-first context hygiene

Compiled agent configs deny everything first, then allow specifics — OpenCode
evaluates permission rules in order and **the last matching rule wins**:

1. `{ "action": "skill", "resource": "*", "effect": "deny" }` first,
   then one `allow` per selected skill.
2. One `{ "action": "<normServer>_*", "resource": "*", "effect": "deny" }`
   per known MCP server, then per-tool `allow` rules and explicit tool `deny`
   overrides (denies last so they win).
3. MCP tool names are normalized: every non-alphanumeric run becomes `_`
   (server `postgres-prod` + tool `list-tables` → `postgres_prod_list_tables`).

Never reorder the deny-all rule to the end, and never interpolate untrusted
issue/PR text into shell strings — use `execFileSync(cmd, argsArray)`.

## Attribution & licenses

Every imported entry must preserve upstream licensing in `ATTRIBUTION.md` and
in its own `license` / `source_attribution` fields. See `ATTRIBUTION.md` for
the per-repository ledger (CC0-1.0, MIT, Apache-2.0).

## Checks before opening a PR

```bash
npm run spike
npm run fmt
npm run validate
npm run export
npm run generate
npm run site
npm run health
npm run scout
npm test
```

Every command must exit with code `0`. The PR template
(`.github/PULL_REQUEST_TEMPLATE.md`) lists the same checklist — attach the
command outputs and any `docs/NOTES.md` findings to the PR description.
