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
