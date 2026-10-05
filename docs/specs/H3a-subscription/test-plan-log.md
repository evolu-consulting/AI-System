# Test plan · H3a-subscription · nhật ký chạy (qc)

Kết quả "đỏ đúng lý do" (`WORKFLOW.md` "Luật khoá test") theo task. Phụ lục của [`test-plan.md`](test-plan.md).

## QW-PU · unit Python thuần `apps/agent-runtime/tests/acceptance/test_quota_rules.py` (P01–P12)

Chạy 2026-10-06 trong WSL (venv `~/.venvs/agent-runtime`, `RUFF_CACHE_DIR=/tmp/rc`), code hiện tại = stub PY-00:
- `ruff check` + `ruff format --check`: sạch · `pyright tests/acceptance/test_quota_rules.py`: 0 lỗi.
- `pytest tests/acceptance/test_quota_rules.py`: **144 ca — 139 đỏ, 5 xanh**.
  - 139 đỏ **đúng lý do**: cả 139 đều `NotImplementedError` từ thân stub `quota_rules` (P01–P10); 0 lỗi dựng dữ liệu / import / `TypeError` / `ValidationError`.
  - 5 xanh trước code (dự kiến): P11 (hằng `COOLDOWN_MAX`, regex type) · P12 ×4 (`mapping.result_signal` H1: 429 thắng chữ auth, 401 ⇒ `logged_out`, chữ usage limit ⇒ `rejected`, `is_error=False` ⇒ `None`).

| ID | Hàm | Số ca | Kết quả hiện tại |
|---|---|---|---|
| P01 | `cooldown_until` | 7 | đỏ `NotImplementedError` |
| P02 | `clean_type` | 10 | đỏ `NotImplementedError` |
| P03 | `clean_util` | 11 | đỏ `NotImplementedError` |
| P04 | `warn_window` | 5 | đỏ `NotImplementedError` |
| P05 | `raw_shape` | 7 | đỏ `NotImplementedError` |
| P06 | `probe_due` | 31 (24 dòng bảng + 6 `probe_s=0` + `db_now`) | đỏ `NotImplementedError` |
| P07 | `auth_logged_in` | 9 | đỏ `NotImplementedError` |
| P08 | `probe_result` | 15 | đỏ `NotImplementedError` |
| P09 | `probe_transition` | 20 | đỏ `NotImplementedError` |
| P10 | `parse_fake_probe` | 24 | đỏ `NotImplementedError` |
| P11 | hằng | 1 | xanh |
| P12 | `mapping.result_signal` | 4 | xanh |

Ghi chú cho PY-01:
- `seen` của `probe_result` trong test là đối tượng vịt (`rate_limit` có `status`, `resets_at`, `rate_limit_type`, `utilization`, `raw_shape`; `usage: UsageEv`) vì `RateLimit` chỉ có trường mới từ PY-02 — thân PY-01 đọc thuộc tính, không `isinstance(RateLimit)`.
- P11 dùng `RATE_TYPE_PATTERN` (tên trong stub PY-00) thay `RATE_TYPE_RE` của `rt §3`; nếu PY-01 thêm `RATE_TYPE_RE` thì vẫn phải giữ `RATE_TYPE_PATTERN`.
- `probe_result` bước (b) trả `step="turn"`; `message` không chép chữ của `final.text`.
- Chưa khoá: Q-PU (`test:lock:write`) là bước riêng.

## QW · TS: unit `tests/acceptance/H3a/rules/` (QW-R) + int Hub `tests/acceptance/H3a/*.int.test.ts` (QW-A) + T1

Chạy 2026-10-06 trên code hiện tại (stub B0 `blockedReason` ném `not implemented`, `runErrorTextFor` chưa đọc reason H3a; D1 có), DB Hub riêng của qc `ai_system_h3a_qw_hub_test` (`HUB_TEST_DATABASE_URL`/`AGENT_RT_TEST_DATABASE_URL` export trong shell, đè `.env.local`), Redis DB 15; chạy **tuần tự** từng file: `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H3a/<file>`. `tsc -p tsconfig.tests.json`: 0 lỗi ở `H3a/`, `H2b/direct`; biome sạch; `check:size` OK. Chưa khoá (Q2 là bước riêng).

**QW-R** `bun test ./tests/acceptance/H3a/rules` → **16 ca / 3 file: 10 đỏ, 6 xanh**.

| File | ID | Đỏ đúng lý do / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `rules/blocked-reason.test.ts` | R01–R05 | 5/5 | stub `blockedReason` ném `not implemented` | — |
| `rules/run-errors-h3a.test.ts` | R10–R18 | 5/9 | R10–R13, R17: `expect` — `runErrorTextFor` trả câu H1 thay câu R08 | R14, R15, R16, R18 (hồi quy câu H1/H2c — đúng) |
| `rules/contracts-h3a.test.ts` | R20–R21 | 0/2 | — | R20, R21 (contract không đổi, P2 — đúng) |

**QW-A** — **26 ca / 6 file: 14 đỏ, 12 xanh**. 0 đỏ ở dựng dữ liệu (`beforeAll`, SQL `provider_state`, seed). Khoá provider của Orchestrator/agent trong fixture H1 (`_hub.ts`, profile `fake-1`) là **`fake-cli`** (cases §2 "Chung" đã xác nhận) — `_h3a.ts` `PROVIDER`.

| File | ID | Đỏ đúng lý do / tổng | Lý do đỏ | Xanh trước code (lý do) · ms thực |
|---|---|---|---|---|
| `blocked.int.test.ts` | A01–A08 | 7/8 | A01–A05: `run.failed` message/hint = câu H1 thay R10–R13 (0 job, code đúng); A06: `GET /runs/:id` = SSE (cùng nguồn — qua) rồi lệch câu R08; A07: message ≠ R08 | A08 (cooldown hết hạn ⇒ có job — hồi quy H1). Chặn → `run.failed` 96–288 ms (≤ 3 000) |
| `queue-wait.int.test.ts` | A10–A13 | 2/4 | A10, A11: `jobs.error_reason` = `provider_busy` thay `quota`/`provider_unavailable` (hết hạn sau 2,2–2,4 s — trong [2, 6]) | A12 `tenant_slots` + câu H1; A13 cooldown đã hết ⇒ `provider_busy` (queueTimeoutReason không đổi) |
| `job-reason.int.test.ts` | A14–A17 | 4/6 | A14 vi/en, A15, A17: câu H1 thay R08 (1 job, 1 kết thúc — qua) | A16 `provider_busy`/`null` ⇒ câu H1 |
| `command.int.test.ts` | A18–A19 (A09) | 0/2 | — | A18 `/dich` sync → `run.finished`, MK 1 `/v1/workflows/run`, 0 job `fake-cli`; A19 `/dich-async` → job `workflow.async` `dify` (R10: đã đúng từ H2a) |
| `db.int.test.ts` | A20–A23 | 0/4 | — | D1 đã có (6 cột, CHECK `23514`, GRANT; `usage_logs` 20 cột như trước H3a) |
| `compat.int.test.ts` | A24–A25 | 1/2 | A25: `run.failed` hợp schema chat nhưng message ≠ R08 | A24 test-run không bị chặn khi cooldown |

**T1** `tests/acceptance/H2b/direct.int.test.ts` A25: 14 ca, **1 đỏ đúng lý do** (`ALL_PROVIDERS_EXHAUSTED` + `quota`: Received câu H1 "Tất cả dịch vụ AI đang quá tải…", Expected R10), 13 xanh (gồm A25 `TIMEOUT`).

**Lệch cases (ghi rõ):**
1. A24: test-run Admin (`/internal/test-run`) chạy Dify sync, **không tạo job** ⇒ không dựng được "job fail `ALL_PROVIDERS_EXHAUSTED`+`quota`" qua int (bài học H2c B9). Kiểm vế dựng được: provider `cooldown` không chặn test-run, phản hồi hợp `TestRunResponseSchema`, `ok:true` (PL13: test-run ngoài R08).
2. A09 không có ca riêng — trùng A18 (cases §2.1 "xem A18").
3. Bảng R08 đặt ở `tests/acceptance/H3a/_r08.ts` (thuần, không nạp fixture DB) và `_h3a.ts` re-export — unit `rules/` không phải nạp `H1/_fixtures.ts` (đòi biến DB lúc import). Lock phải gồm cả `_r08.ts`, `_h3a.ts`.
4. A23 danh sách cột `usage_logs` gồm `job_id`, `cache_read_tokens`, `cache_write_tokens` (thêm trước H3a) — snapshot "không đổi" so với trạng thái trước H3a.

### Tranh chấp test T1
| # | Test | Phán quyết | Sửa | Kết quả |
|---|---|---|---|---|
| T1 | H2b `direct.int.test.ts` A25 (dòng 225–231 cũ): job agent trực tiếp fail `ALL_PROVIDERS_EXHAUSTED` + reason `quota` ⇒ kỳ vọng `message = runErrorText(code, "vi").message` (câu H1 "quá tải") | **Test sai theo BA mới**: HUB-BR-04 / H3a-R08 — reason `quota` ⇒ câu "Dịch vụ AI đã dùng hết hạn mức của gói hiện tại."; R19/`plan` P11: BA thắng. qc tự phân xử (dự kiến từ PLAN, không cần agent code nêu) | Giữ vòng `["ALL_PROVIDERS_EXHAUSTED","TIMEOUT"]` + reason; EXHAUSTED ⇒ `runErrorTextFor(code, "vi", "quota").message` **và** chuỗi nguyên văn R10 (`R08.quota.vi`); `TIMEOUT` giữ `runErrorText`. Tên thêm `[H3a-R08]`, comment trỏ mục này | Đỏ đúng lý do tới B1; Q2: `test:lock:verify` phải ra đúng 1 `CHANGED tests/acceptance/H2b/direct.int.test.ts` + `UNLOCKED` H3a |

## Q2 + Q-PU — khoá lần 1 (điều phối, 2026-10-06)
`test:lock:verify` trước khi ghi: đúng 12 UNLOCKED (11 file `tests/acceptance/H3a/**` gồm `_h3a.ts`, `_r08.ts`; `apps/agent-runtime/tests/acceptance/test_quota_rules.py`) + 1 CHANGED (`tests/acceptance/H2b/direct.int.test.ts` — T1, R19) → `test:lock:write` → verify OK (364 file).

## QW-P · Python int `probe_int_test.py` (P20–P39), `quota_int_test.py` (P40–P49) + stack `H3a/stack/` (S01–S04)

Chạy 2026-10-06 trên code hiện tại (PY-01 + PY-02 + B1 có; **chưa** PY-03/PY-04: không có con probe, vòng probe, `probe_sql`; khởi động vẫn reset mù H1). Python trong WSL (venv `~/.venvs/agent-runtime`), DB riêng `ai_system_h3a_qwp_hub_test` (`HUB_TEST_DATABASE_URL`/`AGENT_RT_TEST_DATABASE_URL` export, `ensure_schema` áp tới `0008`), Redis DB 15; DB đã drop sau khi chạy. `ruff check` + `ruff format --check` + `pyright` 3 file Python: sạch; `tsc -p tsconfig.tests.json` (H3a/stack): 0 lỗi; biome sạch; `check:size` OK.

**Python** `pytest -m int tests/acceptance/{probe_int_test,quota_int_test}.py` → **36 ca: 20 đỏ, 16 xanh**. 0 đỏ ở dựng dữ liệu (fixture `ctx`, `set_state`, `add_job`, khởi động Runtime với env probe — config PY-00 nhận `AGENT_RT_FAKE_PROBE_FILE`/biên dev).

| File | ID | Đỏ đúng lý do / tổng | Lý do đỏ | Xanh trước code (lý do) |
|---|---|---|---|---|
| `probe_int_test.py` | P20–P39 | 18/20 | mọi ca đỏ ở `wait_until` (AssertionError "quá 15 s chưa thấy": `provider_state` `logged_out`/`cooldown`/`ok`/`error`, `last_probe_at`, `.calls` có `turn`, log `probe.result`) — chưa có vòng probe (PY-03/04); P30 thấy reset mù H1 (`ok`) thay `logged_out` | P28 (`last_ok_at` mới ⇒ 0 lời gọi — đúng vì chưa probe; sau PY-04 phải giữ xanh), P31 (`PROBE_S=0` ⇒ reset mù H1 — hồi quy) |
| `quota_int_test.py` | P40–P49 | 2/16 | P43 ×2 (`logged_out`, `error`): chờ `last_probe_at ≥ jobs.created_at` quá 15 s (chưa có vòng probe) | P40, P41, P42 ×4, P44, P45, P46 ×2, P47, P48 ×2, P49 — vế job PY-02 đã làm (chỉ thị `#fake:ratelimit`/`#fake:ratewarn`, `NOTE_WARNING`, log `provider.cooldown`/`logged_out`/`quota_warning`/`claude.rate_limit`) |

**Stack** `bun run test:h3a:stack` → **4 ca: 1 đỏ, 3 xanh** (container `qc-h3a-stack-quota`, ~29 s).

| ID | Kết quả | Ghi chú |
|---|---|---|
| S01 | xanh | `run.failed ALL_PROVIDERS_EXHAUSTED` + câu R08 quota vi, **2 535 ms** (≤ 5 000); `cooldown_until` = ts |
| S02 | xanh | 1 job, `attempts=1`, `failed`, `quota` |
| S03 | xanh | chặn trước enqueue **124 ms** (≤ 3 000), 0 job mới |
| S04 | **đỏ đúng lý do** | `cooldown_until = now()+2 s` ⇒ 20 s vẫn `cooldown` (`expect(...).toBe("ok")`) — chưa có probe (PY-04) |

**Quyết định / lệch test-plan (ghi rõ):**
1. Helper Python `apps/agent-runtime/tests/acceptance/_h3a.py` (test-plan §2.1): `start(ctx, probe_s, worker, timeout_s, **env)` đặt env probe (N1: timeout 10, ca treo P22/P38 = 2) + `AGENT_RT_FAKE_PROBE_FILE=<tmp_path>/probe.txt`; `set_state` UPSERT bằng biểu thức SQL; `until_log` chờ dòng log (F6; `from_=` ⇒ khoá `from`); `probe_children` = pid có ppid = Runtime và cmdline chứa `probe`; `owner_conn` kết nối owner thứ hai (P37 giữ `K_CLAIM` ngoài `ctx.conn` để `now()` không đóng băng).
2. Mức log "warn" chấp nhận `warn`|`warning` (structlog `add_log_level` ghi `warning`).
3. P22: kỳ vọng dãy `consecutive_errors` quan sát được tăng 1→2(→3) không nhảy và cuối `status=error` — không ép giá trị 3 trong hàng (plan-db §4 nhánh `error` chạm ngưỡng đi như `broken`, không qua `PROBE_ERROR`); con probe: tối đa 1 pid còn sống (lượt đang chạy).
4. P35: quét PII chỉ trên log `probe.*`/`provider.*`/`claude.*` — `runtime.start` có URL DB dạng `user:***@host` (H1, không phải PII probe).
5. P38: dùng 2 Runtime nối tiếp trong ca (`qc-1` probe `ok` rồi kiểm `pg_locks` = 0 và tắt; `qc-2` file `hang`, SIGTERM ngay khi thấy con probe ⇒ con biến mất ≤ 5 s).
6. `quota_int_test` (trừ P43) đặt `AGENT_RT_PROBE_S=0` để chỉ đo đường job (sau PY-04 probe mặc định không chen `last_ok_at`/`utilization`); P43 bật probe `PROBE_S=2`.
7. Stack: `_stack.ts` dùng lại `bootStackH2b` (khoá) với env H3a; thêm `startRuntimeBoxH3a(name, worker, hubUrl, env)` (thêm `hubUrl` so với test-plan — `startRuntimeH2a` cần); `bootStackH3a` đặt `HUB_ATTACH_DIR` tạm vì script `test:h3a:stack` (MK) bật `HUB_ATTACH_DRIVER=local` (mẫu H2c); `afterAll` đưa `provider_state` về `ok` + xoá file chỉ thị (F5).
8. F1 (chạy `pytest -m int` toàn bộ 3 lần) để lại cho PY-04 — QW-P không đổi fixture khoá (`_rt.py`, `_proc.py`, `conftest.py`).

**Cần khoá ở Q3** (5 file mới): `apps/agent-runtime/tests/acceptance/{_h3a.py,probe_int_test.py,quota_int_test.py}`, `tests/acceptance/H3a/stack/{_stack.ts,quota.stack.test.ts}`.
