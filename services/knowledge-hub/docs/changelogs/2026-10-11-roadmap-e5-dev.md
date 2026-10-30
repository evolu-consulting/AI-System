# 2026-10-11 Roadmap E-5, slice S15: dev integration on kh-dev-f (design section 10)

This run covers every step of `docs/roadmap-e-to-5-design.md` section 10 on the Docker dev KH `kh-dev-f`
(port 9102, HANA Express schema `KH_STAGEF`, Chroma on the volume `kh-dev-f-data`). It ran autonomously. It
stayed on dev only: no call reached BTP, the prod Keycloak or HANA Cloud. The steps that need prod were skipped,
and each one is listed with its reason below.

The run found 11 bugs. All of them are fixed, and each fix has a regression test that fails without it. Two of
the bugs would have broken the switch-on:
- The worker could never record its cost, so it could not run `on`.
- The 50/50 trial did not withhold anything.

The driver is `tools/kh_bench/scripts/devcheck_e5.py`, which has these subcommands:
- `up` and `health`
- `seed` and `pour`
- `worker`, `budget429` and `approve`
- `leaks`, `trial`, `crons`, `redteam` and `tier1`

## Result per step

| # | Step (section 10) | Result | Numbers |
|---|---|---|---|
| 1 | Container `kh-dev:e5`, section 10 flags | PASS | health 200. `/v1/capabilities` lists 19 modules, including people, daily, outcomes, learn and improve 1.0.0. `tools/stagef/smoke.py` passed in full. |
| 2 | Suites | PASS (2 known flakes, see open issues) | **HANA** (`KH_TEST_HANA=1`, schema `KH_E5_TEST`): the 22 files that support it (`tests/caps/*`, `test_stage_f1`) pass. After the fixes, the 8 affected files were run again on HANA and pass. **SQLite**: every `tests/test_*.py` and `tests/caps/test_*.py` passes, except `test_project_match_weak` (a GAP case it already reports, unchanged by this slice). **Worker**: `worker/tests` 67 passed. |
| 3 | Data and replay | PASS (seeded copy only) | 4,770 rows of 8 projects seeded. Real logs were poured into 4 new projects, one per use case. `replay.py` gives the same result on the new project and on its source: baseline 9.36 against 9.35 repeats per 100 eligible steps. |
| 4 | Worker E | PASS | **Dry** (in the `kh-worker:e5` container): 2 projects for distil and 6 days for daily. 0 writes, cursors unmoved. **429 budget**: given to the worker on both routes once the KH cap is below the spend. **On** (`claude_cli`): 58 items written, the run cap stopped the run at $0.658, 10 items approved, and 5 of 5 keyed items were served by key. `worker.cost_usd` differs from the CLI usage by 0.001%. |
| 5 | G5 leak set distilled live | PASS | 52 planted strings, 30 logs, 30 items distilled live by `claude_cli`: **0 hits** |
| 6 | G3 / G4 against a flags-off twin | G3 FAIL (expected before the backfill), G4 inconclusive | G3: 13 of 42 answered (31.0%), the same with flags on and off. G4: `/context/step` p95 passes twice. `/turn/context` p95 failed once (+6.7%) and passed once (-10%). The hook overhead was not measured. |
| 7 | Phase 3 trial, 2 x 80 sessions | PASS | Arm split 51.2% and 50.0%. Neutral lesson: **accept** (lower bound -0.042). Harmful lesson: **withdraw** (p = 0.009). Too-small lesson: **continue**. All decisions have `applied: false` (mode `trial`). |
| 8 | G2 rehearsal | PARTIAL | 29 manual items against 14 worker items (same first m360 batch). Leaks 0 and 0, schema rejects 0% and 0%. The keep-rate needs fen's blind review: the sheet is written. |
| 9 | Phase 4 runner | PASS (dry) | Stop drill run 6 times: 423 within 0.09-0.14 s, writable again 0.03-0.05 s after resume, 41-51 responses 428 until approved. Scorecard: 10 of 10 chains unattended, 12.5 interventions per 100 tasks, 0 sev-1. |
| 10 | Phase 5 shadow | PASS | Red team: **37 of 37** caught over HTTP. The `KH_STEP_FLOOR` 0.68 -> 0.70 proposal was measured by the bench hook, and KH recorded "reject, bench_regression". No override was applied. |
| 11 | G10 | tier 1 PASS, tier 2 skipped (prod) | Tier 1, flags on against off: coverage 0.9333 on both, recall 0.6429 on both, 368,357 bytes on both |

Real LLM spend came only from the worker's `claude_cli` adapter (`claude-opus-5-5`), under a $1 run cap and a $5
month cap:

| Run | Spend |
|---|---|
| Interrupted by bug 6 (not recorded) | $0.124 |
| Leak set | $0.195 |
| e5-distil | $0.658 |
| G2 rehearsal on m360 | $0.196 |
| **Total** | **$1.17** |

KH recorded $1.049 of it, which is everything after the fix.

## How each step ran

### 1. Container

`devcheck_e5.py up` (re)creates the container from `kh-dev:e5`:
- It reads the HANA credentials and the non-secret stage F settings of the existing container from `docker
  inspect` and passes them through. It never prints them.
- It generates a fresh dev bootstrap token and a fresh Ed25519 `KH_PRINCIPAL_SIGNING_KEY` in memory on every
  `up`. The secrets reach `docker run` as `-e NAME` from the child environment, so they never appear on a command
  line and never touch the disk.
- **The signing key of the old stage F container is rotated.** Note: early in this session one tool output in the
  agent transcript showed part of the old PEM key, because a redaction filter missed the continuation line. That
  key is no longer used by any container. Every later environment read went through Python with full redaction.
- It refuses a HANA Cloud host, the schema `KNOWLEDGE_HUB` and CF variables.

The final container has these flags:
- `KH_CAP_{PEOPLE,DAILY,OUTCOMES,LEARN,IMPROVE}=on`
- `KH_DISTILL_WORKER=dry`
- `KH_LEARN_MODE=record`
- `KH_IMPROVE_MODE=shadow`
- `KH_STEP_DAILY=1`
- `KH_WORKER_CAP_MONTH_USD=5`
- `KH_DISTILL_PROJECTS=m360,zeus-adm,e5-distil,e5-distil2,kh-leaktest,e5-trial`

### 3. Data, without reading prod

`seed_docker_dev.py` reads prod through the kh-helper session, so it was **not run**, and neither was
`replay.py --snapshot`. The dev copy came from the Chroma volume of `kh-dev-hana` instead. That volume holds
`seed_docker_dev`'s copy of prod from 2026-10-10:
1. The volume was copied read-only into a temporary volume. `kh-dev-hana` itself was not touched.
2. The copy was dumped to NDJSON in a throwaway container.
3. The rows were written into 9102 through `POST /vector/add`, and dev re-embedded them.

The seed covered 4,770 rows of these projects: lesson-learned, m360, simplemdg-2.0, simplemdg-support,
simplemdg-ticketing, solace-buzz and zeus-adm. Every project and scope was read back complete, except
orchestrator. Orchestrator already had 9 rows from stage F, so the "already seeded" rule skipped it; it is not a
bench project. The dump and the temporary volume were deleted afterwards.

**New projects, real logs poured in gradually per use case** (`devcheck_e5.py pour`). The logs of a source
project go in, in time order, with their `ts` compressed into a recent window. Order is kept, the source ts is
kept in `orig_ts`, and the session is a pseudonymous author-day hash.

| Use case | New project | Source logs | Window | Waves |
|---|---|---|---|---|
| Worker distil | e5-distil | 46 of m360 | 14 days | 3 |
| Worker distil | e5-distil2 | 108 of simplemdg-2.0 | 14 days | 3 |
| Daily summary | e5-daily | 513 of solace-buzz | 7 days ending yesterday | 7 |
| Replay baseline | e5-replay | 1,999 of simplemdg-ticketing | 90 days | 6 |

**Replay** (`replay.py --kh-url`, seeded copy only):

| Measure | e5-replay | simplemdg-ticketing (source) |
|---|---|---|
| Steps | 1,999 | 1,999 |
| Baseline, repeats per 100 eligible steps | 9.36 (G7 target 4.68) | 9.35 |
| Months | 4.64 / 11.44 / 9.15 | 4.63 / 11.45 / 9.13 |

So the time compression keeps the mechanics. Other replay numbers:
- Outcomes: 971 done, 970 failed, 58 corrected.
- Singleton kinds: 0.897, against a target below 0.05.
- Keys that reach 30 sessions per arm within 45 days: 0 of 662.
- Pipeline: every check passes except "lesson candidates with independent evidence" (0). The dev copy has no
  authors (the seed drops them), so no candidate can show 2 callers.

**DB clock offset: not built.** A dev clock offset was not needed. Every time rule that the replay and the
worker read uses the row's `ts` metadata, and the decision rule uses session counts, not days. This is decision
D2.

### 4. Worker E

**Dry pass.** The `kh-worker:e5` image ran against `KH_URL=http://host.docker.internal:9102` with
`KH_WORKER_LLM=dry`. It used the `kh_people` namespace client, rotated by `POST /v1/admin/ns/kh_people:client`
and held in memory only. Results:
- Distil on e5-distil and e5-distil2: 1 batch each.
- Daily on e5-daily: 6 project-days, verdict `dry_run`.
- Cursors, knowledge rows, pending items and open days are identical before and after.
- `worker.run` events are stored: one per batch or day, plus the run summary. This needed fixes 5 and 6.

**429 budget.** A container with `KH_WORKER_CAP_MONTH_USD=0` makes `/distill/next` and `/daily/next` answer 429
`budget` to the worker token, while a maintainer still gets 200. The worker then ends with status `kh_budget`
and the cursor unmoved.

**Mode `on` with `claude_cli`:**
- kh-leaktest: 2 batches, 30 items accepted as `proposed`, $0.195.
- e5-distil: 3 batches, 28 items (22 accepted, 5 merged as updates, 2 refused). The run cap stopped the next
  call: $0.658 spent plus an estimated $0.343 would have passed $1.
- Cost recording: `worker.cost_usd` was 0.194878 against the CLI's reported usage of 0.194877.
- 10 items were approved with the bootstrap token. All 5 keyed items that were sampled were then served by key,
  in tier `distilled`.

### 6. G3 and G4

The flags-off twin `kh-dev-f-off` (port 9103) ran the same image on the same HANA schema, with a copy of the
volume. The source container was paused during the copy.

**G3** (`p1bench.py`): 31.0% answered on both sides, against a gate of 80%. The largest pack was 2,774 characters.
This is the expected state before the backfill: the dev copy holds 29 distilled items. There is one real finding:
in 8 packs, the who and what questions get entity cards that carry an **e-mail address** (open issue 1).

**G4** (`p95probe.py`, 200 calls per route per side, interleaved). All times are p95 in ms.

| Run | `/context/step` on / off | Verdict | `/turn/context` on / off | Verdict |
|---|---|---|---|---|
| 1 | 2375.5 / 2303.9 | pass | 322.9 / 302.7 | FAIL (+6.7%) |
| 2 | 2343.4 / 2293.5 | pass | 274.3 / 305.9 | pass |

At p95 the laptop's noise is larger than the 5% gate. The p50 cost of the turn flags is +1.5 to +7 ms. The hook
overhead was not measured, because no hook command was given. G4 has to be measured again on a quiet host.

### 7. Phase 3 mechanics

The container ran with `KH_LEARN_MODE=trial`. `trial --phase setup` did the following:
1. It created 3 policy actions.
2. It made 2 evidence serves in 2 projects, e5-trial and lesson-learned.
3. It filed `POST /learn/propose` for 3 planted lessons.

`crons --release` then dropped the `_kh` cron leases (open issue 4) and restarted the container. The gate cron
moved all 3 lessons into trial. It also enrolled 21 worker lessons of kh-leaktest and held all of them back,
because they failed the leak/lint and evidence checks.

`trial --phase drive` ran 160 sessions for each of 2 lessons and 12 for the third:
- One `POST /context/step` with `X-KH-Session` and the lesson's action.
- Then `POST /step/outcome`. The planted effect was applied exactly per arm after all serves:
  - neutral: success 0.95 in both arms
  - harmful: control 0.85, served x 0.8
  - small: 12 sessions

The decide cron then gave these recommendations:

| Lesson | Control | Served | Decision |
|---|---|---|---|
| Neutral | 74 of 78 (0.949) | 78 of 82 (0.951) | **accept** `non_inferior`, lower bound -0.0417 |
| Harmful | 68 of 80 (0.85) | 54 of 80 (0.675) | **withdraw** `harm`, p = 0.0093 |
| Small | 6 of 7 | 5 of 5 | no decision (`insufficient`) |

Both decisions are `learn.decision` events with `applied: false`, and both items are still in trial.

The first drive (tag t1) found bug 10: 160 of 160 sessions were served the lesson. That run was rejected through
`POST /learn/decide` so that it never counts.

### 8. G2 rehearsal

The dev copy holds the manual run's items of 2026-10-09: 29 items of m360 and zeus-adm with `distilled_by
claude-opus-5-5`. The design names 87 approved items, but the rest are not in this copy.

1. `worker_vs_manual.py export` wrote the manual side.
2. The worker ran in dry mode with `claude_cli` on m360's first batch. This is the same batch the manual run
   read, because the dev cursor is fresh. It wrote 14 items: 9 new and 5 merges.
3. The worker's `worker.run` events were exported as the other side.

The score:
- Leaks: 0 and 0.
- Schema rejects: 0 of 14 against 0 of 29.
- Keep-rate: NOT MEASURED. The blind sheet is `results/g2-blind-20261011-042700.csv`; fen fills it in.
- p1bench per side: not run.

The verdict is **PARTIAL**.

### 9. Phase 4

`tools/kh_agents/runner.py --backend dry --agents 6 --tasks 24 --stop-drill` ran 6 times.

| Measure | Result |
|---|---|
| Agent writes answered 423 after the stop | 0.09 - 0.14 s |
| Writable again after resume | 0.03 - 0.05 s |
| 428 `approval_required` until a human approved | 41 - 51 per run |
| Namespaces suspended and restored | ops_pilot, sim1, smoke_aa0b8a |

Scorecard over the namespace:
- 10 of 10 chains finished unattended.
- 12.5 interventions per 100 tasks.
- 0 sev-1, audit completeness 1.0, 0 double deliveries.
- Verdict NOT MET, as expected: 0 real tasks.

Agents backed by real Claude were not run. They spend fen's quota, and the dry backend already covers the
mechanics (decision D5).

### 10. Phase 5 shadow

`devcheck_e5.py redteam --bench` ran against a container with `KH_BENCH_HOOK=1`. `tools/kh_bench` was mounted
read-only, and `KH_BENCH_HOOK_TOKEN` was the dev token, passed through the environment.

The red-team set has 37 cases. The `$GOOD`, `$THIN` and `$UNLINKED` evidence placeholders were built from real
`kh.served` and `step.outcome` events. The proposals were spread over 4 proposers, because the limit is 20 per
proposer per day: the maintainer, the kh_people worker token, and 2 agent principals of `ops_pilot`. The
`ops_pilot` agents could propose only after fix 3.

| Check | Result |
|---|---|
| Red-team cases caught | **37 of 37** |
| Control `ok_item` | accept |
| Control `ok_param` (`KH_STEP_FLOOR` 0.68 -> 0.70) | reject, `bench_regression` |
| Overrides applied | none (`overrides: {}`) |

For `ok_param` the bench measured, baseline against candidate:

| Metric | Baseline | Candidate |
|---|---|---|
| p1 answered | 0.310 | 0.286 |
| p1 coverage | 0.585 | 0.544 |
| tier-1 coverage | 0.943 | 0.905 |

### 11. G10

`devcheck_e5.py tier1` runs `khbench.tier1` in-process with `ENVS` and `token` replaced by the dev URLs and their
dev bootstrap tokens, so nothing reaches prod or its Keycloak. The permission probes A1-A3 assume the
non-maintainer bench account, so they are excluded from the means.

| Side | Tasks | Coverage | Recall | Bytes | p95 |
|---|---|---|---|---|---|
| Flags on | 21 | 0.9333 | 0.6429 | 368,357 | 0.309 s |
| Flags off | 21 | 0.9333 | 0.6429 | 368,357 | 0.304 s |

**Tier 2 was skipped**: it runs against prod.

## Bugs found and fixed

Each fix has a regression check that was confirmed to fail without the fix.

| # | Bug | Effect | Fix | Test |
|---|---|---|---|---|
| 1 | The dev bootstrap maintainer lacked `project.log` | No worklog could be written to the dev box (seed, pour, leak set) | `app/dev_bootstrap.py` | `tests/test_dev_bootstrap.py` |
| 2 | `.dockerignore` excluded `worker/` | `deploy/docker/worker.Dockerfile` could not build | `.dockerignore` | built `kh-worker:e5` |
| 3 | `settings.improve.agent_namespaces` defaulted to `kh_ops`, which `PUT /v1/admin/ns` reserves; the pilot is `ops_pilot` | No pilot agent could ever propose (phase 5) | `app/caps/improve.py` (+ the `auth_rules.json` comment) | `tests/caps/test_improve.py` |
| 4 | `replay.py --kh-url` built kh-helper's prod `Session()` even with `KH_TOKEN` set; its "report holds no IP" check fired on its own `source` label (`dev:http://127.0.0.1:9102`) | A dev replay touched the prod sign-in, and every dev pipeline failed | `tools/kh_bench/scripts/replay.py` | `tests/test_replay.py` (2 tests) |
| 5 | Worker event ids `worker.run:<run>:<batch>` broke KH's `[A-Za-z0-9_-]{1,64}` | Every `worker.run` event got 422, so the G2 data path was empty | `worker/kh_worker/khclient.py` `safe_event_id` (deterministic, so appends stay idempotent) | `worker/tests/test_budget.py`; the fake KH in `test_jobs.py` now enforces the rule |
| 6a | `kh_people` principals and its namespace client got an empty project set, because its `[]` means every project | "no grant on project" for every project-tagged worker event | `app/caps/principals.effective_projects` (kh_people only) | `tests/caps/test_people.py` |
| 6b | `people_dims` (`additionalProperties: false`) had no `kind`, but the worker's `worker.cost_usd` sends `dims.kind` | Every billed call stopped the run with `cost_not_recorded`, so the worker could never run `on` | `people_manifest.json`: schema `people_dims` v2 with `kind`, `manifest_version` 2 | `tests/caps/test_people.py` |
| 7 | KH's month spend (lock 3) counted the backfill, against design E4 and the worker's own count; two separate implementations | After an $80 backfill, KH would refuse the worker for the rest of the month | `app/distill.month_spend_usd` drops `dims.kind = backfill`; `app/caps/daily.month_spend` now calls it | `tests/test_distill.py`, `tests/caps/test_daily.py` |
| 8 | `p1bench leakscan` scanned the maintainer-only kh_people events as a *shared* store | A run summary naming its own project id was a G5 hit | `tools/kh_bench/scripts/p1bench.py` | p1bench selftest |
| 10 | Withholding ran only in the by-key read (`distill.served`). A lesson in trial is also a live `dk_*` row, so `/context/step`'s knowledge tier and `/turn/context`'s near and lesson lines served it by meaning | 160 of 160 trial sessions got the lesson, with its id in `withheld_ids` as well. **The trial measured nothing** | `app/caps/learn.withhold`, applied in `app/step.py` and `app/turn.py` | `tests/caps/test_learn.py`; stub signatures updated in `test_outcomes.py` |
| 11 | `tools/kh_agents/runner.py`: a step redone after a global stop met its own effect, still `claimed` by the interrupted attempt (TTL 300 s), and gave up | 1 task in 3 drills ended `error` | It now completes its own claim, requeues the step when another agent holds the claim, and uses a 30 s claim TTL | `tests/test_kh_agents_runner.py` (new) |

Number 9 is unused because the first G5 scan's single hit was bug 8.

## Skipped steps and why

| Step | Why |
|---|---|
| `seed_docker_dev.py` | It reads prod. The kh-dev-hana copy was used instead (step 3). |
| `replay.py --snapshot` | It reads prod. |
| `khbench.py tier2` against prod | Prod. |
| Phase 4 with real Claude agents | fen's quota; the dry agents cover the mechanics. |
| Hook overhead in G4 | No hook command was given. |
| G2 keep-rate and p1bench per side | They need fen's review. |

## Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | The dev data comes from kh-dev-hana's Chroma volume, through a read-only copy and a throwaway container, not from `seed_docker_dev.py` | The only rows-of-prod copy that exists without a prod read. kh-dev-hana is never touched. |
| D2 | No dev DB clock offset | Every rule exercised reads the row ts or session counts. A clock flag would be dead code. |
| D3 | Cron triggering is done by `crons --release` (dev schema only, guarded), not by a new KH route | No KH code change for a dev convenience. The lease semantics are kept as designed. |
| D4 | The planted outcomes are set after all serves | The arms are known, so "neutral" is exactly neutral up to rounding and the expected decisions are deterministic. |
| D5 | Real Claude only through the worker's `claude_cli` adapter ($1.17 in all); none for the phase 4 agents | Cost |
| D6 | The red team runs over HTTP with 4 proposers, and the `alpha` placeholders are mapped to e5-trial | The 20-per-day rate limit, and the dev data |

## Open issues

1. **E-mail addresses in entity cards are served in packs.** They appear in 8 G3 packs on both sides, in data
   that comes from prod. G3 cannot pass until the entity tier masks them or the cards are cleaned. This is a
   product decision.
2. **G3 is at 31%.** This is the pre-backfill state: week 2-3 of the calendar.
3. **G4 is inconclusive on the laptop.** It needs a quiet host and the hook commands.
4. **Cron leases are never released** (`sqldb.run_under_lease`, TTL = interval x 1.5). After a deploy or restage
   (a new instance id), `learn_decide` waits up to 9 h and `learn_gate` up to 1.5 h. This is by design for
   spacing, but it is worth knowing at switch-on.
5. **Replay on real ticketing logs.**
   - errkind labels 49% of the steps as failed, and 90% of the kinds are singletons. The 5.9 label audit
     (100 labels, precision 0.85 or more) must come before the baseline is trusted.
   - Lesson evidence needs authors, and the dev copy strips them.
6. **429 bodies differ between the two worker routes.** `/distill/next` answers `{"detail": {"error":
   "budget"}}`; `/daily/next` answers `{"error": "budget"}`. The worker handles both.
7. **Two flaky or known tests.**
   - `tests/caps/test_packs.py` on HANA failed once with a Chroma "Nothing found on disk" race on a first write,
     and passed on re-run.
   - `tests/test_project_match_weak.py` still fails its documented GAP case, as before this slice.
8. **Dev residue in `KH_STAGEF`** (kept, dev only):
   - Projects: e5-*, kh-leaktest.
   - kh-leaktest's 30 proposed items and 21 gated lesson trials.
   - The trial items of t1 (withdrawn) and t2 (trial).
   - The `ops_pilot` namespace with its rt-agent principals.
   - kh_people events and metrics.
9. **Results are in `tools/kh_bench/results/`** (not committed). They hold excerpts of dev data: p1bench packs,
   replay reports, G2 sides and the blind sheet.

## Final state

- `kh-dev-f` runs image `kh-dev:e5` with the section 10 flags (see step 1). The signing key and the bootstrap
  token are fresh and live only in the container environment.
- `kh-dev-f-off` and the temporary volumes are removed.
- `kh-dev`, `kh-dev-hana`, `hxe`, `evobuzz-*` and the local KH at 9000 were not touched.
- Prod is unchanged. The switch-on follows the gates, one flag at a time.
