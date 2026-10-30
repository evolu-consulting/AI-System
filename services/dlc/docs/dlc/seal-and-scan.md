# Seal and scan: trustworthy results without a blocking seal

Status: **available behind settings, all off by default** (`LINE_SEAL`, `LINE_SEAL_DEPTH`,
`LINE_SEAL_GOVERNOR_FAIL`, `LINE_SEAL_L2_PATHS`, `LINE_SCAN_CACHE`). With them off the engine behaves exactly
as without the feature. Section 7 says how to enable it.

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

| Rule | What the engine enforces |
|---|---|
| Gates are written before the build by someone who is not the builder | the approver may not be the builder; once the build starts the gates can never be replaced, and the submission is checked against the frozen gates |
| The builder never scores its own work | the scorer may not be the builder; an L2 sign-off is a third person |
| Score = Purpose x Evidence x Love, multiplied | any factor 0 gives 0 (an average would hide it); sealed only at >= 90 with every factor > 0 |
| Mandatory "docked" section | a score without its "docked" list is refused (an empty list means "nothing docked") |
| Evidence is real command output | each item needs the command, its exit code and non-empty output; a note alone is not evidence |
| Ratchet: sealed is never revised | each subject is scored or voided once; a wrong seal stays and gets a `corrected` entry pointing at the new one |
| Tamper evidence | every ledger entry carries the hash of the previous one; the chain is re-walked to verify |

Risk levels: **L0** automatic; **L1** scored now, reviewed by a person later, never blocks; **L2** (touches the
trunk, more than 3 units, a path listed in `LINE_SEAL_L2_PATHS`, or impact unknown - unknown is never "none")
needs a named person's sign-off (`POST /api/runs/{run}/seals/{subject}:sign`), and only that item waits.

## 3. Unsealed work (multi-version reads)

Every resource (file, entity, graph node) has a version chain: `building -> pending -> sealed | failed`.

| Situation | Rule |
|---|---|
| Two agents want to write the same resource | one claim per resource with a fencing epoch; an old epoch or an expired claim is refused |
| An agent reads | by default the **last sealed** version: unsealed work is invisible, so it cannot hurt anyone |
| An agent needs unsealed work | it declares it; the dependency is recorded and the reader **cannot seal before its producers seal** |
| It only needs the interface | it reads the contract frozen at gate time: no dependency on the pending implementation |
| A seal fails | every batch that (transitively) built on it is **tainted** and redone; a sealed batch can never be tainted |
| Long chains | speculation depth is capped (default 2); beyond it the batch waits |
| Data | pending data changes stay in staging until sealed |

## 4. Incremental scans

* **Content-addressed cache**: facts are cached by file content, so the same content is extracted once
  whatever repository, commit or consumer asks.
* **Versioned graph**: a base snapshot plus one layer per later commit answers "as of" any commit; nothing is
  rebuilt.
* **Lazy freshness**: a batch re-reads only the files it touches that changed after the graph version it read.
* **One rescan per repository at a time**; requests that arrive meanwhile collapse into one.

## 5. Scheduling

* A finished build is handed to the scorer and the builder moves on.
* Scoring order: work others are waiting on first, then L2, then oldest. Under load, L1 items nobody waits on
  are deferred.
* A new batch starts **clean** (touches nothing pending), **speculative** (within the depth limit) or
  **waits**.
* Gates run the unit's tests; the full suite runs at the final seal.
* **Speculation governor**: new speculation stops while the recent seal failure rate is above
  `LINE_SEAL_GOVERNOR_FAIL` (default 20 %).

## 6. Measured results

### 6.1 Simulation

Vendor benchmark: a deterministic discrete-event simulation; both modes run the same batches and the same
failure draw per (batch, attempt), and both use the engine's real seal ledger and resource table, so the
invariants are checked on the product code itself. 5 repos x 300 files,
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

Vendor benchmark on a generated repository: 10 commits touching 3 files each (some adding
and deleting files); incremental update with a shared cache vs a cold full rescan per commit.

| repo size | files extracted (incremental / full) | time (incremental / full) | as_of mismatches | old version answered exactly |
|---|---|---|---|---|
| 300 files | 31 / 2992 | 0.25 s / 0.57 s (2.3x) | 0 | yes |
| 1500 files | 28 / 14984 | 0.31 s / 1.86 s (6.0x) | 0 | yes |

The work avoided is ~100x in files; the wall-clock gain is smaller because the test extractor is a
regex (microseconds per file) and each step pays a fixed ~25 ms for listing the tree. With a real
extractor (a parser or a model call per file) the file count dominates and the gain approaches the
file ratio.

### 6.3 Verdict (honest)

* **Clear win, no trade-off:** incremental, content-addressed rescans (files scanned -98 % to -99 %),
  lazy freshness, handing work to the scorer instead of waiting for it, impact-selected gates. Under
  high traffic the run finishes in 44-56 % of the baseline time and p95 wait drops 2.6-4.8x; this part
  alone (without speculation) is already ~1.8x faster than the baseline under stress.
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

## 7. Enable it

```
LINE_SEAL=1                     # ledger, claims, async scoring, sealed-only merges, final seal
LINE_SEAL_DEPTH=2               # 0 = no speculation (dependents wait for merged producers)
LINE_SEAL_GOVERNOR_FAIL=0.2     # new speculation stops above this recent seal failure rate
LINE_SEAL_L2_PATHS=db/*,srv/*   # claims whose change needs a person's sign-off (comma list)
LINE_SCAN_CACHE=1               # migrations: per-migration cache; or a folder path for a cache shared by migrations
```

The board's run view shows a Seals table; `GET /api/runs/{run}/seals` lists the rows.

Limits: the scorer is deterministic (or folds in the reviewer's verdict), not a separate model judging
purpose; per-unit gates run the unit's own acceptance tests and the full suite runs once at the final seal;
claims fence writes, not reads.
