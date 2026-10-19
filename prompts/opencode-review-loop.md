# OpenCode Review Loop — PR Review

Use this loop template to review a registry PR with the scoped `catalog-reviewer` agent.

## 1. Collect

```bash
node scripts/ai-review.js collect
npm run validate
```

## 2. Run the rubric

```bash
node scripts/ai-review.js run
```

Check every changed entry against the rubric:

- `category` exists in `data/taxonomy.json` and matches the entry subject.
- `kind` matches the `data/` folder.
- `harnesses` are plausible for the entry type.
- MCP tool names are exact; compiled ids follow `<normServer>_<normTool>` normalization.
- Agent presets compile deny-first (`deny "*"` first, then explicit allows).
- `license` + `source_attribution` credit upstream.

## 3. Selftest

```bash
node scripts/ai-review.js selftest
```

## 4. Apply

Address review findings via PR edits, then re-run:

```bash
node scripts/ai-review.js apply
npm run validate
```

Approve only when validation, rubric review, and selftest all pass.
