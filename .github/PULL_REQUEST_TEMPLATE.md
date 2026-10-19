# Pull Request Checklist

Thanks for contributing to the Agent-Builder registry! Please confirm all of the following before requesting review.

## Validation

- [ ] `npm run validate` passes (`VALIDATED <N> ENTRIES OK`, exit `0`).
- [ ] `npm run export` passes and `dist/registry.json` is regenerated when `data/` changed.
- [ ] `npm run generate` passes and `README.md` includes the new/changed entries.
- [ ] `npm run site` builds cleanly (when WebUI or registry output changed).
- [ ] `npm test` passes with no failures.

## Entry quality

- [ ] `category` matches a leaf id in `data/taxonomy.json` (no invented categories).
- [ ] `kind` matches the `data/` folder (`plugin` -> `data/plugins/`, `skill` -> `data/skills/`, `mcp-server` -> `data/mcp-servers/`, `design-md` -> `data/design-md/`, `prompt` -> `data/prompts/`, `agent` -> `data/agents/`).
- [ ] `harnesses` lists every supported harness (`opencode`, `claude-code`, `codex`, `gemini-cli`, `cursor`, `windsurf`, `copilot`, `universal`).
- [ ] `repo` is an `https://` URL; `tagline`/`description` are original summaries (no pasted secrets or keys).

## License & attribution

- [ ] `license` uses the correct upstream SPDX identifier and `source_attribution` credits the upstream repo.
- [ ] `ATTRIBUTION.md` updated when importing from a new upstream source.

## Agent presets (deny-first context hygiene)

- [ ] Agent presets use deny-first scoping (`deny "*"` first, then explicit `allow` rules) in the compiled output.
- [ ] MCP tool names use normalized `<server>_<tool>` ids (non-alphanumerics mapped to `_`).

## Notes for reviewers

<!-- Link related issues (e.g. "Closes #123"), scout batch ids, or `ai-review` output here. -->
