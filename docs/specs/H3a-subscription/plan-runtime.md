# Plan · H3a · Agent Runtime Python (`apps/agent-runtime`)

Phụ lục của [`plan.md`](plan.md). SQL: [`plan-db.md`](plan-db.md). Nền: H1 `plan-runtime` §1.1 (lớp import), §2.4 (khởi động), §3.3 (luật provider), §5.3 (env con), §8 (Kết thúc). Đường dẫn dưới tính từ `src/agent_runtime/`.

## 1. Tổng quan thay đổi
| File | Mới/sửa | Nội dung | Task |
|---|---|---|---|
| `runtimes/cli/quota_rules.py` | mới | luật thuần §3 (không I/O, không SDK; thêm vào import-linter "Lõi thuần") | PY-00 stub · PY-01 |
| `config.py` | sửa | env §6 + kiểm biên theo `APP_ENV` | PY-00 |
| `providers/base.py` | sửa | `RateLimit` + `rate_limit_type`, `utilization`, `raw_shape`; `ProbeRequest`; `Provider.probe` | PY-02 (RateLimit) · PY-03 (probe) |
| `providers/claude/mapping.py` | sửa | `rate_limit_event` phát cả `allowed`/`allowed_warning`/`rejected` + type/util/shape | PY-02 |
| `runtimes/cli/host_proc.py` · `outcome.py` | sửa | `_rate_limit`: log `claude.rate_limit`; `Seen.warning`; `broken_of` dùng `cooldown_until` (R02) + type/util; `Verdict.warning` | PY-02 |
| `db/provider_state_sql.py` · `db/finish_sql.py` | sửa | `PROVIDER_OK`, `MARK_BROKEN` (6 tham số), `ENSURE_ROW`, `NOTE_WARNING`; `FinishTx.warning` | PY-02 |
| `providers/fake/provider.py` · `directives.py` | sửa | `#fake:ratelimit=<ts>[,<type>]`, `#fake:ratewarn=<util>[,<ts>]` (§5) | PY-02 |
| `providers/claude/probe.py` · `providers/fake/probe.py` | mới | lượt (b) trong process con | PY-03 |
| `runtimes/cli/probe/{__init__,auth,turn,child}.py` | mới | (a) `auth status`; (b) spawn/giám sát con probe; điểm vào con | PY-03 |
| `db/probe_sql.py` | mới | SQL + `apply_probe` (`plan-db` §3–4) | PY-04 |
| `queue/probe_loop.py` | mới | vòng probe (§4) | PY-04 |
| `queue/runtime.py` | sửa | khởi động: probe thay reset mù (PL2); thêm service | PY-04 |
| `pyproject.toml` | sửa | import-linter: `runtimes.cli.probe.child` vào 2 hợp đồng "process con" (cấm `config`/`db`/`events`); `runtimes.cli.quota_rules` vào "Lõi thuần" | PY-00 |

## 2. Kiểu nội bộ (pydantic, `extra="forbid"`, không phải contract)
| Kiểu | Trường | Ghi chú |
|---|---|---|
| `RateLimit` (sửa) | `status: str` (giữ) · `resets_at: int \| None` (giữ) · **+** `rate_limit_type: str \| None = None` (≤ 40) · `utilization: float \| None = None` · `raw_shape: dict[str, str] \| None = None` (≤ 30 khoá, khoá ≤ 60 ký tự, giá trị = tên kiểu Python `str`/`int`/`float`/`bool`/`NoneType`/`dict`/`list`) | trường mới tuỳ chọn ⇒ dòng sự kiện cũ vẫn parse; `status` thêm giá trị `allowed`, `allowed_warning` (cha bỏ qua `allowed` trong job) |
| `ProbeRequest` (mới) | `provider_key: str` · `work_dir: str` · `cli_path: str \| None` · `fake: str \| None` (chỉ thị `fake-cli`, cha đọc từ file §5) | dòng stdin đầu của con probe |
| `Provider.probe(req: ProbeRequest, emit: Emit) -> None` | Protocol thêm phương thức | `ClaudeProvider`, `FakeProvider` cài |
| `ProbeSeen` (cha, dataclass) | `rate_limit: RateLimit \| None` · `final: Final \| None` · `fatal: Fatal \| None` · `usage: UsageEv \| None` | gom sự kiện con |
| `ProbeResult` (cha, dataclass) | `kind: Literal["ok","cooldown","logged_out","error"]` · `until: datetime \| None` · `rate_limit_type` · `utilization` · `warning: Warning \| None` · `message: str` (≤ 500, không PII) · `tokens: (in, out)` · `ms: int` · `step: Literal["auth","turn"]` | đầu vào `apply_probe` + log |

## 3. Luật thuần — `runtimes/cli/quota_rules.py` (qc unit `tests/acceptance/test_quota_rules.py`)
```python
COOLDOWN_MAX = timedelta(days=8)
RATE_TYPE_RE = re.compile(r"^[a-z0-9_]{1,40}$")
@dataclass(frozen=True) class Warning: utilization: float | None; rate_limit_type: str | None; window: datetime
@dataclass(frozen=True) class ProviderSnap:
    status: str | None            # None = chưa có hàng provider_state
    cooldown_until: datetime | None; last_probe_at: datetime | None; last_ok_at: datetime | None
    consecutive_errors: int; updated_at: datetime | None; db_now: datetime
@dataclass(frozen=True) class ProbeCfg: probe_s: int; logged_out_s: int
Transition = Literal["healthy", "recover", "seen", "broken", "error"]

def cooldown_until(resets_at: int | None, now: datetime, default_s: int) -> datetime   # R02
def clean_type(value: object) -> str | None                                             # regex, sai ⇒ None
def clean_util(value: object) -> float | None                                           # số hữu hạn ∈ [0,1], sai ⇒ None (bool ⇒ None)
def warn_window(resets_at: int | None, now: datetime) -> datetime                       # R03
def raw_shape(raw: Mapping[str, object] | None) -> dict[str, str] | None                # R04
def probe_due(snap: ProviderSnap, cfg: ProbeCfg, *, startup: bool) -> bool              # R12, R13
def auth_logged_in(exit_code: int, stdout: bytes) -> bool | None                        # R14(a)
def probe_result(auth: bool | None, seen: ProbeSeenLike | None, *, timed_out: bool, now: datetime, default_s: int) -> ProbeResult  # R14(b), R01
def probe_transition(snap: ProviderSnap, result: ProbeResult) -> Transition             # R15
def parse_fake_probe(text: str | None) -> FakeProbe                                     # R18
```
| Hàm | Điều kiện chính xác |
|---|---|
| `cooldown_until` | `resets_at` int ∧ `now < ts(resets_at) ≤ now + COOLDOWN_MAX` ⇒ `ts(resets_at)` (UTC); ngược lại ⇒ `now + default_s` |
| `warn_window` | `resets_at` hợp lệ như trên ⇒ `ts(resets_at)`; ngược lại ⇒ `now` cắt về đầu giờ (UTC) |
| `raw_shape` | None/không phải Mapping ⇒ None; ≤ 30 khoá đầu theo thứ tự, khoá `str` cắt 60 ký tự; giá trị ⇒ `type(v).__name__`; **không** chép giá trị |
| `probe_due` (`now = snap.db_now`) | `status is None` ⇒ True · `cooldown`: `cooldown_until is None or (cooldown_until <= now and (last_probe_at is None or last_probe_at < cooldown_until))` (khởi động cũng vậy — PL3) · `logged_out`: `startup or last_probe_at is None or now − last_probe_at ≥ logged_out_s` · `error`: `startup or last_probe_at is None or now − last_probe_at ≥ probe_s` · `ok`/`busy`: `last_ok_at is not None and now − last_ok_at < probe_s` ⇒ False (R12, cả khi khởi động); còn lại `startup or last_probe_at is None or now − last_probe_at ≥ probe_s` · `cfg.probe_s == 0` ⇒ False |
| `auth_logged_in` | `exit_code ≠ 0` ⇒ False (S1 #4: exit 1 khi chưa đăng nhập) · exit 0 ∧ JSON object có `loggedIn` kiểu bool ⇒ giá trị đó · exit 0 mà parse sai / thiếu khoá / sai kiểu ⇒ None (= lỗi probe, PL7) |
| `probe_result` | `auth is None` ⇒ `error` · `auth is False` ⇒ `logged_out` (step `auth`) · `seen is None` (R12 không cho (b) — không xảy ra trong vòng; dành cho test) ⇒ `ok` · `timed_out` ⇒ `error` · tín hiệu R01 theo thứ tự: `rate_limit.status == "rejected"` ⇒ `cooldown(cooldown_until(...))`; `rate_limit.status == "logged_out"` (từ `result_signal` 401/AUTH_RE) ⇒ `logged_out`; `fatal` ⇒ `error`; `final is None` ⇒ `error`; `final.is_error` ⇒ `classify_text` (patterns H2b) rate ⇒ `cooldown`, auth ⇒ `logged_out`, khác ⇒ `error`; còn lại ⇒ `ok`. `ok` kèm `warning` khi `rate_limit.status == "allowed_warning"`. `rate_limit_type`/`utilization` qua `clean_*` |
| `probe_transition` (`s = snap.status or "ok"`) | `ok`: `s ∈ {ok,busy}` ⇒ `healthy`; còn lại ⇒ `recover` · `cooldown`/`logged_out`: cùng `s` ∧ (`logged_out` hoặc `until == snap.cooldown_until`) ⇒ `seen`; ngược lại ⇒ `broken` · `error`: ⇒ `error` (`apply_probe` tự xét ngưỡng; `s ∉ {ok,busy}` chỉ đếm, không đổi status — PL5) |
| `parse_fake_probe` | §5 |

Unit (AC-01, AC-02 vế thuần, probe_due bảng đủ 5 trạng thái × startup, auth 5 ca, raw_shape không giá trị, parse_fake_probe): `tests/acceptance/test_quota_rules.py` (qc, khoá trước PY-01).

## 4. Probe
### 4.1 (a) `runtimes/cli/probe/auth.py` — `async def auth_status(cfg: ProbeHostCfg, key: str) -> tuple[bool | None, int]` (kết quả, ms)
- CLI: `Settings.cli_path` nếu có; ngược lại bundled: `Path(importlib.util.find_spec("claude_agent_sdk").submodule_search_locations[0]) / "_bundled" / "claude"` (cùng đường `SubprocessCLITransport._find_bundled_cli`, không import gói). Không có file ⇒ `None` (lỗi probe).
- `asyncio.create_subprocess_exec(cli, "auth", "status", "--json", cwd=probe_dir, env=job_host_env(home, probe_dir, app_env), stdin=DEVNULL, stdout=PIPE, stderr=DEVNULL, start_new_session=True)`; hạn `AUTH_TIMEOUT_S = 15` ⇒ `pg.kill_group` ⇒ `None`. Đọc stdout tối đa 64 KiB ⇒ `auth_logged_in` ⇒ bỏ bytes. **Không log stdout/stderr** (email/orgId — K7).
- `fake-cli`: không chạy process; `parse_fake_probe(file)`: `logged_out` ⇒ False, còn lại ⇒ True; ghi `auth` vào file đếm (§5).
- `probe_dir = <work_dir>/.probe/<key>` (mkdir 0700 mỗi lượt, `TMP_SUBDIR` bên trong).

### 4.2 (b) `runtimes/cli/probe/turn.py` — `async def probe_turn(cfg, key, fake: str | None) -> tuple[ProbeSeen, bool]` (seen, timed_out)
- Spawn `python -m agent_runtime.runtimes.cli.probe.child --provider=<key>` như `HostProcess.spawn` (env `job_host_env` + `VIRTUAL_ENV`/`PYTHONPATH`, `start_new_session=True`, `pg.track_host`), stdin một dòng `ProbeRequest`, stdout `StdoutPipe` + `parse_event` (`MAX_LINE_BYTES`), stderr ⇒ `DEVNULL` (PL9). Hạn `AGENT_RT_PROBE_TIMEOUT_S` ⇒ `pg.kill_group(pgid, grace=kill_grace_s)` ⇒ `timed_out=True`. Huỷ (shutdown) ⇒ giết group trong `finally`.
- Con (`probe/child.py`, mẫu `runtimes/cli/child.py`): đọc `ProbeRequest`, `get_provider(key, APP_ENV)`, `provider.probe(req, emit)`; lỗi bất ngờ ⇒ `Fatal(INTERNAL_ERROR, "provider error: <TypeName>")`.
- `ClaudeProvider.probe` (`providers/claude/probe.py`): `ClaudeAgentOptions(model="haiku", system_prompt=PROBE_SYSTEM, tools=[], allowed_tools=[], mcp_servers={}, setting_sources=[], max_turns=1, cwd=req.work_dir, cli_path=req.cli_path, env=<không thêm>)`; `PROBE_SYSTEM = "Reply ok."`, `PROBE_PROMPT = "Reply with: ok"` (Spike S1 #8). Duyệt message như job: `RateLimitEvent` ⇒ `rate_limit_event` (§2), `ResultMessage` ⇒ `result_signal` + `UsageEv` + `Final(kind="text")` (**không** emit nội dung trả lời — `text=None`). Không hook, không session, không resume.
- `FakeProvider.probe`: theo `req.fake` (§5): `ok` ⇒ `RateLimit(allowed, five_hour)` + `UsageEv(in=10,out=1)` + `Final(text)`; `rejected` ⇒ `RateLimit(rejected, resets_at, type)` + `Final(is_error)`; `revoked` ⇒ `Final(is_error, api_error_status=401)` + `RateLimit(logged_out)`; `warning` ⇒ `RateLimit(allowed_warning, util, resets_at)` + `Final`; `hang` ⇒ `await asyncio.Event().wait()`; `error` ⇒ `Fatal(UPSTREAM_ERROR)`.

### 4.3 Vòng — `queue/probe_loop.py` `ProbeLoop(pool, events, cfg).run()` (service trong `QueueRuntime.services()` khi `probe_s > 0`)
1. Nhịp `tick_s = min(5, logged_out_s, probe_s)`; lượt đầu `startup=True`, sau đó False. Đồng hồ/ngủ tiêm được (`sleep: Callable`) cho unit.
2. `PROBE_TARGETS(providers claim được − HTTP_PROVIDERS)`; với mỗi hàng `probe_due(snap, cfg, startup)` (tuần tự từng provider):
3. Lấy một kết nối pool riêng cho lượt: `PROBE_TRY_LOCK` false ⇒ log `probe.skipped{provider, reason:"locked"}` (debug), bỏ. Có khoá ⇒ `PROBE_SNAPSHOT`; `probe_due` lại (startup giữ cờ) false ⇒ `skipped reason:"recent"` (Runtime khác vừa probe).
4. (a) `auth_status` ⇒ False/None ⇒ kết quả, **không** chạy (b). True ⇒ (b) `probe_turn` ⇒ `probe_result`.
5. `apply_probe(conn, key, snap, result)` (`plan-db` §4) ⇒ `None` ⇒ log `probe.stale{provider}`; có ⇒ XADD queued, log chuyển trạng thái (§7).
6. `finally`: `PROBE_UNLOCK` dưới `asyncio.shield`; lỗi ⇒ `conn.terminate()`. Lỗi DB/Redis trong lượt ⇒ log `probe.failed{provider, error:<TypeName>}` (warn), vòng tiếp tục (không làm chết TaskGroup).

### 4.4 Khởi động (`queue/runtime.py`, PL2)
`probe_s > 0`: **bỏ** `jobs_sql.reset_providers` ở `start()`; vòng probe chạy lượt `startup=True` ngay khi services bắt đầu (không chặn mốc "sẵn sàng"). `probe_s == 0`: giữ reset mù H1 (dev). Test khoá `orphan_int_test::test_wrk_restart_resets_provider_state` (về `ok` ≤ 10 s) xanh nhờ lượt khởi động (`fake-cli` mặc định `ok`); `test_wrk_restart_keeps_cooldown` xanh nhờ `probe_due` không probe `cooldown` chưa hết hạn.

## 5. `fake-cli` (R18)
| Chỗ | Cú pháp | Tác dụng |
|---|---|---|
| Probe | file `AGENT_RT_FAKE_PROBE_FILE` (đọc **mỗi lượt** bởi cha; vắng file/rỗng ⇒ `ok`); dòng đầu: `ok` · `rejected[:<resets_at>[:<type>]]` · `logged_out` · `revoked` · `warning:<util>[:<resets_at>]` · `hang` · `error` | §4.1–4.2; giá trị sai cú pháp ⇒ `error` |
| Đếm lời gọi | cha ghi thêm một dòng `auth` / `turn` vào `<AGENT_RT_FAKE_PROBE_FILE>.calls` trước mỗi bước | AC-09 "0 lời gọi provider" |
| Job | `#fake:ratelimit=<ts>[,<type>]` (mở rộng H1, `ts` vắng ⇒ không `resets_at`) · `#fake:ratewarn=<util>[,<ts>]` ⇒ `RateLimit(allowed_warning)` rồi chạy tiếp như `ok` | AC-03, AC-01 vế job |

## 6. Env (`config.py`, prefix `AGENT_RT_`)
| Biến | Mặc định | Biên production | Biên development/test (PL6) |
|---|---|---|---|
| `PROBE_S` | 1200 | 0 (tắt) hoặc 60–3 600 | 0 hoặc 1–3 600 |
| `PROBE_LOGGED_OUT_S` | 60 | 10–600 | 1–600 |
| `PROBE_TIMEOUT_S` | 60 | 10–300 | 1–300 |
| `COOLDOWN_DEFAULT_S` | 1800 | 60–86 400 | 1–86 400 |
| `FAKE_PROBE_FILE` | — | đặt ở production ⇒ không khởi động | đường dẫn tuyệt đối |

Sai biên ⇒ `ValidationError` ⇒ Runtime thoát (như H1 env). `HostConfig` mang `cooldown_default_s` (job dùng `cooldown_until`) và cấu hình probe (`ProbeHostCfg`: `python`, `home`, `work_dir`, `app_env`, `cli_path`, `kill_grace_s`, `timeout_s`, `fake_file`). `safe_summary()` thêm 4 khoá số.

## 7. Log (structlog, không PII)
| Sự kiện | Mức | Trường |
|---|---|---|
| `claude.rate_limit` | info | `provider`, `source` (`job`/`probe`), `status`, `rate_limit_type`, `utilization`, `resets_at`, `keys` (= `raw_shape`) — job: kèm `job_id`, `run_id` |
| `provider.cooldown` | warn | `provider`, `until`, `type`, `source` |
| `provider.quota_warning` | warn | `provider`, `utilization`, `type`, `resets_at` — chỉ khi `NOTE_WARNING.first` |
| `provider.logged_out` | warn | `provider`, `source` |
| `provider.recovered` | info | `provider`, `from` |
| `probe.result` | info | `provider`, `ok`, `outcome`, `step` (`auth`/`turn`), `ms`, `input_tokens`, `output_tokens` |
| `probe.skipped` · `probe.stale` · `probe.failed` | debug · info · warn | `provider`, `reason`/`error` (tên kiểu) |
Cấm: stdout/stderr `auth status`, email, `organization`, token, prompt/câu trả lời probe. `provider.broken` H1 (runner) giữ.

## 8. Test và giả lập (qc)
| Lớp | File | AC |
|---|---|---|
| Unit thuần (khoá trước PY-01) | `tests/acceptance/test_quota_rules.py` | AC-01, AC-02 (thuần), `probe_due`, `auth_logged_in`, `raw_shape`, `parse_fake_probe`, `probe_transition` |
| Unit cạnh code (backend-lead) | `providers/claude/test_probe.py` (SDK giả như `test_provider.py`), `runtimes/cli/probe/test_auth.py` (script giả in JSON/exit 1/treo), `queue/test_probe_loop.py` (đồng hồ tiêm, pool giả) | — |
| Python int (`fake-cli`, `AGENT_RT_FAKE_PROBE_FILE`, biên dev nhỏ) | `tests/acceptance/probe_int_test.py`, `quota_int_test.py` | AC-03, AC-04 (Runtime không claim; job `queued` fail khi probe/job chuyển `cooldown`), AC-08, AC-09, AC-10, AC-11 |
| Stack (hub-dev + Runtime thật `fake-cli`) | `tests/acceptance/H3a/stack/*.test.ts` | AC-W02, AC-05 |

## 9. Đối chiếu Hub ↔ Runtime
| # | Điểm | Hub | Runtime |
|---|---|---|---|
| F1 | reason job `queued` bị fail | đọc `jobs.error_reason` ⇒ `runErrorTextFor` | `Broken.reason`: `cooldown` ⇒ `quota`; `logged_out`/`error` ⇒ `provider_unavailable` (H1, giữ) |
| F2 | điều kiện chặn | `providerBlocked` (JS `now`) | `CLAIM_SELECT` (DB `now()`) — giữ H1 |
| F3 | cột mới | Drizzle `schema/hub.ts` chỉ khai báo, Hub không đọc | Runtime ghi |

## 10. TECH-DEBT dự kiến
- Probe (b) không chiếm slot `max_concurrency`/`max_concurrent_sub` (không phải job) — chấp nhận (1 lượt nhỏ ≤ 20 phút/lần).
- `busy` vẫn không được ghi ở đâu (H1).
