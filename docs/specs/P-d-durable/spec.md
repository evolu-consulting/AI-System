---
id: P-d-durable
title: P-d · Engine quy trình chạy bền cho flow nghiệp vụ dài ngày (thử lại, hẹn giờ, nhắc lặp/chuyển cấp, thời hạn tuỳ chọn, stage tool, rẽ nhánh)
milestone: GĐ1 platform · engine chạy bền (lát P-d1 = CR-083…086, lát P-d2 = CR-087)
status: done             # P-d1 + P-d2 đóng 2026-10-18 (ket-luan-pd1.md, ket-luan-pd2.md); perf PD2-P04, PD-P13/P14 chờ đo staging
requirements: [HUB-FR-143, HUB-FR-144, HUB-FR-145, HUB-FR-146, HUB-FR-147, HUB-FR-105, HUB-FR-107, HUB-FR-109, HUB-FR-115, HUB-BR-41, HUB-BR-42, HUB-BR-43, HUB-BR-12, HUB-BR-25, HUB-BR-26, HUB-BR-38, ADM-FR-71, ADM-FR-72, ADM-FR-73, CHAT-AC-59, AC-H39, AC-H40, AC-H41, AC-H42, AC-H43, AC-H44, AC-H45, AC-H46, AC-H47, AC-A14, AC-A15]
design:
  - docs/CHANGE-REQUESTS.md#CR-083 · #CR-084 · #CR-085 · #CR-086 · #CR-087 (Intake GĐ1 platform 2026-10-17)
  - docs/design/agent-hub/ba-agent-hub.md §6.10 (HUB-FR-143…147, sửa HUB-FR-105/107/109/115), HUB-BR-41…43, sửa HUB-BR-12/25/26/38, §8 (`process_timers`), §11 AC-H39…H47
  - docs/design/admin/ba-admin.md §5.2 ADM-FR-72 (múi giờ tenant), §5.3 ADM-FR-73 (công tắc tool), §11 AC-A14, AC-A15 · spec-tz-tools.md
  - docs/adr/0017-durable-process-engine.md (**Accepted** 2026-10-17) · 0018 (P-d2, tool gói) · 0022 (P-d2, tool Dify)
  - docs/CHANGE-REQUESTS.md#CR-088…#CR-091 · docs/adr/0023-clean-architecture.md (Accepted) — bốn lớp: spec-ca.md
  - spike: docs/platform/spike-engine.md · spikes/engine/engine.spike.test.ts
  - nền: P-process-engine · P-b-sources · P-b2-canvas · P-c-autofix · P-c2-pr
  - UI: `mockup/01–04` + `plan-frontend*.md` đã có — duyệt ở Gate (readiness câu 4)
owner: backend-lead + frontend-lead + qc
---

# P-d · Engine quy trình chạy bền

Mở rộng engine hiện có (ADR-0017 (a)). Hai lát tuần tự: **P-d1** (CR-083…086) rồi **P-d2** (CR-087, [`spec-d2.md`](spec-d2.md)). Quyết định: [`spec-decisions.md`](spec-decisions.md). Múi giờ + công tắc tool theo tenant: [`spec-tz-tools.md`](spec-tz-tools.md). AC + test khoá: [`spec-ac.md`](spec-ac.md). Đặt code bốn lớp (ADR-0023, CR-090): [`spec-ca.md`](spec-ca.md).

## 1. Phạm vi

### 1.1 Làm
| Lát | Nhóm | Nội dung | Mã |
|---|---|---|---|
| P-d1 | Thử lại | Phân loại lỗi tạm / nghiệp vụ; tự chạy lại lỗi tạm ≤ 3 lần, backoff 30 s → 2' → 8'; `retry_count` riêng; hết lượt ⇒ `retry_exhausted` | HUB-FR-143, HUB-BR-41, CR-083 |
| P-d1 | Hẹn giờ | Bảng `hub.process_timers` + vòng quét; executor `wait_until`; trạng thái `waiting_timer` (run + stage); không tính trần 5 run/tenant | HUB-FR-144, HUB-BR-42, HUB-FR-105, CR-084 |
| P-d1 | Nhắc + chuyển cấp | `after.review` + nhắc mỗi N giờ (≥ 4, ≤ 10 lần) + chuyển cấp thêm Group sau M giờ (1 lần/task) | HUB-FR-145, HUB-BR-43, HUB-FR-107, CR-085 |
| P-d1 | Thời hạn | `process_defs.ttl_days` (nullable, def cũ = 7), chốt vào snapshot; `expires_at` nullable | HUB-FR-115, CR-086 |
| P-d1 | Múi giờ tenant | Cột `admin.tenants.timezone` (IANA), sửa ở màn tenant (Admin) — [spec-tz-tools §1](spec-tz-tools.md) | ADM-FR-72, CR-084 |
| P-d2 | Công tắc tool | Bảng `admin.tenant_workflow_tools` + tab "Tool quy trình" (Admin) — [spec-tz-tools §2](spec-tz-tools.md) | ADM-FR-73, CR-087 |
| P-d2 | Stage tool | Executor `tool` gọi tool Hub `/mcp` bằng quyền người bắt đầu; output `fields` + .md do Hub sinh | HUB-FR-146, HUB-BR-12, HUB-FR-109, CR-087 |
| P-d2 | Rẽ nhánh | `after.branch` trên `output.fields`; nhảy tới, bước bị nhảy ⇒ `skipped` | HUB-FR-147, HUB-BR-38(e), CR-087 |
| cả hai | UI tối thiểu | Panel stage trong canvas hiện có (admin-web); nhãn trạng thái mới ở chat-web | ADM-FR-71 (mở rộng), CHAT-AC-59 |
| cả hai | Test khoá | qc sửa test khoá bị ảnh hưởng ([`spec-ac.md`](spec-ac.md) §2) + viết AC mới | — |

### 1.2 Không làm
| Hạng mục | Lý do |
|---|---|
| Temporal/Restate | ADR-0017 chọn (a) |
| Node kiểu mới trên canvas, canvas đầy đủ | GĐ3 (D13) |
| Tool của gói (ADR-0018) trong stage `tool`; export công tắc tool | để sau (B6) |
| Rẽ nhánh lùi / vòng lặp tự do / LLM quyết nhánh | D12 (quay lại vẫn `back_to_steps`) |
| Tool ngoài Hub `/mcp` (URL tuỳ ý, HTTP thô) | D10 |
| Lịch/webhook bắt đầu run; tự duyệt theo luật (HUB-FR-108); đổi executor `apply` | ngoài CR-083…087 |

## 2. Nghiệp vụ P-d1 (PD-R)
BA là nguồn sự thật; bảng chỉ cụ thể hoá. Hằng: §3.

### 2.1 Thử lại theo loại lỗi (CR-083)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| PD-R01 | **Hàm thuần `classifyJobError(code, reason) → 'transient' \| 'business'`** (Q2, readiness #3), xét theo thứ tự: (1) `reason` (lý do job) khác null ⇒ tạm ⇔ `reason ∈ {timeout, upstream, crash, orphaned, provider_busy, tenant_slots}`; (2) `reason` null ⇒ tạm ⇔ `code ∈ {TIMEOUT, UPSTREAM_ERROR}` (lỗi mạng Hub↔Runtime/provider đã map về `UPSTREAM_ERROR`); (3) còn lại ⇒ nghiệp vụ. Hệ quả: `ALL_PROVIDERS_EXHAUSTED` tạm chỉ khi `reason ∈ {provider_busy, tenant_slots}`. **Không đọc `provider_state`.** `interrupted` (vòng quét D11, hoặc `aborted` không do huỷ run) = tạm, không qua hàm | D2, HUB-BR-41 |
| PD-R02 | **Lỗi nghiệp vụ** = mọi trường hợp còn lại của PD-R01, gồm `template_invalid`, quota/`hard_block`, `NOT_CONFIGURED`, `credential`, `refused`, `invalid_payload`, `permission_lost`, `user_inactive`, `team_*`, `stage_tokens`, `run_tokens`, autofix/apply, `source_unresolvable`. **`INTERNAL_ERROR` ⇒ nghiệp vụ khi `reason` không thuộc 6 lý do tạm; mã không rõ ⇒ nghiệp vụ** (A2) | D2 |
| PD-R03 | Lỗi tạm và `retry_count < STAGE_RETRY_MAX` (3) và job **chưa gửi** tool `side_effect` ⇒ trong 1 tx: `retry_count+1`, `last_error_code`, stage `waiting_timer`, tạo hẹn giờ `kind=retry` `due_at = now + RETRY_BACKOFF_S[retry_count-1]` (30/120/480 s). Run giữ `running` (vẫn tính trần — Q7). Hẹn giờ bắn ⇒ stage `queued` ⇒ `kick` (job mới, cùng `attempt`, cùng `round`, cùng phiên bản/nguồn đã ghim; quyền + trạng thái người bắt đầu kiểm lại như mọi lần chạy stage) | D3, HUB-BR-41/27 |
| PD-R04 | Hết lượt (lỗi tạm thứ 4) ⇒ stage + run `needs_decision` lý do **`retry_exhausted`**. Lựa chọn: `add_attempt` = `retry_count := 0`, chạy lại **ngay** · `use_current` theo luật sẵn có (`decisionOptionsFor`: chỉ khi stage có output hiện hành) · `cancel`. Người quyết như `agent_failed` hiện nay | D3 |
| PD-R05 | **"Đã gửi `side_effect`"** (readiness #4) ⇔ tồn tại `hub.run_steps` `type IN ('tool','workflow')`, `status ≠ 'skipped'`, thuộc `hub.runs` có `stage_run_id` = stage, `started_at ≥ stage_runs.retry_since` (đầu attempt/round hiện tại), và `admin.workflows.side_effect = true` (D-PD03). Đúng ⇒ lỗi tạm **không thử lại**: `needs_decision` lý do cũ (`job_timeout`/`agent_failed`/`interrupted`, A3) | D3, HUB-BR-20 |
| PD-R06 | `retry_count` về 0 khi: stage sang `attempt` mới (Chưa đạt + góp ý), sang `round` mới (quay lại bước), `add_attempt` của `retry_exhausted`. `attempt`/`attempt_limit` **không** đổi nghĩa (làm lại do góp ý) | D3 |
| PD-R07 | Áp cho **mọi** def, cả def cũ và snapshot run đang chạy (không cờ bật/tắt) | D4 |
| PD-R08 | Stage `team` (Q1, readiness #5): lỗi tạm của **job thành viên** thử lại ở mức thành viên, dùng chung `retry_count` của `stage_runs`. Trong lúc chờ: team-run giữ `running`, **dừng tính `active_ms`**. Hẹn giờ bắn ⇒ gọi lại thành viên ở `cursor` hiện tại, **không tăng `calls`**: `lead_plan` có plan ⇒ chạy tiếp từ `cursor`, chưa có plan ⇒ gọi lại lead không đếm; `parallel_merge` ⇒ gọi lại cả lượt, không đếm `calls`. Khoá idempotency theo `stage_run_id` (PD-R10). Xung đột PD-R03 (stage `waiting_timer`) ↔ team-run `running`: stage `waiting_timer`, team-run `running` | Q1 |
| PD-R09 | Executor `apply` (P-c2) không đổi. Executor `wait_until` không có job ⇒ không áp. Executor `tool` (P-d2): [spec-d2 §2](spec-d2.md) | — |

### 2.2 Hẹn giờ + `wait_until` (CR-084)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| PD-R10 | `process_timers` một hàng = một lần hẹn: `kind` ∈ `wait_until` \| `retry`; `idempotency_key` duy nhất = `<kind>:<stage_run_id>:<round>:<attempt>:<n>`, `n` = số hẹn giờ cùng `kind` của stage_run + 1, đếm **dưới khoá run** (readiness #9; tránh va chạm sau `add_attempt`). Tạo trong cùng tx với việc chuyển stage sang `waiting_timer` | D7, HUB-BR-42 |
| PD-R11 | **Vòng quét** (trong `sweepOnce` sẵn có, cùng chu kỳ), readiness #10: scope `system` đọc ≤ 100 ứng viên `fired_at IS NULL AND cancelled_at IS NULL AND due_at ≤ now` theo `due_at` **không khoá**; mỗi hàng một tx theo thứ tự khoá **run → stage → timer**: khoá `process_runs` (`id`, `tenant_id`) → `SELECT … FOR UPDATE` timer (`id`, `tenant_id`), kiểm lại chưa bắn/chưa huỷ, đặt `fired_at`, áp hiệu ứng. Mọi đường khác chạm timer (huỷ, quay lại, tạo) cũng khoá run trước. **Mọi truy vấn trong tx lọc `tenant_id` tường minh** (bài học `scanDue` P-c2 D1 `c5e9b6b8`); `kick`/sự kiện sau COMMIT. Hai instance cùng quét ⇒ một lần bắn | HUB-BR-42 |
| PD-R12 | Run huỷ / hết hạn / kết thúc, hoặc quay lại bước ≤ bước của stage có hẹn ⇒ đặt `cancelled_at` cho hẹn giờ chưa bắn của các stage bị ảnh hưởng (cùng tx) | HUB-BR-42 |
| PD-R13 | **Executor `wait_until`**: ngày gốc lấy từ (a) input run `key` kiểu **`date`** (thêm cuối `INPUT_TYPES`; value `{key, type:'date', value}`, `value` khớp `^\d{4}-\d{2}-\d{2}$` **và** là ngày lịch có thật — sai lúc bắt đầu ⇒ 400 `VALIDATION_ERROR`, readiness #16/#30/#33), hoặc (b) `output.fields.<field>` (kiểu `date`) của output hiện hành của stage `stage_key` ở **bước nhỏ hơn bất kỳ** (readiness #15). `due_at` = ngày gốc + `offset_days` (−365…365) lúc `time` (`^([01]\d\|2[0-3]):[0-5]\d$`, mặc định `09:00`, Q4) theo **múi giờ tenant** `admin.tenants.timezone` đọc trong tx lưu hẹn giờ, chốt thành `due_at` UTC ([spec-tz-tools TZ-R04](spec-tz-tools.md)). Stage nguồn `skipped` / không có output ⇒ `timer_invalid` | D7 |
| PD-R14 | Vào stage `wait_until`: thiếu/sai ngày, hoặc `due_at` > `expires_at` (khi có), hoặc `due_at` > now + 730 ngày ⇒ `needs_decision` lý do **`timer_invalid`** (thêm cuối). Lựa chọn: `add_attempt` = tính lại ngày (khi stage nguồn đã được làm lại) · `use_current` = bỏ chờ, đi tiếp — `timer_invalid` thêm vào **`FORCE_USE_CURRENT`** (`core/task.rules.ts`) nên luôn có; Hub ghi output .md "Bỏ chờ theo quyết định" (có `## Bàn giao`) · `cancel`. Người quyết như `agent_failed` (readiness #14). `due_at ≤ now` ⇒ tới hạn ngay | D7 |
| PD-R15 | Đang chờ: stage `waiting_timer`; run `waiting_timer` chỉ khi mọi stage chưa xong của bước hiện tại đều `waiting_timer` loại `wait_until`; ngược lại trạng thái run tính như hiện nay, `waiting_timer` đứng **thấp nhất** (stage đang backoff `retry` tính như `running`) (readiness #20). Tới hạn ⇒ Hub ghi output .md nguyên văn `Đã chờ tới {YYYY-MM-DD HH:MM} ({timezone}).` + `## Bàn giao` cùng câu (P-R03), stage `done`, join bước như P-b2 | D6, D7 |
| PD-R16 | Trần 5 run/tenant (`countActive`) **không đếm** `waiting_timer`; `running`, `waiting_review`, `waiting_answer`, `needs_decision` vẫn đếm. Run tỉnh dậy từ `waiting_timer` **không** bị chặn bởi trần (đã được nhận lúc bắt đầu) | D6, HUB-FR-105 |
| PD-R17 | Lưu def: stage `wait_until` phải `after.kind='auto'`, `real_action=false`, không `sources`/`must_know`/`autofix`; nguồn ngày hợp lệ (input `date` tồn tại / stage ở bước nhỏ hơn có field `date`) — sai ⇒ 422 luật **`WAIT_INVALID`**. Hub **ép** (readiness #7): `required_sections=["Bàn giao"]`, template cố định, `output.fields=[]`, `answerer=starter`, `token_budget=null`, `timeout_s` = mặc định ([plan-contract §3](plan-contract.md)) | D7 |

### 2.3 Nhắc lặp + chuyển cấp (CR-085)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| PD-R18 | `after.review` thêm `remind_every_h` (4…168, mặc định `null`) và `escalate` (`{after_h: 4…2160, group_id}` \| `null`). Cả hai `null` ⇒ hành vi cũ: nhắc **1 lần** sau `REMIND_AFTER_H` = 24 h qua `reminded_at` (R-N02, P3-04 giữ nguyên), `remind_count` giữ 0 (readiness #21). Nhắc/chuyển cấp có thể trễ ≤ 1 chu kỳ vòng nhắc (≤ 5 phút) — AC dùng dung sai này | D9 |
| PD-R19 | Khi tạo `review_task` (kind `review`): chép `remind_every_h`, `escalate_at = created + after_h`, `escalate_group_id` từ **snapshot** (sửa def không ảnh hưởng). Có `remind_every_h` ⇒ `remind_at = created + N`; mỗi lần nhắc `remind_count+1`, `remind_at += N`; dừng khi `remind_count = REMIND_MAX` (10) hoặc task đóng | D9 |
| PD-R20 | Chuyển cấp chạy trong **vòng nhắc sẵn có** (đọc `review_tasks`, không dùng `process_timers`): task `open`, `escalated_at IS NULL`, `escalate_at ≤ now` ⇒ trong 1 tx (lọc `tenant_id` tường minh): kiểm Group đích còn tồn tại **và cùng tenant** ⇒ thêm `review_task_assignees` (`group_id`, `via='escalated'` — thêm cuối), đặt `escalated_at`, audit (actor hệ thống, task, Group cũ → thêm Group mới), notice **`escalated`** (thêm cuối `NOTICE_KINDS`) + DM hệ thống "Quy trình" cho thành viên Group mới. Group không hợp lệ lúc đó ⇒ không thêm, `escalated_at` vẫn đặt, audit `escalate_skipped` | D8, HUB-BR-43 |
| PD-R21 | Sau chuyển cấp: thành viên **cả hai** Group quyết được (người đầu tiên khoá — như cũ); nhắc tiếp tới mọi assignee. "Chuyển tay" (forward) chỉ tới thành viên **cùng Group mà người chuyển đang được gán** (Group cũ hoặc Group chuyển cấp); `FORWARD_OUT_OF_GROUP` như cũ. Không bao giờ tự Đạt/Chưa đạt | D8, P-R07 |
| PD-R22 | Chỉ áp `kind=review`; task `ask`/`decision` giữ hành vi nhắc cũ. Người Group chuyển cấp ngoài phòng xem theo HUB-BR-25 (grant gắn task, audit `view`) | D8, HUB-BR-25 |
| PD-R23 | Lưu def (readiness #13): Group `escalate.group_id` không tồn tại / khác tenant ⇒ 422 **`PROCESS_REF_INVALID`** (không lộ tồn tại); ngưỡng sai (`after_h` ngoài 4…2160, `remind_every_h` ngoài 4…168) ⇒ 400 `VALIDATION_ERROR` (hình dạng, #40); `escalate.group_id` = `after.review.group_id` ⇒ 422 `PROCESS_DEF_INVALID` luật **`ESCALATE_INVALID`**; `escalate` ở `auto` ⇒ 400 `VALIDATION_ERROR` qua API (contract `after.auto` strict); luật còn bắt ở bản nháp FE | D8 |

### 2.4 Thời hạn tuỳ chọn (CR-086)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| PD-R24 | `process_defs.ttl_days` smallint nullable (1…365); tạo def vắng trường ⇒ 7; PATCH vắng ⇒ giữ; `null` = không hết hạn. Hàng cũ = 7 (DEFAULT của migration). Code chưa có export/import def ⇒ không áp (D-PD13) | D5 |
| PD-R25 | Bắt đầu run: snapshot thêm `ttl_days`; `expires_at = started_at + ttl_days` hoặc `NULL`. Vòng hết hạn chỉ xét `expires_at IS NOT NULL` | D5 |

## 3. Contract P-d1 (backend-lead chốt chi tiết ở plan)
**Luật chung:** chỉ **thêm**; giá trị enum mới **thêm ở cuối mảng**; trường mới trong view/jsonb là optional. Các enum sau bị đổi bởi cả hai lát:

| Hằng | P-d1 thêm cuối | P-d2 thêm cuối |
|---|---|---|
| `EXECUTOR_KINDS` (`chat/processes.ts`) | `wait_until` | `tool` |
| `STAGE_RUN_STATUSES` | `waiting_timer` | `skipped` |
| `PROCESS_RUN_STATUSES` | `waiting_timer` (cũng vào `PROCESS_RUN_ACTIVE`; đếm trần dùng tập riêng, PD-R16) | — |
| `DECISION_REASONS` | `retry_exhausted`, `timer_invalid` | `tool_failed` |
| `NOTICE_KINDS` | `escalated` | — |
| `PROCESS_DEF_RULES` (`hub-admin/process-steps.ts`) | `WAIT_INVALID`, `ESCALATE_INVALID` | `TOOL_INVALID`, `TOOL_SIDE_EFFECT`, `BRANCH_INVALID` |
| `INPUT_TYPES` (`hub-admin/sources.ts`) | `date` | — |
| `ASSIGNEE_VIA_VALUES` (`packages/db`) | `escalated` | — |
| CHECK action audit quy trình (readiness #12) | `escalate`, `escalate_skipped` | `tool_call`, `branch` |
| `ROOM_PROCESS_KINDS` (`chat/room-process.ts`) · `HistoryItem.kind` | `HistoryItem.kind` + `escalate` | cả hai + `branch` |

**Hằng mới:** `STAGE_RETRY_MAX=3` · `RETRY_BACKOFF_S=[30,120,480]` · `REMIND_EVERY_H={min:4,max:168}` · `REMIND_MAX=10` · `ESCALATE_AFTER_H={min:4,max:2160}` · `PROCESS_TTL_DAYS={min:1,max:365,default:7}` (`PROCESS_RUN_TTL_DAYS` giữ = 7) · `WAIT_OFFSET_DAYS={min:-365,max:365}` · `WAIT_HORIZON_DAYS=730` · `WAIT_TIME_DEFAULT='09:00'` · `TIMER_SWEEP_BATCH=100`. Múi giờ: **không hằng** — đọc `admin.tenants.timezone` (mặc định cột `TENANT_TZ_DEFAULT`, [spec-tz-tools §1](spec-tz-tools.md)).

**`ExecutorRef`** (readiness #8, theo mẫu `APPLY_EXECUTOR_REF` ở `runs/executor-ref.ts`): `wait_until` ⇒ key `wait_until`, name "Chờ tới ngày" / "Wait until date"; `tool` (P-d2) ⇒ key = `tool_key`, name = tên workflow.

| Chỗ | Thay đổi P-d1 |
|---|---|
| `ProcessStageDefSchema.executor` | + `{kind:'wait_until', from: {kind:'input', key} \| {kind:'field', stage_key, field}, offset_days, time?}` |
| `after` biến thể `review` | + `remind_every_h: int \| null` (default null) · `escalate: {after_h, group_id} \| null` (default null) |
| Def (create/update/copy, `ProcessDef`) | + `ttl_days: int \| null` (vắng khi tạo ⇒ 7) |
| `StageView` | + `retry_count` · `next_retry_at?` · `last_error_code?` · `due_at?` (wait) |
| `ProcessRunSummary` / full view | + `expires_at: string \| null`; trạng thái `waiting_timer` |
| Task view / inbox | + `escalated: boolean` · `remind_count?` (không lộ cho người ngoài phòng gì hơn HUB-BR-25) |
| `RunDecision` | lý do mới dùng 3 lựa chọn sẵn có (không thêm option) |

Sự kiện: `process.updated` mang trạng thái mới; không event SSE mới. Lỗi HTTP: **không mã mới** — luật def ⇒ 422 `PROCESS_DEF_INVALID` + `rules[]` (cơ chế P-b2); input `date` sai lúc bắt đầu ⇒ **400** `VALIDATION_ERROR` path `inputs.<i>.value` (mã contract khoá `common.ts:210`).

## 4. Dữ liệu P-d1
Migration mới viết tay, idempotent (mẫu 0024/0025), số kế tiếp lúc làm (hiện cao nhất `0035_dlc_workflows.sql` ⇒ dự kiến `0036_pd1_durable.sql`). **Chỉ thêm cột/bảng, DROP NOT NULL, và dựng lại CHECK để nới giá trị enum** (như 0024 dựng lại `review_tasks_reason_ck`). Drizzle: `schema/hub-processes.ts`.

| Bảng | Thay đổi | Ràng buộc |
|---|---|---|
| `process_defs` | + `ttl_days smallint NULL DEFAULT 7` | CHECK `ttl_days IS NULL OR 1…365` |
| `process_runs` | `expires_at` DROP NOT NULL | CHECK status nới `waiting_timer`; index `process_runs_expiring_idx` (thay `process_runs_expires_idx`) |
| `stage_runs` | + `retry_count smallint NN 0` · `retry_attempt smallint NULL` · `retry_round smallint NULL` · `retry_since timestamptz NULL` · `last_error_code text NULL` | CHECK `0 ≤ retry_count ≤ 3`; status nới `waiting_timer`; UNIQUE `(id, tenant_id)` |
| `review_tasks` | + `remind_count smallint NN 0` · `remind_every_h smallint NULL` · `escalate_at timestamptz NULL` · `escalate_group_id uuid NULL` · `escalated_at timestamptz NULL` | CHECK `remind_count ≤ 10`, `remind_every_h` 4…168; reason nới `retry_exhausted`, `timer_invalid`; index `review_tasks_remind_due_idx`, `review_tasks_escalate_idx` |
| `review_task_assignees` | CHECK `via` nới `escalated` | — |
| `process_notices` | CHECK kind nới `escalated` (nếu có CHECK) | — |
| bảng audit quy trình | CHECK action nới `escalate`, `escalate_skipped` (P-d2/0037: `tool_call`, `branch`) | — |
| `admin.tenants` (migration **admin** riêng) | + `timezone` — [spec-tz-tools §1](spec-tz-tools.md) | — |
| **`process_timers` (mới)** | `id` · `tenant_id` NN · `process_run_id` NN · `stage_run_id` NN · `kind` text NN · `due_at` timestamptz NN · `timezone` text NULL (IANA lúc lưu hẹn `wait_until`, D-PD07) · `fired_at` · `cancelled_at` · `idempotency_key` text NN · `created_at` | CHECK `kind IN ('wait_until','retry')`; UNIQUE `idempotency_key`; **FK kép** `(process_run_id, tenant_id)` → `process_runs(id, tenant_id)` và `(stage_run_id, tenant_id)` → `stage_runs(id, tenant_id)` ON DELETE CASCADE (thiếu UNIQUE `(id, tenant_id)` ở bảng đích ⇒ thêm); index một phần `(due_at) WHERE fired_at IS NULL AND cancelled_at IS NULL`; index `(process_run_id)` |

RLS `process_timers`: **ENABLE, không FORCE** (như `migrations-hub/0019`, readiness #11); policy `process_timers_hub_rw` theo tenant như 0019; GRANT `SELECT, INSERT, UPDATE` cho `hub_rw` (không DELETE). Vòng quét đọc ở scope `system` (như sweeps hiện có).

## 5. Bảo mật (hard stop tenant — security review bắt buộc)
| # | Rủi ro | Hàng rào |
|---|---|---|
| S1 | Vòng hẹn giờ scope `system` đổi nhầm dữ liệu tenant khác | PD-R11: lọc `tenant_id` tường minh mọi truy vấn trong tx; khoá theo `(id, tenant_id)`; test 2 tenant cùng tới hạn (AC-H46). Mọi vòng nền mới có test cách ly như regression `scanDue` P-c2 (`c5e9b6b8`) |
| S2 | Chuyển cấp cấp quyền cho Group sai tenant / lộ phòng | PD-R20/R23: kiểm Group cùng tenant lúc lưu **và** lúc chuyển; grant gắn task (HUB-BR-25); audit; security review riêng |
| S3 | Thử lại gọi trùng hành động thật | PD-R05: job đã gửi `side_effect` không thử lại |
| S4 | Hẹn giờ bắn trùng / mất khi khởi động lại | UNIQUE `idempotency_key` + `fired_at` trong cùng tx + `SKIP LOCKED`; DB là nguồn (spike bài 3a) |
| S5 | P-d2: tool chạy vượt quyền / tool của tenant khác | [spec-d2 §5](spec-d2.md) + công tắc theo tenant [spec-tz-tools TT-R05…R08](spec-tz-tools.md) |

## 6. UI (frontend-lead)
Mockup `mockup/01–04` (duyệt ở Gate). Không thêm node kiểu mới. **Câu chữ VI/EN nguyên văn: [`plan-frontend-i18n.md`](plan-frontend-i18n.md) (i18n thắng khi lệch)**. Màn múi giờ tenant: [spec-tz-tools §1](spec-tz-tools.md).

| Màn | Thay đổi P-d1 | Ghi chú |
|---|---|---|
| admin-web canvas → panel stage | Executor "Chờ tới ngày" (nguồn ngày: input/trường stage trước, ± ngày, giờ); khối gate thêm "Nhắc mỗi (giờ)", "Chuyển cấp sau (giờ)" + "Chuyển cấp tới nhóm"; form quy trình thêm "Thời hạn lượt chạy (ngày)" + "Không hết hạn" | lỗi luật inline theo `rules[]` (`WAIT_INVALID`, `ESCALATE_INVALID`) |
| admin-web input def · chat-web form `!key` | kiểu "Ngày" (`<input type=date>`) | — |
| chat-web StageStrip / Run / Inbox | nhãn: "Chờ tới {ngày}", "Đang thử lại (n/3)", "Đang chờ hẹn", "Đã chuyển cấp"; lý do quyết định `retry_exhausted` ("Đã thử lại tối đa 3 lần mà vẫn lỗi."), `timer_invalid` ("Ngày hẹn không hợp lệ hoặc đã quá hạn lượt chạy.") | khoá `process.common.*`, role e2e ở plan-frontend |

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Ghi chú |
|---|---|
| ADR-0017 **Accepted** | Xong 2026-10-17 (staging 10.000 run); ADR đã theo D3. Điều kiện: sửa #190 ở T9 |
| ADR-0022 Accepted **hoặc** cách gọi workflow hiện có của `/mcp` | Điều kiện Gate P-d2 (T16); không cần ADR-0018 (readiness #18) |
| Mốc dọn-seed (CR-081) đóng | Trước P-d1 (D14) |
| Giả lập | đồng hồ giả qua port `Clock` ([spec-ca §4](spec-ca.md)); `fake-cli` `#fake:` thêm ca lỗi tạm theo lượt |

## 8. Tiêu chí nghiệm thu
AC-H39…H47 + test khoá bị ảnh hưởng: [`spec-ac.md`](spec-ac.md). Lệnh xong: `done:pd1`, `done:pd2` + `done:pa/pb/pb2/pc/pc2`.

## 9. Quyết định
### Trước Gate (đã chốt với người dùng — 2026-10-17)
D1…D15: [`spec-decisions.md`](spec-decisions.md).

### Câu hỏi mở
Không còn; ADR-0017 Accepted ([`spec-decisions.md`](spec-decisions.md)).

### Quyết định từ PLAN + readiness lần 2 (Luật 2b, 2026-10-17)
D-PD02/04/07/09/10/11/13 (plan.md), D2-05…08 (plan-d2.md), retry team, FD1–FD11 (plan-frontend.md §0): [`spec-decisions.md`](spec-decisions.md) "Quyết định từ PLAN".

**Báo người dùng ở Gate:** (1) vòng nhắc production bật lần đầu nhắc ngay các task cũ quá hạn; (2) retry `parallel_merge` gọi lại cả lượt ⇒ tốn token.

### Trong lúc làm (agent tự quyết theo Luật 2)
- (chưa có)

## 10. Tranh chấp test
- 2026-10-18 T5 · PD-C15 `contracts-pd1-issues.test.ts:55` — chi tiết `test-plan-addendum.md` §4.
