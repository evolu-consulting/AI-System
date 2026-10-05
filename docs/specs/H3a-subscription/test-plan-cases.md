# Test plan · H3a-subscription · phụ lục TS: R, A, K, M (qc)

Phụ lục của [`test-plan.md`](test-plan.md). Chữ ký: `plan.md` §4.1 (`blockedReason`), §4.2 (`runErrorTextFor`), câu nguyên văn §4.3. Fixture: H1 `_fixtures.ts` (`lan` vi, `hoa` en — readiness H1 #52), H1 `_hub.ts`/`_runtime.ts` (`ScriptRuntime`), H2a `_h2a.ts` (MK Dify), H2b `_h2b.ts`; helper mới `_h3a.ts` (test-plan §2.1).

## 1. R · hàm thuần TS (`tests/acceptance/H3a/rules/`) — QW-R
### 1.1 `blocked-reason.test.ts` (R01–R04) · H3a-R09 · HUB-H3a-AC-06 · `plan` P5
`now = 2026-10-06T00:00:00Z` cố định; `s = {status, cooldownUntil}`.

| ID | Dữ liệu | Kỳ vọng |
|---|---|---|
| R01 | `undefined` · `ok` · `busy` (cooldownUntil null) | `null` |
| R02 | `cooldown` + `now+1 s` · `cooldown` + `null` | `"quota"` (AC-06 vế "cooldown trước enqueue ⇒ quota") |
| R03 | `cooldown` + `now−1 s` (đã hết hạn) | `null` |
| R04 | `logged_out` · `error` (cooldownUntil null và có giá trị) | `"provider_unavailable"` |
| R05 | Bảng 12 tổ hợp (5 trạng thái + `undefined` × {`now−1 s`, `now+1 s`, `null`}) | `blockedReason(s, now) !== null` ⇔ `providerBlocked(s, now)` (khớp tuyệt đối với hàm H1 — không đoán biên `==now`) |

### 1.2 `run-errors-h3a.test.ts` (R10–R18) · H3a-R08 · HUB-BR-04 · HUB-H3a-AC-06 · `plan` P4
| ID | Gọi | Kỳ vọng |
|---|---|---|
| R10 | `runErrorTextFor("ALL_PROVIDERS_EXHAUSTED", "vi", "quota")` | `{message:"Dịch vụ AI đã dùng hết hạn mức của gói hiện tại.", hint:"Thử lại sau; hạn mức sẽ tự mở lại."}` nguyên văn |
| R11 | như R10, `"en"` | `"The AI service has used up the current plan's limit."` · `"Try again later; the limit will reset automatically."` |
| R12 | `"vi"`, `"provider_unavailable"` | `"Dịch vụ AI đang tạm ngưng để quản trị viên kiểm tra."` · `"Báo quản trị viên nếu lỗi kéo dài."` |
| R13 | `"en"`, `"provider_unavailable"` | `"The AI service is paused for an administrator to check."` · `"Contact your administrator if this persists."` |
| R14 | reason `null` · `"tenant_slots"` · `"provider_busy"` · `"timeout"` · `"zzz"` (vi, en) | `toEqual(runErrorText("ALL_PROVIDERS_EXHAUSTED", locale))` (câu H1) |
| R15 | mã khác + reason `quota`/`provider_unavailable`: `TIMEOUT`, `INTERNAL_ERROR`, `UPSTREAM_ERROR` (vi, en) | `toEqual(runErrorText(code, locale))` — reason chỉ áp cho `ALL_PROVIDERS_EXHAUSTED` |
| R16 | `runErrorText("ALL_PROVIDERS_EXHAUSTED", vi/en)` | không đổi (so chuỗi H1 — trùng H1 `rules/run-errors.test.ts`, `plan` P4) |
| R17 | 4 câu mới (message + hint) | độ dài ≤ `CHAT_ERROR_TEXT_MAX` (import từ `@ai/contracts/chat`); không khớp `/\d/` (không giờ/số), `/claude\|anthropic\|sub\|fake/i`, `@`, `http` (H1-R26, Q5=A) |
| R18 | `UPSTREAM_ERROR` + `file_rejected` (H2c) | như H2c `run-errors-h2c.test.ts` (hồi quy nhánh cũ giữ, `plan` §4.2) |

### 1.3 `contracts-h3a.test.ts` (R20–R21) · spec §3 · `plan` P2
| ID | Kỳ vọng |
|---|---|
| R20 | `JOB_FAIL_REASONS` (`@ai/contracts/hub`) chứa `quota`, `provider_unavailable` (đã có — xanh trước code, chấp nhận) |
| R21 | schema `run.failed` (`@ai/contracts/chat`) `parse` thành công với 4 cặp message/hint mới (R10–R13) |

## 2. A · int hub-api (`tests/acceptance/H3a/*.int.test.ts`) — QW-A
Chung: provider của agent Orchestrator (`claude-sub` theo seed H1 — qc xác nhận khoá provider trong `_fixtures.ts` khi viết). Ca đổi `provider_state` khôi phục `ok`/`cooldown_until=NULL` ở `finally` (TC-6). Đo thời gian bằng `Date.now()` quanh `start → end`, ngưỡng nới (memory "perf ưu tiên thấp"): assert ≤ 3 000 ms, ghi ms thực vào log §10; spec §6 1 s là mục tiêu báo cáo.

### 2.1 `blocked.int.test.ts` (A01–A09) · H3a-R06, R08, R09 · HUB-H3a-AC-04 (vế Hub) · AC-06
Mã đầu tên: `HUB-BR-04` (A01–A07), `WRK-FR-15` (A08).

| ID | Given | Then |
|---|---|---|
| A01 | `cooldown`, `cooldown_until = now+1 h`; `lan` (vi) gửi tin thường | SSE `run.failed{code:ALL_PROVIDERS_EXHAUSTED, message, hint}` = R10 nguyên văn; 0 hàng `hub.jobs` của run; ≤ 3 000 ms (ghi ms) |
| A02 | như A01, `hoa` (en) | message/hint = R11 |
| A03 | `logged_out` (vi) | R12; 0 job |
| A04 | `error` (en, `hoa`) | R13; 0 job |
| A05 | `cooldown`, `cooldown_until = NULL` | R10 (chặn ⇒ `quota`) |
| A06 | A01 xong → `GET /runs/:id` | `status=failed`, `error.code/message` = SSE (cùng nguồn) |
| A07 | A01, A03 | `JSON.stringify(run.failed)` không chứa `claude-sub`, khoá provider, `@`, chữ số giờ (FORBIDDEN H1 A26 + R17) |
| A08 | `cooldown` đã hết hạn (`now−1 s`) | job được tạo (H1 A30 vế hết hạn — hồi quy, xanh trước code) |
| A09 | `cooldown` + tin `/command` của `lan` | xem A18 (không bị chặn) |

### 2.2 `queue-wait.int.test.ts` (A10–A13) · H3a-R06 khe hở · PL12 · AC-04
`startHubX(k, {jobMaxWaitS: 2})` (H1 A31). Hub enqueue khi provider `ok`, **không** claim (ScriptRuntime không gọi `next`), rồi SQL đổi `provider_state`.

| ID | Đổi sau enqueue | Then |
|---|---|---|
| A10 | → `cooldown` (`now+1 h`) | trong [2, 6] s: `jobs` = `[{status:failed, error_code:ALL_PROVIDERS_EXHAUSTED, error_reason:"quota"}]`; SSE `run.failed` message = R10 |
| A11 | → `logged_out` | `error_reason = "provider_unavailable"`; message R12 |
| A12 | không đổi (provider `ok`), tenant đầy (`max_concurrent_sub=1` + 1 job running — H1 A31) | `error_reason = "tenant_slots"`, câu H1 (R14) — `queueTimeoutReason` không đổi |
| A13 | → `cooldown` với `cooldown_until = now+1 s`, chờ qua hạn trước khi Hub xét | `blockedReason` = null ⇒ reason theo `queueTimeoutReason` (`provider_busy`/`tenant_slots`, không `quota`) |

### 2.3 `job-reason.int.test.ts` (A14–A17) · F1 · H3a-R08, R09 · AC-06
`ScriptRuntime.fail(job, code, msg, reason)`.

| ID | Job · reason | Then |
|---|---|---|
| A14 | Orchestrator · `ALL_PROVIDERS_EXHAUSTED` + `quota` (vi) / (en, `hoa`) | `run.failed` R10 / R11; 0 job thứ hai của run (R07 vế Hub — `orchestrator.loop` không delegate lại) |
| A15 | Orchestrator · `provider_unavailable` | R12 |
| A16 | Orchestrator · `provider_busy` · `null` | câu H1 |
| A17 | job agent trực tiếp `@assistant` (H2b đường direct) · `quota`; và đã phát delta trước khi fail (H2b A110) | R10; đúng 1 sự kiện kết thúc |

### 2.4 `command.int.test.ts` (A18–A19) · H3a-R10 · HUB-H3a-AC-07 · CR-041
MK Dify H2a (`_h2a.ts`, key `mk-ok`), `claude-sub` `cooldown` `now+1 h` trong cả hai ca.

| ID | Tin | Then |
|---|---|---|
| A18 | `/` command sync (H2a `command-run` fixture) | `run.finished`; MK ghi đúng 1 `/v1/workflows/run`; 0 hàng `jobs` provider `claude-sub` |
| A19 | `/` command async (H2a `async`) | job `workflow.async` được tạo (provider `dify`, không bị chặn); `ScriptRuntime` hoàn tất ⇒ `run.finished` |

### 2.5 `db.int.test.ts` (A20–A23) · spec §4 · `plan-db` §1 (bổ sung D1 `packages/db/src/hub-h3a.int.test.ts`)
| ID | Kỳ vọng |
|---|---|
| A20 | 6 cột (`information_schema.columns`) đúng kiểu, `is_nullable=YES`; hàng cũ có giá trị NULL |
| A21 | CHECK: `rate_limit_type='Five-Hour'` · `'a'×41` · `utilization=1.5` · `-0.1` ⇒ lỗi `23514`; `five_hour`, `0`, `1` ⇒ được |
| A22 | role `agent_runtime` `UPDATE` được 6 cột; `hub_rw` `SELECT` được (GRANT không đổi) |
| A23 | `admin`/M4 đọc `hub.usage_logs` cột không đổi (R20 — đếm cột trước/sau = danh sách cố định) |

### 2.6 `compat.int.test.ts` (A24–A25) · R19 · PL13
| ID | Kỳ vọng |
|---|---|
| A24 | Admin test-run (H2a `test-run.int` đường) với job fail `ALL_PROVIDERS_EXHAUSTED`+`quota` ⇒ câu H1 (`runErrorText(code)`, PL13) |
| A25 | `run.failed` mới parse bằng schema `@ai/contracts/chat` (SSE thật A01–A04) |

### 2.7 T1 · sửa test khoá H2b `direct.int.test.ts:225–231` (A25 H2b)
| Hiện | Sửa (qc, QW — `plan` P11, R19: BA HUB-BR-04 thắng) |
|---|---|
| vòng `["ALL_PROVIDERS_EXHAUSTED","TIMEOUT"]`, fail với reason `quota` cho EXHAUSTED, `expect(message).toBe(runErrorText(code,"vi").message)` | giữ vòng + reason; kỳ vọng: `code === "ALL_PROVIDERS_EXHAUSTED"` ⇒ `runErrorTextFor(code, "vi", "quota").message` **và** so thêm chuỗi nguyên văn R10 (bắt lỗi nếu `runErrorTextFor` lệch); `TIMEOUT` giữ `runErrorText`. Tên test thêm `[H3a-R08]`. Lý do ghi §10 log + spec §11 "Tranh chấp test" (T1 — qc tự phân xử, không cần agent code nêu) |

Rà xong các test khoá khác so câu `ALL_PROVIDERS_EXHAUSTED` (2026-10-06): H1 `orchestrator.int:363–380` (A26 chỉ assert không rỗng + FORBIDDEN ⇒ xanh nếu câu mới qua R17), H1 `runner.int` A30/A31 (chỉ `code`/`error_reason`), H2b `delta.int:307` (chỉ `code`), `rules/run-errors.test.ts` (`runErrorText` — P4 giữ), `tests/contract/chat` `err-exhausted` (mock `tools/mocks`, không qua Hub), e2e `errors.chat.ts` (Chat mock). ⇒ **Chỉ T1** phải sửa.

## 3. K · hồi quy khoá (chạy lại nguyên văn, không sửa)
| ID | Bộ | Vì sao có thể vỡ |
|---|---|---|
| K01 | `test:contract:chat` 41 pass (hub-dev) | R19, AC-13 |
| K02 | `tests/acceptance/H1/rules/run-errors.test.ts`, `rules/runs.test.ts` (R10 `queueTimeoutReason`) | P4, P5 |
| K03 | H1 `runner.int` A30/A31, `orchestrator.int` A26/A56, `concurrency`, `lock-order` A37, `db.int` A48–A51 | B1 đổi reason; thứ tự khoá §5 |
| K04 | H2a toàn bộ (gồm `test-run.int` — PL13), H2a stack | R10 |
| K05 | H2b toàn bộ (sau T1), `delta.int` A110, stack, hubdev | T1 |
| K06 | H2c toàn bộ, `run-errors-h2c` | nhánh `UPSTREAM_ERROR` |
| K07 | Python khoá: `provider_int_test` (3 ca), `orphan_int_test` (8 ca, nhất là `restart_resets_provider_state`, `restart_keeps_cooldown`, `three_crashes_marks_error`, `success_resets_error_count`), `refusal_int_test`, `claim_int_test`, `usage_int_test`, `usage_h2b_int_test`, `startup_int_test` (log JSON), `sandbox_int_test` | probe bật mặc định (§5 test-plan, F1) |
| K08 | `tests/acceptance/M4/**` (usage Admin) | R20 |
| K09 | `packages/db` int: `0008` chạy 2 lần không lỗi | D1 |
| K10 | `contracts:check` + `git diff --stat packages/contracts` rỗng | P2 |
| K11 | `depcruise`, `check:size --all`, `check:fn`, `lint-imports` (`quota_rules` "Lõi thuần", `probe.child` cấm `config/db/events`) | rt §1 |
| K12 | `bun run test:smoke:live` không `HUB_LIVE` ⇒ exit 0 | SM |

## 4. M · thủ công
| ID | Checklist |
|---|---|
| M01 | `smoke.md` (I2): SM1–SM3, số đo token/ms vào `sd` "Spike S1"; số lượt haiku thật = 2 |
| M02 | `docs/guides/hub-dev.md` mục "provider subscription": SQL xem `provider_state`, đăng nhập lại, `AGENT_RT_PROBE_*` |
| M03 | Mục chờ PRODUCTION-NOTES (I3, phiên khác giữ file): K5 điều khoản gói, env probe, runbook |
| M04 | CR lệch BA-W §3 (Q4 vòng lặp thay `maint.probe`, 20 phút thay 5 phút) + CR-impact Chat (chỉ chữ) — I3 |
