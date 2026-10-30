# kh_agents: the phase 4 pilot (agents on KH's own work)

Slice S13 of `docs/roadmap-e-to-5-design.md` (sections 6.2 and 6.4). Three parts, all outside KH:

| File | What it is |
|---|---|
| `manifest.json` | The pilot namespace as data: `task.step` / `task.done` / `task.blocked` events, the fenced `handoff {from_unit, to_role, inputs, done_when, artifacts}` record, the `task_memory` record (If-Match, 30-day retention), the `task_cost_usd` metric, keyspace `ops: [role, step]`, `settings.effects` (approval prefixes and `confirm_policy`) and `settings.pilot` (mode, always-human prefixes, the 6.4 gate thresholds). |
| `runner.py` | Attaches the namespace, applies the manifest, then lets N agents (one KH principal each) work a task mix through leases, handoffs, task memory, events and the effect ledger. It can also run a global-stop drill. |
| `scorecard.py` | Computes the 6.4 gate numbers from KH data only (manifest, events, records, effect ledger, metric) and prints a verdict. |

## Namespace name

The design calls the namespace `kh_ops`, but `PUT /v1/admin/ns` reserves every name that starts with `kh`
(`registry.put_ns`). So the pilot uses `ops_pilot`. You can override it with `--ns` or `KH_AGENTS_NS`.

## Tasks

KH maintenance work, from the design's "first real work" list:
- `finding_chain`: the 5-step chain finding → reproduce → patch (`branch/push/fix-*`) → tests → PR opened
  (`pr/open/fix-*`), then a `merge/fix-*` step. The merge is high-risk.
- `finding_triage`
- `dep_cve_check` (branch and PR)
- `bench_report`
- `distil_review_prep`
- `changelog_draft`

Each task is one unit. A step runs like this:
1. Acquire the lease `unit/<task>`.
2. Read `task_memory` and the handoff addressed to this step.
3. Run the backend.
4. Claim and complete the step's effects. A 428 `approval_required` goes to the confirmer. A reject blocks the task.
5. Write `task.step`.
6. Write the next step's handoff (fenced).
7. Commit `task_memory` with If-Match, retrying on a write conflict.
8. Release the lease.

The last step writes `task.done` and `task_cost_usd`.

## Backends

- `dry` (the default): deterministic scripted agents with no model, no cost and no tokens. With `--seed 13`, about 1 task in
  8 blocks on a human, and about 1 chain in 7 opens a PR that the scripted reviewer rejects at merge. The scripted reviewer acts as the
  dev confirmer: the person behind the dev bootstrap token, whom the runner adds to `confirm_policy`.
- `claude_cli`: one headless `claude -p --output-format json` per step, with read-only tools (`Read,Grep,Glob`) on
  this repo, `--model` (default `claude-sonnet-5`) and `KH_AGENTS_PROFILE` as `CLAUDE_CONFIG_DIR`. It only runs when
  you pass it explicitly, because it spends Claude quota. It is never auto-approved: `--approver` is forced to `none`, so a 428
  stays pending and the task blocks until a listed human approves through `POST /v1/{ns}/effects/{key}:approve`.

The runner never pushes, opens a PR or merges for real. An effect is a ledger entry whose result holds the
artifact, and the operator performs the approved real act.

## Modes

- `--mode shadow` (the default, as in 6.4): `approval_required` = the always-human prefixes plus `*`, so every
  effect waits for a human.
- `--mode on`: only `delete/`, `deploy/prod`, `send/external` and `merge/` need approval.

## Global stop drill

`--stop-drill` runs once about 40% of the steps have been committed:
1. Call `POST /v1/admin/agents:stop` as the maintainer.
2. Time how long until an agent write answers 423.
3. Hold the stop for `--hold-s`.
4. Call `:resume` and time how long until writes succeed again.

Agents that held a lease get `stale_epoch` and redo their step with the next attempt. Effects already done are not
delivered twice: the ledger answers `effect_claimed`, and `task.done` is checked in the log first.

**The stop is global.** It suspends every active namespace on that KH (except `kh_people`), and resume restores them. Use it only on a dev KH.

## Run (Docker dev KH `kh-dev-f`, port 9102)

```
.venv\Scripts\python tools\kh_agents\runner.py --backend dry --agents 6 --tasks 24 --stop-drill
.venv\Scripts\python tools\kh_agents\scorecard.py [--backend claude_cli] [--run ID] [--p95-ms N --g10 pass]
```

Authentication follows `tools/stagef/consumer_sim/simlib.py`. The dev bootstrap token is read with `docker inspect`
and kept in memory only. Each start rotates the namespace client (`POST /v1/admin/ns/{ns}:client`), and its secret
is never printed. The run report goes to `%TEMP%\kh_agents\<run>.json` (or `KH_AGENTS_OUT`).

## Scorecard definitions

These are also in the `scorecard.py` docstring.
- **Real task**: a task whose backend is not `dry`. Dry runs check the mechanics, but they never count toward the gate.
- **Intervention**: a `task.blocked` with `needs_human`, or a `kh.intervention` reject. Merge approvals count as
  designed approvals. Approvals of low-risk keys in shadow mode count as shadow reviews.
- **Sev-1**: a block with `sev >= 1`, or a done high-risk effect without an approve decision by a listed confirmer.
- **Lost update**: `task_memory.rev` differs from its write counter, or memory says an effect is done but the ledger does not.
- **Not measurable from the namespace**: G10 and people's `/context/step` p95. Pass them with `--g10` and `--p95-ms`.

## Dev result (2026-10-11, kh-dev-f, dry, 6 agents, 24 tasks, shadow, stop drill)

Totals:
- 21 tasks done and 3 blocked, 84 steps, 63 handoffs.
- 47 responses were 428. That gave 45 approvals: 36 shadow reviews and 9 merges. There was 1 reject.

Stop drill:
- Agent writes answered 423 after 0.09 s and were writable again 0.03 s after resume.
- `ops_pilot`, `sim1` and `smoke_aa0b8a` were suspended and restored.
- 2 `kh.stale_epoch`, and the affected steps were redone.

Scorecard:
- 9/10 chains finished unattended.
- 16.7 interventions per 100 tasks.
- 0 sev-1, audit 1.0, 0 double deliveries or lost updates.
- Verdict: NOT MET, as expected: 0 real tasks, 0 days, and G10 and p95 not measured.
