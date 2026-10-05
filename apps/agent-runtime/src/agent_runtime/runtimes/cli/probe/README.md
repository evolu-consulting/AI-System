# runtimes/cli/probe/ — probe quota `claude-sub` (H3a, WRK-FR-22)

Spec: `docs/specs/H3a-subscription/plan-runtime.md` §4–§6, `spec.md` R14/R18, `spec-decisions.md` Spike S1. Vòng gọi (`probe_due` → (a) → (b) → `probe_result` → `apply_probe`): `queue/probe_loop.py` (PY-04).

| File | Nội dung |
|---|---|
| `__init__.py` | (cha) `ProbeHostCfg` (`rt §6`), `probe_dir` (`<work>/.probe/<key>` 0700 + `.tmp`), `read_fake` (dòng đầu `AGENT_RT_FAKE_PROBE_FILE`, đọc mỗi lượt), `note_call` (`<file>.calls` — chỉ khi có env), `probe_argv`. Không import `config`/`db`/`events`/SDK (con cũng nạp gói này) |
| `auth.py` | (cha) (a) `auth_status(cfg, key) -> (bool \| None, ms)`: CLI `AGENT_RT_CLI_PATH` hoặc đi kèm SDK (`_bundled/claude`, không import SDK) `auth status --json`; stdin/stderr `DEVNULL`, stdout ≤ 64 KiB → `auth_logged_in` (chỉ khoá `loggedIn`), **không log**; hạn 15 s → giết group → None. `fake-cli`: không process, `logged_out` ⇒ False |
| `turn.py` | (cha) (b) `probe_turn(cfg, key, fake) -> (ProbeSeen, timed_out)`: spawn con (group riêng, env `job_host_env` + venv, stderr `DEVNULL`), một dòng `ProbeRequest`, gom `rate_limit` (nặng nhất)/`final`/`usage`/`fatal`; log `claude.rate_limit{source:"probe"}`; hạn `AGENT_RT_PROBE_TIMEOUT_S` → giết group; huỷ → giết group |
| `child.py` | (con) `python -m agent_runtime.runtimes.cli.probe.child --provider=<key>`: `ProbeRequest` → `provider.probe(req, emit)` → JSON lines stdout (`protocol.encode_event`); lỗi bất ngờ → `fatal INTERNAL_ERROR` |

Test: `test_auth.py` (script giả thay CLI), `test_turn.py` (con thật + `fake-cli`). Không gọi `claude-sub` thật (smoke I2).
