# Plan · H3a-subscription (tổng + Hub TS)

Python (probe, tín hiệu quota): [`plan-runtime.md`](plan-runtime.md). SQL nguyên văn + migration: [`plan-db.md`](plan-db.md). Luật: spec §2 (R01–R20). Quyết định người dùng: `spec-decisions` U1–U5, Spike S1. Chính xác hoá spec trong PLAN: `spec-decisions` "Quyết định trong lúc làm" PL1–PL14. Nền: H1 `plan-db` §5.4 (SQL provider/Kết thúc), H1 `plan-runtime` §3.3 (luật provider), H2c `plan.md` P8 (thứ tự khoá).

## 1. Quyết định
| # | Quyết định | Lý do / nguồn |
|---|---|---|
| P1 | Q1–Q7 = mặc định A; chu kỳ probe 20 phút; probe = (a) `auth status --json` CLI **bundled** + (b) một lượt haiku | U5, Spike S1 |
| P2 | **Contract không đổi**: `@ai/contracts/chat`, `hub`, `hub-internal` giữ nguyên (`JOB_FAIL_REASONS` đã có `quota`, `provider_unavailable`). Probe không đi qua `hub.jobs`/Redis/HTTP ⇒ không cần kiểu `ProbeResult` trong contract; dữ liệu Runtime ↔ con probe là kiểu nội bộ pydantic (`providers/base.py`, như `ChildRequest`) | spec §3 (phác "có thể") — Luật 2: phương án đơn giản nhất |
| P3 | Migration mới `0008_h3a_provider_state.sql`: 6 cột NULL + 2 CHECK trên `hub.provider_state`; không bảng mới, không index mới (bảng ≤ vài hàng, tra PK), GRANT không đổi (quyền bảng phủ cột mới) | spec §4, CONVENTIONS §8 |
| P4 | Câu lỗi R08 chỉ đổi `runErrorTextFor` (đọc `reason`); `runErrorText(code)` giữ nguyên (test khoá H1 `rules/run-errors.test.ts`) | R08, R19 |
| P5 | Hub: hàm thuần mới `blockedReason(state, now)` cạnh `providerBlocked` (giữ nguyên) → dùng ở **trước enqueue** (R09) và ở **hết hạn chờ `queued`** (R06: provider đang chặn ⇒ reason theo provider, ngược lại `queueTimeoutReason` H1 không đổi chữ ký — test khoá H1 R10) | R06, R09 |
| P6 | Probe là **vòng lặp trong Runtime** (`queue/probe_loop.py`), không phải job; khoá **phiên** `pg_try_advisory_lock(hashtext('hub.provider.probe'), hashtext(key))` (dạng 2×int4 — không đụng không gian khoá `K_CLAIM` 1×bigint) | Q4=A, R11 |
| P7 | Lượt (b) chạy trong **process con riêng** `python -m agent_runtime.runtimes.cli.probe.child` (process group riêng, env tường minh `job_host_env`, cwd `<work_dir>/.probe/<key>`); cha không nạp `claude_agent_sdk` | CONVENTIONS §9 subprocess; H1 review #8 (cha không nạp SDK) |
| P8 | Áp kết quả probe: **khoẻ → khoẻ** = một UPSERT (không `K_CLAIM`); **hỏng ↔ khác** = transaction ngắn sau khi probe xong: `K_CLAIM → jobs (fail queued) → provider_state`, rào `updated_at` snapshot (R15) | R15, §6 "probe không giữ `K_CLAIM`" — khoá chỉ trong transaction ghi, không trong lúc gọi provider |
| P9 | Ghi tín hiệu quota từ job trong transaction "Kết thúc" sẵn có, ở vị trí `provider_state` (cuối) | R03, H1 thứ tự khoá |
| P10 | **Không ADR**: không thư viện mới (subprocess `asyncio`, `importlib.util.find_spec`, `json` chuẩn) | WORKFLOW "Đề xuất công nghệ" |
| P11 | Tranh chấp test dự kiến **T1**: H2b `direct.int.test.ts:225–231` so `message = runErrorText("ALL_PROVIDERS_EXHAUSTED")` với reason `quota` — trái R08. qc sửa ở QW (R19: BA HUB-BR-04 thắng), ghi lý do vào `test-plan` | R19 |

## 2. Contract
| Gói | Thay đổi |
|---|---|
| `@ai/contracts/chat` | **Không đổi** (R19). `run.failed{code,message,hint}` giữ; chỉ chữ `message/hint` theo bảng §4 |
| `@ai/contracts/hub` · `hub-internal` | **Không đổi**. `contracts:check` xanh nguyên trạng |
| Kiểu nội bộ Python (không phải contract) | `RateLimit` thêm trường tuỳ chọn; `ProbeRequest` mới — `plan-runtime` §2 |

## 3. Dữ liệu
Chi tiết + SQL: `plan-db` §1. Tóm tắt `hub.provider_state` thêm:

| Cột | Kiểu · null | Ghi bởi | Ý nghĩa |
|---|---|---|---|
| `last_probe_at` | timestamptz NULL | probe | lần probe cuối có kết quả (mọi kết quả) |
| `last_ok_at` | timestamptz NULL | job thành công · probe `ok` | bằng chứng gần nhất provider dùng được (R12) |
| `rate_limit_type` | text NULL, CHECK `^[a-z0-9_]{1,40}$` | job/probe khi có `RateLimitEvent` | `five_hour`/`seven_day`/… (R02, R03) |
| `utilization` | real NULL, CHECK 0–1 | như trên | mức dùng cửa sổ gần nhất |
| `warn_at` | timestamptz NULL | `allowed_warning` | lần cảnh báo cuối (R03) |
| `warn_resets_at` | timestamptz NULL | `allowed_warning` | cửa sổ đã log `provider.quota_warning` (khử trùng R03 giữa nhiều Runtime) |

Không đổi: nghĩa `status`/`cooldown_until`/`last_error`/`consecutive_errors`/`updated_at` (R05). **Thêm quy ước**: `updated_at` chỉ đổi khi `status`/`cooldown_until`/`consecutive_errors` đổi (không đổi khi chỉ ghi `last_*`/quota) — làm mốc rào R15. `usage_logs` không đổi (R17, R20).

## 4. Hub TS
### 4.1 Luật thuần — `apps/hub-api/src/modules/runner/runner.rules.ts` (qc unit `tests/acceptance/H3a/rules/`)
```ts
/** H3a-R09 · lý do khi provider đang chặn (khớp `providerBlocked`): cooldown → quota; logged_out/error → provider_unavailable; không chặn → null. */
export function blockedReason(
  s: { status: string; cooldownUntil: Date | null } | undefined,
  now: Date,
): "quota" | "provider_unavailable" | null;
```
Điều kiện: `!providerBlocked(s, now)` ⇒ `null`; `s.status === "cooldown"` ⇒ `"quota"`; còn lại ⇒ `"provider_unavailable"`. (`cooldown` có `cooldownUntil` null ⇒ chặn ⇒ `quota`.)

### 4.2 Chỗ dùng
| File | Thay đổi |
|---|---|
| `runner/job/job-agent-runner.ts` (~221) | `reason: blockedReason(state, now)` thay hằng `"provider_unavailable"`; `message` nội bộ giữ |
| `runner/job/job-follow.ts` `#poll` (~119) | khi `row.queueExpired`: `reason = blockedReason(await repo.providerStateOf(tx, j.providerKey), new Date()) ?? queueTimeoutReason(await repo.slotCounts(…))`. Đọc `provider_state` không khoá (đã có `providerStateOf`), cùng transaction hệ thống |
| `runner/workflow/workflow-job-runner.ts` | **không đổi** (provider `dify` không có `provider_state`, R10) |
| `runs/run-errors.ts` | bảng `EXHAUSTED_TEXTS` (dưới); `runErrorTextFor(code, locale, reason)`: `code === "ALL_PROVIDERS_EXHAUSTED"` ∧ `reason ∈ {quota, provider_unavailable}` ⇒ thay **cả** `message` và `hint`; reason khác/null ⇒ câu H1. Nhánh `UPSTREAM_ERROR` (H2b/H2c) giữ |
| `internal/test-run.service.ts` | không đổi (Admin test-run dùng `runErrorText` theo mã — ngoài R08, PL13) |

### 4.3 Câu lỗi (R08 — nguyên văn, tĩnh, ≤ `CHAT_ERROR_TEXT_MAX`)
| reason | vi `message` · `hint` | en `message` · `hint` |
|---|---|---|
| `quota` | "Dịch vụ AI đã dùng hết hạn mức của gói hiện tại." · "Thử lại sau; hạn mức sẽ tự mở lại." | "The AI service has used up the current plan's limit." · "Try again later; the limit will reset automatically." |
| `provider_unavailable` | "Dịch vụ AI đang tạm ngưng để quản trị viên kiểm tra." · "Báo quản trị viên nếu lỗi kéo dài." | "The AI service is paused for an administrator to check." · "Contact your administrator if this persists." |
| khác / null (`tenant_slots`, `provider_busy`, …) | câu H1 "Tất cả dịch vụ AI đang quá tải…" | câu H1 |

Không giờ, không tên provider/tài khoản/email (H1-R26, Q5=A).

### 4.4 Luồng đã có — chỉ thêm test (không code)
| Luật | Hiện trạng (đã đọc) | Test |
|---|---|---|
| R06 Hub không tạo job khi chặn | `job-agent-runner.ts` `providerBlocked` trước `#enqueue` | AC-04 int (0 hàng `jobs`, câu theo reason) |
| R07 không retry/requeue | Runtime: `agent.cli` không requeue (chỉ `workflow.async`, `jobs_sql.REQUEUE_*`); Hub: `orchestrator.loop.ts:123` job lỗi ⇒ `kind:"failed"` kết thúc vòng, không delegate lại | AC-05 stack |
| R10 command `/` không bị chặn | command driver không đọc `provider_state` | AC-07 int (mock Dify H2a) |

## 5. Thứ tự khoá (bổ sung H2c P8, không đổi thứ tự cũ)
`[advisory user (E12)] → [K_CLAIM] → conversations → flows → runs → run_steps → messages → attachments → tool_confirmations → jobs → usage_logs → cli_sessions → provider_state`

| Đường | Khoá theo thứ tự | Ghi chú |
|---|---|---|
| Probe (mới) | `[advisory phiên probe(key)]` (ngoài transaction, giữ suốt lượt) → *(gọi provider, không khoá DB)* → transaction ghi: khoẻ: `provider_state` · đổi trạng thái hỏng: `K_CLAIM → jobs (FAIL_QUEUED) → provider_state` | Không ai lấy khoá probe khi đang giữ `K_CLAIM`/hàng ⇒ không chu trình. Khoá probe nhả trong `finally` (`pg_advisory_unlock`) + asyncpg `reset()` khi trả kết nối (`pg_advisory_unlock_all`) |
| Kết thúc job (H1, sửa câu) | như H1: `[K_CLAIM khi hỏng/lỗi] → jobs → usage_logs → cli_sessions → provider_state` (`PROVIDER_OK` nay luôn UPSERT `last_ok_at`; `NOTE_WARNING` sau cùng, cùng hàng) | Thành công đồng thời cùng provider tuần tự hoá ở hàng `provider_state` cuối transaction — ngắn |
| Hub đọc trạng thái | `SELECT` không khoá (`providerStateOf`) | như H1 |

Int test bắt buộc chạy lại: H1 `concurrency`, A37 `lock-order`; Python `claim_int_test`, `provider_int_test`, `orphan_int_test`.

## 6. Hiệu năng (spec §6)
| Chỉ tiêu | Cách đạt |
|---|---|
| `rejected` trong job → `run.failed` ≤ 5 s | đường H1 không đổi (Kết thúc → XADD) |
| Tin mới khi `cooldown` → `run.failed` ≤ 1 s | một `SELECT` PK `provider_state` trước enqueue (đã có) |
| Probe khoẻ: 0 lần chờ `K_CLAIM` | P8: UPSERT một câu, không `K_CLAIM` (Python int đếm `pg_locks`/thời gian claim) |
| Probe thật ≤ 60 s, không chặn claim | (a) hạn 15 s + (b) hạn `AGENT_RT_PROBE_TIMEOUT_S`; vòng probe là service riêng trong TaskGroup, không chung task với claimer |
| Truy vấn mới | `PROBE_TARGETS` (PK `providers` ⨝ PK `provider_state`, ≤ vài hàng) mỗi nhịp 5 s — không index mới |

## 7. Env, công cụ, lệnh xong
Env Runtime (`config.py`, `.env.example`, `plan-runtime` §6): `AGENT_RT_PROBE_S=1200` · `AGENT_RT_PROBE_LOGGED_OUT_S=60` · `AGENT_RT_PROBE_TIMEOUT_S=60` · `AGENT_RT_COOLDOWN_DEFAULT_S=1800` · `AGENT_RT_FAKE_PROBE_FILE` (chỉ development|test). Hub: không env mới.

`bun run done:h3a` (`tools/scripts/src/done-h3a.ts`, mẫu `done-h2c.ts` — `extend`/`byTitle` từ `h2cSteps()`): toàn bộ bước `done:h2c` + `bun test tests/acceptance/H3a/rules` + int `tests/acceptance/H3a/` (cùng bước int H2b/H2c) + Python (bước `(cd apps/agent-runtime …` sẵn có đã gồm `pytest` + `pytest -m int` toàn thư mục) + `bun run test:h3a:stack` (`tests/acceptance/H3a/stack`, `bunfig.stack.toml`; thêm vào danh sách bỏ qua của `bunfig.toml`/`bunfig.int.toml`) + `test:lock:verify` + `trace --check` + `check:size --all` + `depcruise` + `tsc -p tsconfig.tests.json`. Không bước perf mới (đo trong int).

## 8. Rủi ro thêm (ngoài spec §10)
| # | Rủi ro | Giảm thiểu |
|---|---|---|
| K6 | Probe khởi động chạy đua với job đầu tiên (đếm lỗi, cooldown) ⇒ test khoá H1 (`orphan_int_test` 3 crash → `error`, `provider_int_test` cooldown) chập chờn | PL4: probe khoẻ không đụng `consecutive_errors`/`updated_at`; đổi trạng thái rào `updated_at`; không probe khi `cooldown` chưa hết hạn (PL3) |
| K7 | `auth status` stdout có email/orgId (PII) | đọc ≤ 64 KiB, chỉ khoá `loggedIn`, không log stdout/stderr (stderr → `DEVNULL`); AC-11 quét log |
| K8 | Khoá advisory phiên kẹt trên kết nối pool khi huỷ giữa chừng | `finally` + `asyncio.shield` unlock; asyncpg `reset()` gọi `pg_advisory_unlock_all()` khi trả kết nối; lỗi unlock ⇒ `terminate()` kết nối |
| K9 | CLI bundled đổi chữ/khoá `auth status` khi nâng SDK | khoá theo bản ghim `claude-agent-sdk==0.2.163`; (a) exit 0 mà stdout không phải JSON có `loggedIn` boolean ⇒ **lỗi probe** (đếm lỗi), không suy ra `logged_out` (PL7); kiểm lại khi nâng SDK (như PY-02 H1) |
| K10 | Probe (b) chiếm hạn mức khi rảnh | R12 + 20 phút; ≤ 72 lượt/ngày (Spike S1) |
| K11 | Thư mục probe bị `run_cleanup` dọn | tạo lại mỗi lượt (`mkdir exist_ok`, 0700) |

## 9. Task: [`tasks.md`](tasks.md).
