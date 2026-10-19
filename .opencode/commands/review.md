# /review — Catalog PR Review

Invoke the scoped `catalog-reviewer` subagent to review the current PR or scout batch.

## Steps

1. Collect the review set:
   ```bash
   node scripts/ai-review.js collect
   ```
2. Validate and run the rubric:
   ```bash
   npm run validate
   node scripts/ai-review.js run
   ```
3. Delegate the file-by-file review to the `catalog-reviewer` agent (`mode: subagent`, deny-first permissions). The reviewer checks category placement, kind/folder match, harness compatibility, MCP tool names, deny-first scoping, and license/attribution per `.opencode/agents/catalog-reviewer.md`.
4. Confirm the selftest before approving:
   ```bash
   node scripts/ai-review.js selftest
   ```
5. Apply or request fixes via PR edits (never commit secrets; never interpolate untrusted issue text into shell strings — use `execFileSync` argv arrays only).
