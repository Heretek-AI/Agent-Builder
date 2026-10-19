# OpenCode Standalone Loop — Scout Candidate Evaluation

Use this loop template to evaluate a scout discovery batch without a PR context.

## 1. Scout (offline-first)

```bash
node scripts/scout.js run --dry-run --limit 20
```

Review each `CANDIDATE` line. Drop any repo listed in `discovery/declined.txt`.

## 2. Triage

```bash
node scripts/triage.js --dry-run
```

Confirm the routing labels (`plugins`, `skills`, `mcp-servers`, `design-md`, `prompts`, `agents`) match the candidate kinds.

## 3. Accept (dry-run first)

```bash
node scripts/scout.js accept --issue <n> --dry-run
```

Verify the issue number, then convert accepted candidates with:

```bash
node scripts/submit-entry.js --issue <file.json> --dry-run
```

## 4. Review & selftest

```bash
node scripts/ai-review.js run
node scripts/ai-review.js selftest
```

Only after all four stages pass should candidates be written to `data/**/*.yaml` and submitted as a PR.
