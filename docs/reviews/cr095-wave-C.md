# CR-095 end-of-wave review, part C: knowledge, graph, infra

Repo `F:\workspace\evolu-platform`, branch `platform/gd0`, range `05ccd514..HEAD` (54 commits, 419 files). Read-only review; only this file was written.
Scope: G1 (graph tables, RLS, indexes, port, MCP tools), R1 (perf design, ingest, producers, KH federation, eval), infra (evotest, slice, hooks, F1 frozen gate, pins).
HEAD at review time: `88f70a73`. Local bun is 1.4.3 (repo pins 1.3.14), so results below carry that caveat.

## 1. Gate results on HEAD (local)

| Gate | Result | Notes |
|---|---|---|
| `bun run typecheck` | RED (env + code) | `turbo` stops at `@ai/agent-runtime` (no `docker` on PATH, environment). Re-run with `--filter=!@ai/agent-runtime --continue` plus `tsc -p tsconfig.tests.json`: see table 1a. |
| `bun run depcruise` | RED, 6 + 14 + 10 + 9 + 10 violations over 5 passes, 25 distinct | table 1b |
| `bun run check:fn` | RED, 92 functions over limit | table 1c |

Caveat that affects 1a and 1b: local `node_modules` is stale. `ioredis` (admin-api), `@anthropic-ai/sdk` and `unpdf` (hub-api) are declared in `package.json` and `bun.lock` but are not installed here, so every "cannot find module / not-to-unresolvable" line is environment, not code. A `bun install --frozen-lockfile` is needed before these gates mean anything; I did not run it because it mutates the shared tree.

### 1a. Typecheck errors (real ones, with owner)

| Error | File:line | Owner |
|---|---|---|
| TS2339 `n` on `{n:number}\|undefined` x5 | `tests/acceptance/W1/sourcing.int.test.ts:128,222,241,252,285` | W1 |
| TS2339 same, x1 | `tests/acceptance/W1/mywork.int.test.ts:487` | W1 |
| TS2769 `never[]` vs `RowList` x2, TS2339 x1 | `tests/acceptance/W1B/send.int.test.ts:108,177,140` | W1b |
| TS2322 `string\|undefined` not assignable to `null\|undefined` | `e2e/contracts-web/hd5-list.cw.ts:61` | HD5 (last touched `b52d9a66`) |
| TS2307 ioredis (x2), TS7006 `err` | `apps/admin-api/src/lib/redis.ts:3`, `.../auth/limit/limit.redis.ts:4`, `src/server.ts:49` | L1, environment (dep not installed) |
| TS2307 `@anthropic-ai/sdk`, TS7006 `b` | `apps/hub-api/src/lib/ai-client/anthropic.provider.ts:4,47` | M3, environment |
| TS2307 `unpdf` | `apps/hub-api/src/modules/packs/kit/adapters/pdf/convert.ts:3` | R1, environment |

No type error in any G1/R1 knowledge file.

### 1b. depcruise violations (distinct)

| Rule | Edge | Owner |
|---|---|---|
| ca-domain-builtin-only | `hub-api/.../knowledge/domain/graph.rules.ts:4-11` imports `../application/graph.ports` (the check requested; **still red**, see F-01) | G1 |
| rules-must-be-pure | `tools/scripts/src/frozen.rules.ts:4` imports `bun` | F1 |
| rules-must-be-pure + ca-domain-builtin-only | `admin-api/.../mgmt-import/domain/ids.rules.ts` imports `crypto` | I1 |
| rules-must-be-pure | `admin-api/.../auth/limit/limit.rules.ts` imports `crypto` | L1 |
| no-circular | `mgmt-import/application/import.usecase.ts` <-> `reconcile.ts` | I1 |
| ca-domain-builtin-only | `packs/contracts/domain/sourcing.rules.ts`, `mywork.rules.ts` -> `packages/contracts/src/index.ts` | W1 |
| ca-application-inward-only | `packs/contracts/application/{sourcing,mywork,ledger,followups}.usecase.ts`, `ledger.ports.ts` -> `packages/contracts/src/index.ts` | W1 (ledger.*, followups.*: W1 / W1b) |
| component-no-fetch | contracts-web `sourcing/components/{SaleLines,ContractSourcing}.tsx`, `mywork/components/WorkActions.tsx` (2 edges), `contract-deadline/components/DeadlinePanel.tsx` | W1 (DeadlinePanel: HD4) |
| not-to-unresolvable | ioredis (L1), `@anthropic-ai/sdk` (M3), `unpdf` (R1) | environment |

### 1c. check:fn (92 total)

Knowledge/G1/R1: 15 (worst: `adapters/graph.repo.ts:41 graphRepo` 198 lines; `graph.usecases.ts:60 graphUsecases` 77 lines; `knowledge.tools.ts:33` 82 lines; `knowledge.repo.ts:53` 67 lines; `knowledge.usecases.ts:122 askSources` and `:141 rerankOrKeep` 5 params; `graph.producers.ts:141` 5 params; 7 test `describe` blocks 54-66 lines). Owners G1 (graph.*) and R1 (the rest).
Other owners: I1 17 (`mgmt-import`, `identity-import`), L1 3, contracts/W1/W1b/HD 48, other 9 (`test-kit`, `processes`, `seed.test`, `dify-agent-runner`, `admin-web/errors.test`, `admin-api/errors.ts`, ...). Full list: re-run `bun run check:fn`.

## 2. Findings

Severity: High = wrong result or broken gate, fix before merge to `main`; Medium = real risk, fix this wave or log in TECH-DEBT with owner; Low = polish.

### High

**F-01 G1 domain still imports application** (owner G1). `apps/hub-api/src/modules/knowledge/domain/graph.rules.ts:4-11` imports the types `CorpusRow, Graph, GraphLink, GraphNode, NbRow, NbRowKind` from `../application/graph.ports`. depcruise `ca-domain-builtin-only` is red on HEAD. Type-only import, but the rule is about direction. Fix: move those six types (they are pure data shapes) into `domain/graph.types.ts`, have `graph.ports.ts` re-export or import them from the domain. Not done in the 54 commits.

**F-02 `run-tests.ps1 -Dirty` omits staged changes** (owner infra / TS1). `deploy/evotest/run-tests.ps1:27` builds the overlay from `git ls-files -m -o --exclude-standard`. `-m` compares working tree to the index, so a file that is staged and not touched afterwards is not listed, and a newly added staged file is not "other" either. The server then tests `HEAD` for those files and returns a false green. This is the normal state right before `git commit`. Fix: `git diff --name-only --diff-filter=ACMRD HEAD` (covers staged and unstaged, deletions via `D`) plus `ls-files -o --exclude-standard`. Also decode names as UTF-8 (`-c core.quotepath=off` is set, but PS 5.1 console decoding can still mangle non-ASCII paths and `Test-Path` false then silently drops the file at line 30-31).

### Medium

**F-03 df trigger: delete path has no defined lock order** (owner R1). `packages/db/migrations-pack-knowledge/0004_r1_lexemes_role.sql:34-41` (`lexemes_sub`). The insert path takes row locks in `(tenant_id, lexeme)` order (`ORDER BY` feeding `INSERT .. ON CONFLICT`, line 24-30), which is the right idea. The delete path does `UPDATE lexemes l .. FROM (subquery ORDER BY ..) o WHERE ..`; an `ORDER BY` in a joined subquery does not define the order in which the UPDATE locks target rows (hash/merge join order). Two concurrent deletes (or one delete and one insert) on the same tenant that share lexemes can deadlock. No test exercises concurrency: `tests/acceptance/R1/search-definer.int.test.ts:97` only covers a single cascade delete. Fix: first `SELECT 1 FROM knowledge.lexemes WHERE (tenant_id, lexeme) IN (..) ORDER BY tenant_id, lexeme FOR UPDATE` in the same function (or a per-tenant `pg_advisory_xact_lock`), then the UPDATE. Add an int test with two parallel transactions (insert vs delete, delete vs delete) that must both commit.

**F-04 df correctness gaps** (owner R1). Same file. (a) No `UPDATE`/`TRUNCATE` handling: fine today because no code updates `chunks.tsv` (`knowledge.repo.ts` has only inserts), but one future `UPDATE chunks SET body` silently skews df/IDF; add a comment plus a guard test (`tsv` is generated? if so, add a `BEFORE UPDATE OF tsv` trigger that raises). (b) Rows with `df = 0` are never deleted, so churn grows `lexemes` without bound (index bloat on the hot search path); add a periodic `DELETE .. WHERE df = 0` or delete in `lexemes_sub`. (c) Hot-row contention: every statement that inserts chunks for a tenant updates the same common-lexeme rows, so concurrent ingest into one tenant serialises until commit. Acceptable for the CLI-only ingest today (see F-07); note it before exposing ingest over HTTP.

**F-05 Content limit mismatch makes large PDF/DOCX fail** (owner R1). `domain/knowledge.rules.ts:9` `contentMax: 500_000` chars, while `pdf.rules.ts:8-10` allows 5,000,000 chars and `docx.rules.ts:11` `DOCX_MAX_MD = 5_000_000`. A 300-page text PDF (~1 M chars) is converted fine, then `addDocument` returns `CONTENT_TOO_LARGE` (`ingest.usecases.ts:90` forwards it; the code is also missing from `IngestError`, line 9-18). Fix: either align the limits (cap the converters at the knowledge limit and return the existing `truncated` warning) or split a large document into parts. Add a test with a >500k-char input.

**F-06 Ingest is not atomic and a failed graph is never repaired** (owner R1). `ingest.usecases.ts:83-97`: `add` commits the document and chunks, then `produce` runs in later transactions; every producer step swallows errors (`graph.producers.ts:149-152`). A crash or LLM outage leaves a searchable document with no graph; re-ingesting returns `duplicate: true` and `graph: null` (line 93), so the graph is never built. Fix: on `duplicate`, run the producers when the document has no `chunk_entities` yet (or add a `graph_state` column), and surface `graph.failedSteps` in `GraphReport`. Also `graph.producers.ts:136` reports `similar` as `pairs.length` and `conflicts` as `rows.length - pairs.length` even when `addLinks` failed at line 135.

**F-07 LLM calls bypass the shared AI client, usage ledger and token caps** (owner R1, with M3). `adapters/ai.adapters.ts:73-138` (`claudeText`, `claudeReranker`) and `graph-ai.adapters.ts` call `api.anthropic.com` with raw `fetch` and the env key. M3 added `lib/ai-client` (per-tenant usage into `hub.usage_logs`, token ceilings) in the same wave; the header comment `graph-ai.adapters.ts:2` ("M3 chua co client AI dung chung") is now stale. Ingest of a large tenant folder, and every `knowledge-search` with `KNOWLEDGE_RERANK=on`, are therefore unmetered and uncapped per tenant (tenant document text also leaves the platform with no ledger entry). Fix: route both through the M3 client with the tenant id.

**F-08 Alias linking loops over the network** (owner R1). `graph.producers.ts:93-105`: the loop is bounded only by `linked >= aliasMax`, so non-matching or LLM-rejected candidates are unbounded; each iteration does `hasAlias` (1 SQL) and `sameEntity` (1 LLM call) sequentially, up to `chunks x 40` entities. Luật 4c says no network or per-row SQL in a row loop. Also `cands.find` is O(n*m). Fix: batch `hasAlias` for all (key, candidate) pairs in one statement, cap attempts (not only successes), index candidates by `type + aliasForm` in a Map, run LLM confirmations with the same bounded concurrency as `extractAll`.

**F-09 KH federation couples local latency to the slowest source** (owner R1). `application/knowledge.usecases.ts:172-175`: `Promise.all([local, askSources])` returns only when KH answers or times out (`KNOWLEDGE_KH_TIMEOUT_MS`, default 3000, up to 30000). A slow or down KH adds up to that timeout to every search for allowed tenants; there is no circuit breaker, so a dead KH costs the full timeout each time, against the N4-NFR-01 p95 target (50 ms). Failure fallback itself is correct (`Promise.allSettled`, `knowledge.usecases.ts:130`, covered by `federation.int.test.ts:110`). Fix: shorter default budget for federation (for example 800 ms) and a small breaker (skip KH for N seconds after K consecutive failures), or return local results and merge KH only when it answered inside the budget.

**F-10 `corpus` and `neighbourhood` are unbounded** (owner G1). `adapters/graph.repo.ts:181-204`: the `shares` CTE self-joins `de x de` on `entity_id`; an entity mentioned by 5,000 documents produces ~12.5 M pairs before `limit`. `node`, `pair` and `link` rows have no limit at all (the `limit` parameter only caps `sh`). `graph.sql.ts:8-40` (`nbSql`) returns every mention, relation and alias of every entity in the document, so one popular entity expands the result without bound, and it is served through the MCP tool `knowledge-graph` (`graph.tools.ts:42-52`) straight into the agent context. The G1 perf test measured 10k docs / 100k chunks with a synthetic distribution (p95 4.2 ms), not a skewed one. Fix: cap per-entity fan-out in SQL (`LATERAL .. LIMIT`), cap node/pair/link rows, truncate in `nbSql`, and add a skewed-distribution perf case.

**F-11 Stale-lock hang in the evotest queue** (owner infra). `deploy/evotest/run-tests.ps1:46` and `mgmt/run.ps1:22`: `until mkdir .lock; sleep 5` waits forever, with no stale-lock detection (a `kill -9`, host reboot or killed ssh leaves `.lock` and every later run, including `nightly.ps1`, hangs silently). Waiters are not FIFO (random winner, possible starvation). Fix: write PID/time into `.lock/owner`, treat the lock stale when the PID is gone or older than N hours, add a max wait (exit 3, which the header at `run-tests.ps1:4` and `nightly.ps1:22` already promise but the script never returns).

**F-12 Frozen suites are never run by anything scheduled** (owner infra / F1). `nightly.ps1:12` runs `-Step all` without `-All`, so `test:all --no-frozen` is the only automatic run; `test:affected` also drops frozen suites (`test-affected.ts:144-149`). The comment calls the full run "monthly" but no job exists (`deploy.md` and `modules.md` say "monthly upgrade" only). Shared code (`packages/db` migrations, auth, `lib/*`) changes can therefore break frozen modules (`processes`, `rooms`, `kh`, `dlc`, `workflows`) for weeks unnoticed. Fix: a monthly (or weekly) `nightly.ps1 -All` task, and have `test:affected` print a note when a changed file lies in `packages/db`, `packages/contracts` or `lib/` and frozen suites exist (they import the same code).

**F-13 `frozen.rules.ts` breaks the rules-must-be-pure gate** (owner F1). `tools/scripts/src/frozen.rules.ts:4` imports `Glob` from `bun`. Fix: keep the rules file pure (export the pattern strings and a tiny matcher), construct `Bun.Glob` in `test-affected.ts` / `test-frozen.ts` / `test-int-par.ts`, or add an allowlist entry for `tools/scripts` rules (the same pattern already exists for other script rules; check).

**F-14 `slice:merge` can merge untested code and leave the main checkout conflicted** (owner infra). `tools/scripts/src/slice.ts:74-86`: tests run after the rebase, then `merge --ff-only` and, if the base moved in between (parallel slices), falls back to `merge --no-edit` (line 84) which creates an unreviewed, untested merge commit; on conflict it leaves `MERGING` state in the main checkout with no `merge --abort` (line 85 just fails). Also `test:affected` runs locally here although Luật 0b says tests run on the server. Fix: if `ff-only` fails, re-run rebase + `test:affected` (loop once), never create a merge commit; on failure run `git merge --abort`. No test file exists for `slice.ts` or `setup-hooks.ts` (Luật 4b); a unit test for the argument/path logic and the `mainRoot` resolution would be cheap.

**F-15 pre-commit hook fails open** (owner infra). `tools/hooks/pre-commit:12-13`: if `node_modules/.bin/lefthook` is missing (fresh worktree before `bun install`, or install failed) the hook prints a warning and exits 0, so unformatted or oversized files can be committed. Fix: exit 1 with the message (the escape hatch `LEFTHOOK=0` already exists at line 5), or run `bunx biome` directly as fallback. (Portability itself is fine: relative `core.hooksPath`, `git rev-parse --show-toplevel`, mode 100755 in the index, LF forced by `.gitattributes`.)

### Low

**F-16 Gate performance** (owner infra / TS1). `tools/scripts/src/test-affected.ts:144-145`: `ignorer(root, "bunfig.toml")` is called inside the per-file callback, so the bunfig is re-read and every glob recompiled for each file in the graph (hundreds to thousands of times). Hoist both `ignorer` calls out of the arrow functions.

**F-17 `unpdf` / pdf.js hardening** (owner R1). `pdf/convert.ts:19-24` sets four options but not `isEvalSupported: false` (pdf.js default uses `new Function` for some font programs) nor a worker heap limit; the 30 s timeout and 500-page cap bound CPU but not memory, and a single large decompressed page can use hundreds of MB inside the hub-api process (Bun Worker shares the process). Set `isEvalSupported: false`, `maxImageSize`, and consider running the worker with `resourceLimits` if Bun supports it. `PdfQueue` duplicates `DocxQueue` (acknowledged in the file header; keep the TECH-DEBT entry).

**F-18 Re-ingest by `uri` does not replace** (owner R1). `documents_uri_idx` (`0003_graph.sql:111`) is non-unique and `knowledge.repo.ts:72` only inserts; changed content with the same `uri` creates a second live document, so old and new versions both rank in search and in the graph. The `attach` comment at `graph.repo.ts:46` ("upsert_document xoa doan cu") describes behaviour that does not exist in this repo, and the `delete from chunk_entities` before it (lines 47-49) is therefore dead code for fresh documents. Decide: replace by `(tenant_id, uri)` or document that versions accumulate.

**F-19 `similarDocuments` ordering** (owner G1). `graph.repo.ts:162` `order by l.kind desc` puts SIMILAR before CONFLICTS (alphabetical), whereas `conflicts()` (line 220) puts CONFLICTS first explicitly. If the tool is used to surface contradictions under `limit`, SIMILAR rows can crowd CONFLICTS out. Confirm intent against mgmt-app `/documents/{id}/similar`, make it explicit with a `CASE`.

**F-20 Eval harness** (owner R1). `eval/n4-knowledge/judge.ts`: correctness 0.944 on 90/90 questions comes from `judgments.offline.json`, scored by Claude (the same model family that built the system) and keyed by top-5 signature, over a 118-chunk corpus; embedding and rerank variants still say "waiting for key" (`results/embedding.json`, `fts+rerank.json`), so the R1 claim "ranking unchanged" is only evidenced for FTS and the p95 of 3.9 ms is for the tiny corpus (the 10k-chunk number lives in the perf test). No regression gate: nothing fails when R@k or correctness drops. Also `claudeJudge` line 85 `JSON.parse` throws on malformed model output. Add a threshold test on `results/fts.json` (for example R@5 >= 0.93) and wrap the parse.

**F-21 Windows-PowerShell encoding** (owner infra). `nightly.ps1`, `run-tests.ps1`, `mgmt/run.ps1` have no BOM but contain Vietnamese string literals; under Windows PowerShell 5.1 they are read as ANSI, so the status line written to `nightly-<date>.md` (`nightly.ps1:22`) and the "dang ban" message are mojibake. Cosmetic, but `nightly.ps1` is the file humans read in the morning. Save with BOM or use ASCII in strings.

**F-22 Misc infra** (owner infra): `run-tests.ps1:46` embeds `$Filter` inside single quotes in the remote command (a `'` in the filter breaks or injects; local operator only). `mgmt/run.ps1:22` leaves `/tmp/remote-mgmt-*.sh` and tarballs on the server when ssh fails before cleanup. `mgmt/remote.sh:35-37` passes the Neo4j password as `SEED_PASSWORD` via `exec -e` (visible in `ps` on a shared host; test-only, ephemeral). `oven/bun:1.3.14` and Playwright base images are pinned by tag, not digest, and `apt-get install git` is unpinned (`Dockerfile:4,9`). Local dev bun is 1.4.3 while `packageManager`, `ci.yml:59`, `Dockerfile` and `bun.lock` assume 1.3.14, so local results can differ from CI; add a `bun --version` check to `setup-hooks.ts`.

## 3. Checked and found sound

- G1 tables (`0003_graph.sql`): every PK/index starts with `tenant_id`; both directions are indexed for every edge table (`entity_aliases_b_idx`, `entity_rels_dst_idx`, `chunk_links_dst_idx` + src/dst doc indexes, `document_links_dst_idx`, `chunk_entities_entity_idx`); composite FKs `(id, tenant_id)` make cross-tenant edges impossible; `ON DELETE CASCADE` / `SET NULL (evidence_chunk_id)` correct; `a_id < b_id` check normalises aliases; all six tables go through `packs.secure_table` (RLS FORCE). `tests/acceptance/G1/rls.int.test.ts` and `graph.int.test.ts:256-280` cover isolation; `graph.int.test.ts:281` pins statement counts.
- G1 SQL: constant statements, lists passed as one `jsonb` parameter, explicit `tenant_id` on every predicate, ordered upserts (`order by x.key`, `order by a.id, r.type, b.id`) so concurrent `attach` calls lock in a consistent order; identifiers validated before any transaction (`graph.usecases.ts:31-58`).
- MCP tools (`graph.tools.ts`): `read` action, no side effect, tenant and user come from the tool context, not the arguments; invalid ids return an empty result (same as unknown id).
- `search_idf` definer design (`0004`): tenant never a parameter, read from `app.tenant_id`, fails closed with 42501, pinned `search_path`, EXECUTE only for `knowledge_rw`, dedicated NOLOGIN role; `knowledge_api` can only `SET ROLE knowledge_rw`; dev password migration lives in `migrations-hub-dev`, skipped when `appEnv === "production"` (`migrate-hub.ts:68`). One thing to verify in production: `ALTER FUNCTION .. OWNER TO knowledge_search` (line 148) needs the new owner to hold `CREATE` on schema `knowledge` unless the migrating role is superuser; it works in dev/test, confirm with the production migration role.
- Insert-side df trigger: statement-level with transition tables, deterministic lock order, `df` added atomically; backfill is one statement; cascade-delete path tested (`search-definer.int.test.ts:97`).
- Workers: size, page, unzip, ratio and depth limits exist (`pdf.rules.ts`, `docx.rules.ts`), per-tenant one-waiting rule, `terminate()` on timeout and crash, tenant isolation of results; `NEEDS_OCR` decided on median page text (`isScanned`), covered in `ingest.int.test.ts:79`. CLI-only entry point (`knowledge-ingest.ts`), no HTTP route, so no unauthenticated upload surface.
- KH: off unless URL+key+project set, per-tenant allowlist (default none), key only in the header, `redirect:"error"`, 1 MiB body cap, hits validated and capped (`federation.rules.ts`), failure and non-allowed paths tested.
- Pins: Postgres `16.15-alpine`, Redis `7.4.11-alpine` identical in `compose.yaml`, `deploy/staging`, `deploy/evotest`, `deploy/evotest/mgmt`, `ci.yml`; Bun 1.3.14 in `package.json`, `ci.yml`, `Dockerfile`; Playwright image 1.63.0 = `@playwright/test` 1.63.0; `unpdf` 1.8.1 and `@anthropic-ai/sdk` 0.135.0 exact versions with lock entries; OpenSearch 2.19.0 and Neo4j 5.26.30 pinned in the mgmt copy, which uses its own compose project, tmpfs data, no published ports and does not touch `sohoptac-*`.
- Frozen gate: `test:affected`, `test:frozen`, `--no-frozen` (unit via generated bunfig, int, e2e) are consistent with each other; the list is in one file (`frozen.rules.ts`) with a unit test.

## 4. Owners, by fix

| Owner | Findings |
|---|---|
| G1 | F-01, F-10 (neighbourhood/corpus), F-19 |
| R1 | F-03, F-04, F-05, F-06, F-07 (with M3), F-08, F-09, F-17, F-18, F-20 |
| Infra (TS1/F1) | F-02, F-11, F-12, F-13, F-14, F-15, F-16, F-21, F-22 |
| Other waves (from gates, not part of C) | typecheck: W1, W1b, HD5; depcruise: I1, L1, W1; check:fn: I1 17, L1 3, contracts 48, other 9 |

Counts: High 2, Medium 13, Low 7 (22 findings).

## Verdict

**CHANGES_REQUESTED.** G1 and the R1 search design are well built (indexes, RLS, definer function, constant SQL), but the explicitly requested fix check fails (F-01, depcruise still red on `graph.rules.ts`), the `-Dirty` evotest path can report false green on staged work (F-02), and the df trigger's delete path and the ingest limits/atomicity need fixes before R1 is called done. Re-review needs: F-01, F-02, F-03, F-05, F-06 fixed with tests, and a clean `bun install --frozen-lockfile` re-run of typecheck and depcruise to separate environment noise from real violations.
