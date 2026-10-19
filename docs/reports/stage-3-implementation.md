# Stage 3 Implementation Report — P1 Hardening + Validator Gates

- Stage ID: Stage 3 (Fleet Audit Remediation)
- Date (UTC): 2026-10-19
- Source findings: `AUDIT_REPORT_FINDINGS.md` §§ AB-1.3-untested-invariant,
  AB-1.3-check-pr-scope-bypass, AB-ai-review-no-enforcement,
  AB-7.3-reviewer-dead-allows, AB-5.3-nojekyll-hygiene,
  AB-6.2-engines-eol-floor, AB-7.2-ci-hardening, AB-6.2-deps-placement.

## Summary of deliverables

Fail-closed validator gates: negative fixtures proving dup-id/dup-tuple
rejection (sabotage RED), `check-pr.js` fail-closed on `scripts/**` with a
duplicate-id validator canary (wired into `validate-pr.yml`),
`ai-review.js` machine-enforced rubric (invented tools/harness/kind-folder
fail with `REVIEW FAILED` exit 1), reviewer allowlist fixed to bare tool
names, `_site/` cleaned at build start, engines floor raised to
`>=22.12.0`, all 9 workflows SHA-pinned with minimal scopes +
`CODEOWNERS`, `ajv`/`ajv-formats` moved to devDependencies (validate-time
only, unshipped). 63 entries kept; validate/site/test green (90/90).
Stages 1–2 files untouched.

## Files created / modified

| File | Change |
|------|--------|
| `test/catalog-negative.test.js` | NEW (15 tests): dup-id `/duplicate id/` fixture, dup-tuple `/duplicate/` fixture, canary-healthy assert, `classifyChangedFiles` scope tests (scripts/data/unrelated), fail-closed bad-base-ref test, clean-catalog zero-findings test, evil-tool / unknown-harness / kind-mismatch / unknown-server / deny-first tests, reviewer allow/deny replica tests. |
| `scripts/check-pr.js` | `classifyChangedFiles` (`data/**` + `scripts/**`); scripts-changes → full-catalog validate + `runValidatorCanary`; diff failure → exit 1; test exports. |
| `scripts/ai-review.js` | `auditCatalogEntries` (harness/kind/tools/deny-first) + `REVIEW FAILED` exit 1; `KIND_FOLDERS`; test exports. |
| `scripts/build-site.js` | `rmSync(_site)` at start, fail-closed on error. |
| `package.json` | `engines >=22.12.0`; `ajv`/`ajv-formats` → devDependencies. |
| `.github/workflows/*.yml` (9) | SHA pins, pinned node (`22.23.3` / `24.22.0` matrix), `fetch-depth: 1`, minimal scopes. |
| `.github/CODEOWNERS` | NEW (maintainer review for `*`, `/data/`, `/.github/`, `/scripts/`, `/src/`). |
| `.opencode/agents/catalog-reviewer.md` | Bare `read`/`glob`/`grep` allows. |
| `REMEDIATION_LOG.md` | Stage 3 section appended. |

Explicitly NOT edited (Stages 1–2 / later stages): `src/server/local-server.js`,
`test/local-server.test.js`, `src/core/compiler.js` + `src/core/importer.js`
hyphen logic, `data/**/*.yaml` tools/repos, `src/mcp/server.js` content
handling, `data/schema.json` content_file/synthetic, `site/app.js` (AB-5.2),
`scripts/import/seed-all.js` (stale-seed residual).

## Test results

```
$ npm run validate
VALIDATED 63 ENTRIES OK
$ npm run site
SITE_BUILT _site/ with 63 registry entries
$ npm test
ℹ tests 90 / suites 31 / pass 90 / fail 0
$ node scripts/ai-review.js run
REVIEW_OK entries=63 categories=56 mcp_tools=25 (exit 0)
$ <evil totally-invented-tool-xyz in-memory probe>
data/agents/security-auditors/db-security-auditor.yaml: invented tool 'totally-invented-tool-xyz' ... / REVIEW FAILED: 1 rubric violation(s) (exit 1)
$ npm pack --dry-run → 15 files, no scripts/ (ajv move ships nothing)
```

Sabotage (backup/restore, all RED then GREEN): dup-id check → `if(false)`
→ 13/2; ai-review tool loop → `if(false)` → 14/1; check-pr classify →
data-only → 14/1; `.nojekyll` write removed + clean build → 9/1;
restored → 90/0.

## Self-audit notes

- Fail-closed everywhere: unknown harness/kind/server/tool → finding, never
  silent; undiffable base → exit 1; unremovable `_site/` → abort; neutered
  validator → canary RED on any `scripts/**` PR.
- `generate-readme.yml` keeps `contents: write` (minimum for auto-commit);
  all other workflows are `contents: read`; `site.yml` adds only
  `pages`+`id-token: write` (Pages deploy requirement).
- `ajv` move is safe: zero `require('ajv')` hits in `src/`/`bin/`; tarball
  file list confirms `scripts/` never ships.
- Residual: reviewer rubric line 4 still documents pre-Stage-2
  underscore normalization (`postgres_prod_list_tables`); enforcement code
  is correct (hyphens preserved). Prose fix deferred as follow-up.
- No publish/push/secrets; sabotage used `cp` backup/restore (working tree
  holds uncommitted Stages 1–3 work — no `git stash`); `/tmp` probes only.
