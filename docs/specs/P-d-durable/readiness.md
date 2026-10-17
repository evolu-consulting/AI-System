# Readiness · P-d-durable

Mỗi lần chạy spec-readiness thêm một dòng (mới nhất ở trên). Báo cáo đầy đủ dán bên dưới dòng đó hoặc lưu file riêng.

Điều kiện Gate đã biết trước: ADR-0017 **Accepted** (còn thiếu Redis thật + tải 10.000 run trên staging); mockup/artboard panel stage + nhãn chat (D13); security review cho chuyển cấp và vòng hẹn giờ; mốc dọn-seed (CR-081) đã đóng.

| Ngày | Kết quả | Chặn | Cao | Thấp | Ghi chú |
|---|---|---|---|---|---|
| 2026-10-17 | NOT READY (lần 1) | 6 | 13 | 6 (+7 Vừa) | Chưa có plan/plan-frontend/test-plan/mockup; phân loại lỗi (Q2), side_effect, team retry (Q1), quyền tool P-d2; khoá idempotency va chạm; thứ tự khoá timer↔run; FORCE RLS sai; thiếu nới CHECK audit/thread; ESCALATE_INVALID↔PROCESS_REF_INVALID; AC-H41 sai trần. Hỏi người dùng 4 câu. |

## Lần chạy

### Lần 1 · 2026-10-17 · NOT READY

Phạm vi: 6/6 file spec, CLAUDE.md, WORKFLOW, BA §6.10 / BR-12, 25, 26, 38, 41–43 / §8 / §11, CR-083…087, ADR-0017; đối chiếu `chat/processes.ts`, `processes-entities.ts`, `hub-admin/processes.ts`, `process-steps.ts`, `hub/errors.ts`, `db/schema/hub-processes.ts`, `hub.ts`, `admin.ts`, `migrations-hub/0019`, `runs/sweeps.ts`, `executor-ref.ts`, `notify/reminder.ts`, `core/task.rules.ts`, `mcp/mcp.service.ts`.

#### Lỗ hổng Chặn
| # | Vấn đề | Mặc định đề xuất |
|---|---|---|
| 1 | Chưa có `plan.md`, `plan-frontend.md`, `test-plan.md`; contract còn dời sang plan | Chạy T1 (BE), T2 (FE), T3 (qc), rồi readiness lần 2 chỉ kiểm phần đổi |
| 2 | Chưa có mockup, câu chữ VI/EN, trạng thái tải/rỗng/lỗi, nhãn e2e | frontend-lead dựng mockup artifact panel stage + nhãn chat trong T2, trình cùng Gate |
| 3 | Phân loại lỗi đọc được hai cách (6 lý do job chưa xếp loại; code ↔ reason mâu thuẫn; `provider_state` toàn cục; lỗi mạng giả định) | Hàm thuần `classifyJobError(code, reason)`: xét `error_reason` trước (tạm = timeout, upstream, crash, orphaned, provider_busy, tenant_slots); reason null thì tạm = `TIMEOUT`, `UPSTREAM_ERROR`; `ALL_PROVIDERS_EXHAUSTED` tạm chỉ khi reason ∈ provider_busy/tenant_slots; còn lại nghiệp vụ; `interrupted` = tạm; không đọc `provider_state` |
| 4 | "Đã gửi side_effect" chưa rõ nguồn cờ, phạm vi, trạng thái | Có `hub.run_steps` type=`workflow`, status ≠ `skipped`, thuộc `hub.runs` có `stage_run_id` = stage, tạo từ đầu attempt/round hiện tại, `admin.workflows.side_effect=true` |
| 5 | Stage team: PD-R03 ↔ PD-R08 mâu thuẫn khi retry bắn | Mức thành viên: team-run giữ `running`, dừng tính `active_ms`; bắn thì gọi lại thành viên ở `cursor`, không tăng `calls`; khoá idempotency theo `stage_run_id` |
| 6 | Quyền gọi tool không có mô hình (`admin.workflows` không có `tenant_id`; stage tool không có agent) | Tool khả dụng = workflow `enabled` gắn ≥ 1 agent đã bật cho tenant mà người bắt đầu có grant; lưu kiểm theo tenant, chạy kiểm theo người bắt đầu; tool của gói để sau |

#### Lỗ hổng Cao
| # | Vấn đề | Mặc định đề xuất |
|---|---|---|
| 7 | Trường bắt buộc của stage chưa định nghĩa cho `wait_until`/`tool` | `wait_until`: ép `required_sections=["Bàn giao"]`, template cố định, `fields=[]`, `answerer=starter`, `token_budget=null`, bỏ `timeout_s`. `tool`: ép `["Kết quả","Bàn giao"]` + template nguyên văn, bỏ `answerer` |
| 8 | `ExecutorRef` chưa có dạng cho executor mới | Theo `APPLY_EXECUTOR_REF`: wait_until key `wait_until`, name "Chờ tới ngày"/"Wait until date"; tool key = `tool_key`, name = tên workflow |
| 9 | `idempotency_key` va chạm sau `add_attempt` | Thêm hậu tố `:<n>` (số hẹn giờ cùng kind của stage_run + 1) tính dưới khoá run |
| 10 | Thứ tự khoá timer ↔ run ngược nhau, có thể deadlock | Đọc ứng viên không khoá; mỗi hàng một tx: khoá run → `SELECT … FOR UPDATE` timer → áp hiệu ứng; mọi đường run → stage → timer |
| 11 | "FORCE RLS" sai so với 0019 | ENABLE, không FORCE; policy `process_timers_hub_rw` theo tenant như 0019 |
| 12 | Thiếu nới CHECK audit, loại tin thread, `HistoryItem.kind` | Thêm cuối: audit `escalate`, `escalate_skipped` (0036), `tool_call`, `branch` (0037); `ROOM_PROCESS_KINDS` + `branch`; `HistoryItem.kind` + `escalate`, `branch` |
| 13 | `ESCALATE_INVALID`/`TOOL_INVALID` ↔ `PROCESS_REF_INVALID` | Không tồn tại / khác tenant ⇒ 422 `PROCESS_REF_INVALID`; lỗi cấu hình khác ⇒ `PROCESS_DEF_INVALID` rules[] |
| 14 | `use_current` của `timer_invalid` mâu thuẫn `decisionOptionsFor` | Thêm `timer_invalid` vào `FORCE_USE_CURRENT`; Hub ghi .md "Bỏ chờ theo quyết định"; người quyết như `agent_failed`; `tool_failed` chỉ `use_current` khi có output |
| 15 | "Bước trước" chưa rõ | Mọi bước nhỏ hơn; nguồn `skipped`/không output ⇒ `timer_invalid` / `tool_failed` |
| 16 | Chưa có hình value của input `date` | `{key,type:'date',value}`, `^\d{4}-\d{2}-\d{2}$` + ngày lịch hợp lệ; sai ⇒ 422 `VALIDATION_ERROR` |
| 17 | AC-H41 trái trần 5 run | "4 running + 1 waiting_timer ⇒ bắt đầu được; 5 running + 1 waiting_timer ⇒ chặn" |
| 18 | ADR-0017/0018/0022 còn Proposed | Gate P-d1 chỉ cần ADR-0017 Accepted; P-d2 (T16) cần ADR-0022 Accepted hoặc dùng cách gọi workflow hiện có |
| 19 | D7 "múi giờ theo tenant" ↔ spec dùng hằng | Hỏi người dùng (câu 2) |

#### Vừa / Thấp (xử lý trong plan, không chặn)
#20 thứ tự ưu tiên trạng thái run khi có `waiting_timer`; #21 `remind_count`/`reminded_at` khi không cấu hình, độ trễ ≤ 5 phút; #22 bổ sung test khoá (`contracts-pa.test.ts:175`, `P-b/pfs3/rules/sources.rules.test.ts`, `P-a/pf1/start.int.test.ts`); #23 import/export `ttl_days`; #24 regex `time`, câu .md nguyên văn; #25 sửa tham chiếu `gates/forward*` trong tasks; #26 ghi `hub.runs`/`run_steps`/`usage_logs` cho tool ngoài job; #27 BA ghi "AC-H38 giữ chỗ (X2b2)"; #28 frontmatter thêm ADM-FR-71, CHAT-AC-59; #29 AC-H45 đánh số bước; #30 `DATE_RE` kiểm ngày lịch; #31 migration 0036/0037 hợp lệ; #32 kích thước đạt.

#### Mâu thuẫn giữa tài liệu
- ADR-0017:32 "thử lại tới `attempt_limit`" ↔ D3 `retry_count` riêng → giữ D3, sửa ADR khi Accepted.
- D7/CR-084/HUB-FR-144 "múi giờ theo tenant" ↔ spec dùng hằng → hỏi người dùng.
- spec.md:130 FORCE ↔ 0019 không FORCE → theo 0019.
- `ESCALATE_INVALID` ↔ `PROCESS_REF_INVALID` → theo #13.
- AC-H41 ↔ trần 5 run → sửa câu AC.
- PD-R14 `use_current` ↔ `decisionOptionsFor` → theo #14.

#### Câu hỏi cho người dùng (một lượt)
1. Chấp nhận trọn gói mặc định A1–A12, Q1 theo #5, Q2 theo #3, Q4–Q7, và #4, #7–#18, #20–#26?
2. GĐ1 dùng hằng `Asia/Ho_Chi_Minh`, cột múi giờ theo tenant để giai đoạn sau?
3. Quyền gọi tool (P-d2): theo #6, hay thêm công tắc bật tool theo tenant trong Admin?
4. Mockup: frontend-lead tự dựng trong T2 và duyệt ở Gate, hay người dùng cung cấp?

Lần chạy 2: chỉ kiểm diff thư mục spec cùng plan/plan-frontend/test-plan mới và các mục #1–#26 còn mở.

> 2026-10-17 · Đã áp trả lời người dùng, chờ T1–T3 rồi readiness lần 2.
