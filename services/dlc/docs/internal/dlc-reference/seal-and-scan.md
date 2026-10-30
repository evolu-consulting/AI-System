> **INTERNAL - do not ship to customers.** Developer reference copy of the customer document `seal-and-scan.md` as of 2026-10-11, with source paths and module names. The customer version lives in `docs/dlc/`.

# Seal and scan: trustworthy results without a blocking seal

Status: **wired into the engine behind flags, all off by default** (`LINE_SEAL`, `LINE_SEAL_DEPTH`,
`LINE_SEAL_GOVERNOR_FAIL`, `LINE_SEAL_L2_PATHS`, `LINE_SCAN_CACHE`). With the flags off the engine behaves
exactly as before. Section 7 says what each hook does; section 9 how to enable it and what was tested.

## 1. Problem

A seal is the strongest guarantee the engine can give that a piece of work is right: the gates were
fixed before the build, someone other than the builder scored it, the evidence is real command output,
and once sealed it is never quietly rewritten. Two things make a naive seal expensive under load:

1. **Rescans.** Every seal changes the code; if the code graph is rebuilt after every seal, a busy
   estate rescans whole repositories continuously.
2. **Blocking.** If nothing may touch a resource until its seal lands, the scorer becomes the
   bottleneck of every builder.

Goal: keep every property of the seal, make it cost a few files per seal, and make it block only the
work that truly depends on it.

## 2. The seal (ledger)

`line/seal/ledger.py`, `line/seal/score.py`

| Rule | How it is enforced |
|---|---|
| Gates are written before the build by someone who is not the builder | `freeze_gates(subject, gates, approver, builder)` refuses `approver == builder`; after `build_started` the gates can never be replaced (`GateFrozen`), and `submit` re-checks the gates hash |
| The builder never scores its own work | `judge()` refuses `scorer == builder`; L2 sign-off is a third person |
| Score = Purpose x Evidence x Love, multiplied | `Score.total`; any factor 0 -> total 0 (an average would hide it); sealed only at >= 90 with all factors > 0 |
| Mandatory "docked" section | `docked=None` is refused; `[]` means "present, nothing docked" |
| Evidence is real command output | each item needs `cmd`, `exit_code` and non-empty `output`; a note alone is not evidence |
| Ratchet: sealed is never revised | each subject is scored or voided once; a wrong seal stays and gets a `corrected` entry pointing at the new subject |
| Tamper evidence | every entry carries the sha256 of the previous one; `verify()` re-walks the chain and the ratchet |

Risk levels (`level_for`): **L0** automatic; **L1** scored now, reviewed by a person later, never
blocks; **L2** (touches the trunk, more than 3 units, or impact UNKNOWN - unknown is never "none")
needs a named person's sign-off, and only that item waits.

## 3. Unsealed resources (MVCC)

`line/seal/resources.py`

Every resource (file, entity, graph node) has a version chain; a version is
`building -> pending -> sealed | failed` and belongs to the batch that wrote it.

| Situation | Rule |
|---|---|
| Two agents want to write the same resource | one claim per resource with a fencing epoch; an old epoch or an expired claim is refused (`StaleClaim`) |
| An agent reads | by default the **last sealed** version: unsealed work is invisible, so it cannot hurt anyone |
| An agent needs unsealed work | it declares it (`mode="speculative"`); the dependency is recorded and the reader **cannot seal before its producers seal** |
| It only needs the interface | the contract frozen at gate time is read (`mode="contract"`): no dependency on the pending implementation |
| A seal fails | the producer's versions fail and every batch that (transitively) speculated on it is **tainted** and redone; a sealed batch can never be tainted because it could not seal before its producers |
| Long chains of speculation | depth (longest chain of unsealed producers) is capped, default 2; beyond it the batch waits (`DepthExceeded`) |
| Data | pending data changes stay in staging until sealed (policy; not simulated) |

## 4. Incremental rescans

`line/seal/scancache.py`

* **Content-addressed cache**: facts are cached by blob sha + extension + extractor version. The same
  content is extracted once, whatever repository, commit or consumer asks. A directory cache can be
  shared by every process (or held by the RAG system).
* **Versioned graph**: base snapshot + one delta layer per later commit. `as_of(sha)` answers exactly
  as that commit had it; nothing is rebuilt.
* **Lazy freshness**: `stale(version, touched)` = the files a batch touches that changed after the
  graph version it read. Empty -> start now; otherwise re-read exactly those files.
* **Coalesced single-flight queue**: one rescan per repo at a time; requests that arrive meanwhile
  collapse into one with the newest sha and the highest priority.

## 5. Scheduling

`line/seal/scheduler.py`

* A finished build is handed to the scorer and the builder moves on.
* Scoring order: batches other batches are waiting on first (critical path), then L2, then oldest.
  Under load, L1 items nobody waits on are deferred (they never block anyone).
* Start mode of a new batch: **clean** (touches nothing pending), **speculative** (touches pending work
  within the depth limit), **wait** (depth exceeded, or a resource is being written right now).
* Gates run impact-selected tests; the full suite runs at the final seal.
* **Speculation governor** (added after the first measurements, see 6.3): new speculation is switched
  off while the recent seal failure rate is above 20 % (window 20).

## 6. Measured results

### 6.1 Simulation

`python -m line.seal.sim --seeds 1 2 3 4 5 --stress` - deterministic discrete-event simulation; both
modes run the same batches and the same failure draw per (batch, attempt), and both use the real
`ResourceTable` and `SealLedger`, so the invariants are checked on the code itself. 5 repos x 300 files,
8 builders, 3 scorers, score 6, full suite 8, scan 0.05 per file, L2 sign-off 30 (time units). Values
are means over 5 seeds (max_cascade = max).

Baseline = full rescan after every seal (nothing on that repo starts while the graph is stale), the
builder waits for its seal, pending resources block everyone, full suite at every gate, FIFO scoring.

| traffic | fail | mode | wall | latency | wait | wait p95 | builder time | files scanned | redo (fail) | redo (taint) | max cascade |
|---|---|---|---|---|---|---|---|---|---|---|---|
| low | 0 | baseline | 824 | 51 | 19 | 81 | 1040 | 12000 | 0 | 0 | 0 |
| low | 0 | optimised | 804 | 35 | 7 | 29 | 880 | 160 | 0 | 0 | 0 |
| low | 0.3 | baseline | 867 | 81 | 49 | 172 | 1529 | 12000 | 18.8 | 0 | 0 |
| low | 0.3 | optimised | 822 | 51 | 23 | 84 | 1355 | 160 | 19 | 2.6 | 1 |
| high | 0 | baseline | 443 | 91 | 59 | 174 | 1040 | 12000 | 0 | 0 | 0 |
| high | 0 | optimised | 247 | 38 | 10 | 36 | 880 | 160 | 0 | 0 | 0 |
| high | 0.1 | baseline | 475 | 105 | 73 | 224 | 1172 | 12000 | 5 | 0 | 0 |
| high | 0.1 | optimised | 267 | 44 | 16 | 61 | 1059 | 160 | 5.2 | 2.6 | 2 |
| high | 0.3 | baseline | 580 | 137 | 105 | 323 | 1529 | 12000 | 18.8 | 0 | 0 |
| high | 0.3 | optimised | 304 | 58 | 30 | 106 | 1418 | 160 | 18.6 | 5.6 | 2 |
| very high | 0 | baseline | 384 | 131 | 99 | 259 | 1040 | 12000 | 0 | 0 | 0 |
| very high | 0 | optimised | 168 | 64 | 36 | 84 | 880 | 161 | 0 | 0 | 0 |
| very high | 0.3 | baseline | 537 | 179 | 146 | 392 | 1529 | 12000 | 18.8 | 0 | 0 |
| very high | 0.3 | optimised | 261 | 93 | 65 | 152 | 1434 | 161 | 17.8 | 6.8 | 2 |

Stress (120 batches, 3 % of files take 70 % of the writes, very high traffic) with an ablation:
`opt_no_spec` = everything except speculation (depth 0); `opt_adaptive` = with the governor.

| fail | mode | wall | latency | wait p95 | builder time | files scanned | redo (taint) | max cascade |
|---|---|---|---|---|---|---|---|---|
| 0 | baseline | 1295 | 454 | 929 | 3140 | 36000 | 0 | 0 |
| 0 | opt_no_spec | 708 | 180 | 404 | 2676 | 692 | 0 | 0 |
| 0 | optimised | 451 | 139 | 237 | 2666 | 492 | 0 | 0 |
| 0 | opt_adaptive | 451 | 139 | 237 | 2666 | 492 | 0 | 0 |
| 0.3 | baseline | 1587 | 588 | 1189 | 4520 | 36000 | 0 | 0 |
| 0.3 | opt_no_spec | 870 | 264 | 588 | 3852 | 686 | 0 | 0 |
| 0.3 | optimised | 685 | 224 | 410 | 4914 | 494 | 47.8 | 3 |
| 0.3 | opt_adaptive | 834 | 245 | 536 | 4136 | 618 | 12.8 | 2 |
| 0.5 | baseline | 2094 | 778 | 1621 | 6468 | 36000 | 0 | 0 |
| 0.5 | opt_no_spec | 1193 | 385 | 827 | 5500 | 678 | 0 | 0 |
| 0.5 | optimised | 1067 | 351 | 658 | 7832 | 493 | 105.2 | 3 |
| 0.5 | opt_adaptive | 1186 | 382 | 843 | 5604 | 666 | 4 | 2 |

**Invariants held in every run (all seeds, all scenarios):** no batch sealed on a failed or unsealed
producer; never two writers on one resource at the same time; every read of unsealed work was recorded
and resolved; the ledger chain and ratchet verified. Every batch finished.

### 6.2 Real git

`python -m line.seal.gitbench` - a generated repository, 10 commits touching 3 files each (some adding
and deleting files); incremental `advance` with a shared cache vs a cold full rescan per commit.

| repo size | files extracted (incremental / full) | time (incremental / full) | as_of mismatches | old version answered exactly |
|---|---|---|---|---|
| 300 files | 31 / 2992 | 0.25 s / 0.57 s (2.3x) | 0 | yes |
| 1500 files | 28 / 14984 | 0.31 s / 1.86 s (6.0x) | 0 | yes |

The work avoided is ~100x in files; the wall-clock gain is smaller because the test extractor is a
regex (microseconds per file) and each `advance` pays a fixed ~25 ms for `git ls-tree`. With a real
extractor (a parser or a model call per file) the file count dominates and the gain approaches the
file ratio.

### 6.3 Verdict (honest)

* **Clear win, no trade-off:** incremental, content-addressed rescans (files scanned -98 % to -99 %),
  lazy freshness, handing work to the scorer instead of waiting for it, impact-selected gates. Under
  high traffic the run finishes in 44-56 % of the baseline time and p95 wait drops 2.6-4.8x; this part
  alone (`opt_no_spec`) is already ~1.8x faster than the baseline under stress.
* **At low traffic** the finish time barely moves (arrivals dominate); latency per batch still drops ~30-40 %.
* **Speculation is a trade, not a free win.** With reliable seals it adds another 36 % speed under
  contention for no extra builder time. With 30-50 % failing seals it still finishes 11-21 % sooner than
  without it, but burns 28-42 % more builder time on tainted work (up to ~105 redone batches out of 120,
  cascades up to 3 deep). The governor recovers the builder time when failures are high (4136 vs 4914,
  5604 vs 7832) at the price of that speed. Default: speculation on, governor on, depth 2.
* **Coalescing** rarely triggered in these runs because incremental scans finish in a fraction of a
  time unit; it matters when a rescan is slow (a model-based extractor, a large merge).
* **Not modelled:** real scorer behaviour (the sim draws pass/fail), staging of pending data, network
  costs of a shared cache.

## 7. Integration (wired; `line/seal/wire.py` is the glue, one `RunSeal` per run)

| Step | Where | What it does now |
|---|---|---|
| 1 | `line/build/builder.py:dispatch` -> `RunSeal.claim()` / `started()` | per-file claim = one durable lease `seal:<repo key>:<path>` (fencing epoch, TTL) taken before the unit lease is used; refused -> the unit stays ready; then the unit's gates (locked acceptance tests: id + sha; a unit without tests: its claims) are frozen with approver `test_author`, builder `builder`/`fixer`, and the build starts |
| 2 | `line/build/verifier.py:gate` / `verify` | `ev=` collects the evidence of the check that decided (command, output tail, exit code; a unit without tests: the compile check); stored on the verify gate row as `evidence_item` (seal on only) |
| 3 | `line/pipeline.py:_after_attempt` -> `RunSeal.on_attempt()` | verified: claims released, the ledger entry submitted with the evidence and the gates checked again (`GateFrozen` if they changed), the subject queued for scoring with its level; **not** enqueued for merge. Any other end: the attempt is voided, claims released |
| 4 | `line/pipeline.py:_build_loop` -> `RunSeal.tick()` (after dispatch) | scoring runs beside the build, never in front of it: critical path first; scorer = `reviewer` when LINE_REVIEW is on, else the deterministic `seal-scorer` (purpose = owned acceptance tests passing, evidence = real command output, love = 100 unless the reviewer asked for changes); never the builder. Dry runs read `dry/seal/<unit>#<n>.json` instead |
| 5 | levels | L2 when a claim matches `LINE_SEAL_L2_PATHS` or the unit claims nothing (unknown impact), L1 when it built on pending work, else L0. L2 + `LINE_HUMAN_MODE=decide`: signed by `line:decide` and logged as a decision; `ask`: the subject waits; when nothing else can move the run parks (`seal: sign-off of ...`) until `POST /api/runs/{id}/seals/{subject}:sign` |
| 6 | sealed -> merge | a sealed subject finalises when every producer it built on is sealed; it is enqueued only when those producers are MERGED (never ahead of them). `MergeQueue.seal_ok` refuses any item whose seal is not final (stage `seal`, not a ladder failure) |
| 7 | refused / failed | a refused score (or refused sign-off) taints every subject that built on it (voided or corrected, unit back to ready with `SEAL_TAINTED`, worktree removed), and the refused unit goes back to ready and onto the retry ladder with `SEAL_REJECTED`. A sealed producer that later leaves `verified` without merging (merge conflict) taints its readers the same way |
| 8 | speculation | `RunSeal.promote()` (before `next_ready`) makes a pending unit ready when each dependency is merged or verified-and-pending-a-seal, within `LINE_SEAL_DEPTH`, while the governor allows it (recent failure rate <= `LINE_SEAL_GOVERNOR_FAIL`). The producers' heads are merged into the unit's worktree in the object store (`merge-tree`, no working tree touched) and the base ref moves past them, so the unit's diff is its own work only |
| 9 | `line/pipeline.py:_qas_round` -> `_final_seal()` | QAS green: the full locked acceptance suite runs on main and the run's final seal (`<run>:final#1`, scorer `qas`) must seal; otherwise the run escalates `SEAL_REJECTED` |
| 10 | `line/migrate/scancache.py` + `runner.py` (LINE_SCAN_CACHE) | model answers of the inventory, the merge and the match keyed by sha1(role, prompt, schema, model): an unchanged chunk is never sent again (resumed migration, next migration of the same estate, a shared cache dir). Before the blast radius, a VersionedGraph of the v2 repository (per-file facts cached by blob sha) compares the commit the inventory read with HEAD; when the target moved, the v2 facts are re-extracted and `blast.json` carries `freshness` {scanned, head, changed, stale} |
| 11 | persistence and resume | ledger entries = `seal_entry` rows (`<run>:<seq>`, hash chain), projection = `seal` rows; a new driver rebuilds the ledger, the dependency table and the score queue; verified units whose attempt never reached submit are submitted by `recover()` |
| 12 | events, board, API | `seal.gated / submitted / scored / sealed / tainted / voided / corrected` (in the RAG manifest automatically, they are `codes.EVENT_KINDS`); board run view: a Seals table; `GET /api/runs/{id}/seals` |

Not used, on purpose: the human-question API (`/answers`) for L2. Answering there closes the round into a
spec addendum and re-freezes the pack, which is wrong for a sign-off; the sign-off has its own route.

### Original plan (kept for reference)

| Step | Where | What |
|---|---|---|
| 1 | `line/understand/test_author.py` (test lock) and `line/pipeline.py:Pipeline._commit_tests` | `ledger.freeze_gates(run/unit, locked tests, approver=test_author role, builder=builder role)`; the existing sha lock already freezes the tests - record its sha as `gates_sha` |
| 2 | `line/build/builder.py:dispatch` | `ResourceTable.claim` per file of the unit's claim set (replaces nothing: the unit lease stays; this adds per-resource fencing across runs); `begin_write` at the first edit |
| 3 | `line/build/verifier.py:verify` / `gate` | evidence items = the captured command + output + exit code the verifier already has; `ledger.build_started` / `submit` |
| 4 | `line/pipeline.py:Pipeline._after_attempt` | builder slot freed at submit (already true); put the unit on `ScoreQueue` with `level_for(...)` from the blast radius |
| 5 | `line/review/` (clean-context reviewer) or the judge role | the scorer: produce `Score` (purpose / evidence / love + docked); `ledger.score`; L2 -> park for sign-off through the existing human-question API |
| 6 | `line/ship/merge_queue.py:MergeQueue._merge` | merge only units whose seal finalised (`can_finalize`); on a failed seal call `ResourceTable.fail` and requeue the tainted units through `Pipeline._requeue_lost` |
| 7 | `line/migrate/scan.py:scan_repo` / `scan_side` | replace the per-repo commit cache by `VersionedGraph` + `BlobCache` (directory under the migration dir or a shared cache); after each sealed merge call `advance(new_sha)`; blast radius reads `as_of(version)` and calls `stale()` before trusting it |
| 8 | `line/pipeline.py:Pipeline._qas_round` | full suite at the final seal; impact-selected tests per unit gate |
| 9 | config | `LINE_SEAL=1`, `LINE_SEAL_DEPTH=2`, `LINE_SEAL_GOVERNOR_FAIL=0.2`, `LINE_SCAN_CACHE=<dir>`; all off by default |

## 8. Files

* `line/seal/score.py`, `ledger.py` (entries + sink for the store), `resources.py`, `scancache.py`, `scheduler.py`
* `line/seal/wire.py` (the engine glue), `line/migrate/scancache.py` (LINE_SCAN_CACHE)
* `line/seal/sim.py` (simulation), `line/seal/gitbench.py` (real git check)
* `line/tests/test_seal_core.py`, `test_seal_scan.py`, `test_seal_wire.py`; dry e2e variants `seal`, `seal_taint`

## 9. Enable it

```
LINE_SEAL=1                     # ledger, claims, async scoring, sealed-only merges, final seal
LINE_SEAL_DEPTH=2               # 0 = no speculation (dependents wait for merged producers, as before)
LINE_SEAL_GOVERNOR_FAIL=0.2     # new speculation stops above this recent seal failure rate
LINE_SEAL_L2_PATHS=db/*,srv/*   # claims whose change needs a person's sign-off (comma list or JSON)
LINE_SCAN_CACHE=1               # migrations: per-migration cache dir; or a path for a cache shared by migrations
```

Check: `python -m line.e2e.run_line_e2e seal seal_taint` (dry, no model). `seal` ends green with every merged
unit sealed, the ledger chain valid and the final seal sealed; `seal_taint` refuses U2#1 through the dry
scorer, U4 (which started on U2#1) is tainted, voided and built again, U2 is rebuilt, and the run ends green.

Limits: the scorer is deterministic (or the reviewer role's verdict folded in), not a separate model judging
purpose; impact-selected tests per unit are the verifier's (the unit's own acceptance tests), the full suite
runs once at the final seal; per-file claims fence writes across runs of the same repository, not reads.
