# KH bench

Home: `Slaves/KnowledgeHub/tools/kh_bench` in RWorkspace (in git since 2026-10-10, so any machine can run it; earlier
`C:/Programs/ClaudeKH/tools/kh_bench`). Roadmap: `Slaves/KnowledgeHub/docs/roadmap-2026-2028.html`.

## Per-machine set-up

`run/`, `results/` and `__pycache__/` are generated on each machine and not committed. Paths come from env vars:

| Var | Default | What |
|---|---|---|
| `KH_BENCH_SECRETS` | `~/.claude_rowan/secrets` | folder with `kh-prod-accounts.json` and `hana-{prod,dev}-bench.json` (never in git) |
| `KH_BENCH_PROFILE` | first of `C:/RWTemp/kh-bench/profile`, `E:/RWTemp/kh-bench/profile`, `~/.kh-bench/profile` | bench Claude profile with `kh-helper` / `kh-helper-dev` venvs |
| `KH_BENCH_DEV_URL` | `https://kh-sso.cfapps.br10.hana.ondemand.com` | candidate KH (dev side of the comparison); `http://127.0.0.1:9101` for the Docker dev below |
| `KH_BENCH_LOCAL_KH` | `http://127.0.0.1:9000` | local KH that stores the results; empty = keep them in `results/` and `reports/` only (a machine whose 9000 is an old build) |
| `KH_BENCH_RENAMES` | `{}` | extra `{"old": "new"}` project renames on top of the built-in ones |
| `KH_BENCH_WORKSPACE`, `KH_BENCH_SCRATCH` | required by `compare3.py` | folder every case runs in, and the extra folder it may read |
| `KH_BENCH_LOCAL_SETTINGS` | `~/.claude/settings.json` | `compare3.py` local case: settings file whose hooks reach a local KH |
| `KH_BENCH_CLAUDE_PROFILE` | `CLAUDE_CONFIG_DIR`, else `~/.claude` | `stepbench.py`: Claude profile holding the `kh-helper` venv |
| `KH_BENCH_RUN_DIR` | `<temp>/stepbench_run` | `stepbench.py` working folder |
| `KH_BENCH_TESTER` | required by `stepbench_data.py` | test account e-mail that gets read access |
| `KH_BENCH_KEYCLOAK_BTP`, `KH_BENCH_TEST_ACCOUNTS` | required by `run_e2e.py` | Keycloak repo's `deploy/btp` folder; test accounts file |
| `KH_BENCH_EMBED_MODEL` | `models/bge-small-en-v1.5` of this KH | `piece_experiment.py` embedder |

Project ids renamed since `tasks.json` was written (`knowledge` -> `lesson-learned`, `ticketing-system` ->
`simplemdg-ticketing`) are mapped when the tasks are read (`RENAMES` in khbench.py); `tasks.json` itself is left
as the maintaining machine writes it. The secrets file is read on first use, with a clear message when missing.

On a new machine: copy the secrets folder, build the bench profile (two kh-helper venvs, then `kh login` once
each, see below), set the vars, run `python scripts/khbench.py tier1` from PowerShell.
The experiment scripts take their folders from the vars above and stop with a clear message when a
required one is unset; none carries a machine path.

Measures BTP dev `kh-sso` (candidate) against BTP prod `knowledge-hub` (baseline) before every prod upgrade.
Operated from the local KH on 127.0.0.1:9000, where the task set and every result are stored (project
`knowledge-hub`, topics `kh-bench-process` and `kh-bench-results`). Decided by Rowan on 2026-10-01.

## Dev on Docker (since 2026-10-10)

The BTP dev app `kh-sso` was removed (org out of memory). The candidate is now a local container built from
`deploy/docker/Dockerfile`, with KH's relational and graph tables on SAP HANA Express (container `hxe`, port
39041, schema `KNOWLEDGE_HUB`) and vectors on Chroma (HANA Express has no `REAL_VECTOR`):

    docker run -d --name kh-dev-hana -p 9101:8000 -v kh-dev-hana-data:/data       -e KH_AUTH_ISSUER=https://kh-keycloak.cfapps.br10.hana.ondemand.com/realms/knowledge-hub       -e KH_STORE_BACKEND=hana -e GRAPH_BACKEND=hana -e KH_VECTOR_BACKEND=chroma       -e HANA_HOST=host.docker.internal -e HANA_PORT=39041 -e HANA_USERNAME=SYSTEM -e HANA_PASSWORD=<local>       -e HANA_SCHEMA=KNOWLEDGE_HUB -e HANA_ENCRYPT=false kh-dev:local

Step 2 below becomes `python scripts/seed_docker_dev.py` (run with the kh-helper Python of a maintainer): it
copies the task projects' knowledge, log and entity rows, the policy and the hook rules from prod through the
API, and creates the projects inside the container so nothing is registered at Keycloak. Then set
`KH_BENCH_DEV_URL=http://127.0.0.1:9101` and point the bench profile's `kh-helper-dev` at it.

## Upgrade process

1. Build the feature and deploy it to dev.
2. `python scripts/copy_prod_to_dev.py run`, then `cf restart kh-sso`. Dev keeps its own hooks and policy.
3. `python scripts/khbench.py tier1` (retrieval, no LLM, all 18 tasks, both sides).
4. `python scripts/khbench.py tier2 --expect "<metric>:<change>"` (core tasks, 3 runs per side).
5. Upgrade prod only if the report says PASS.

Run steps 3 and 4 from **PowerShell**, not Git Bash: kh-helper's owner lock needs an unbroken Windows
parent-process chain, and Git Bash breaks it.

## Files

| Path | What |
|---|---|
| `tasks.json` | 18 tasks, 3 per category; `core` = R1 M3 W1 P2 X2 A2 |
| `scripts/khbench.py` | tier1, tier2, report, cleanup |
| `scripts/copy_prod_to_dev.py` | HANA copy prod schema -> dev schema (plan / run) |
| `scripts/create_bench_account.py` | creates or repairs the bench account and proves its access |
| `scripts/bench_browser.py` | stand-in browser for the one-time `kh login` of the bench profile |
| `C:/RWTemp/kh-bench/profile/` | Claude Code profile of the bench; `kh-helper` (prod) and `kh-helper-dev` (dev). Kept OUTSIDE this folder because the helper venvs carry absolute paths; override with `KH_BENCH_PROFILE` |
| `results/`, `reports/` | raw JSON per run, HTML report per tier 2 run |

## Accounts and secrets (never in this folder)

- Bench account `kh-bench@kh-agent.invalid`: kh-users, no tenant; editable on ticketing-system, m360,
  simplemdg-2.0, solace-buzz; readonly on knowledge; no access to simplemdg-support, simplemdg-v2, pdf-to-epub.
- Passwords and HANA service keys: `C:/Users/RowanHoang/.claude_rowan/secrets/`.
- Both helper copies are signed in until 2026-12-30. To renew, run `kh login` again from PowerShell with
  `CLAUDE_CONFIG_DIR` set to `C:/RWTemp/kh-bench/profile` and `BROWSER="python scripts/bench_browser.py %s"`.
- The bench profile's Claude login is Rowan's subscription (option A). Tier 2 spends its quota.

## Gate

- Any leak or forbidden write in any dev run fails the gate.
- Accuracy may not drop; input tokens and cost may not rise more than 10% (`GUARD` in khbench.py).
- `--expect` adds the feature's own target, written down before the feature is built.
- A drop inside the spread of either side is reported as a tie, not a failure.
