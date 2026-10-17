# P-d2 · Stage `tool` (MCP) + rẽ nhánh theo `output.fields` (CR-087)

Phần lát P-d2 của [`spec.md`](spec.md) (frontmatter, phạm vi chung, enum chung §3, bảo mật chung §5, phụ thuộc §7 ở đó). Bắt đầu sau khi P-d1 xong. Quyết định: [`spec-decisions.md`](spec-decisions.md) D10–D12, B1–B7. Công tắc tool theo tenant (Admin): [`spec-tz-tools.md` §2](spec-tz-tools.md) (ADM-FR-73). AC: [`spec-ac.md`](spec-ac.md) (AC-H44, AC-H45, AC-H47, AC-A15). **Đặt code** (ADR-0023, CR-090): [`spec-ca.md` §3](spec-ca.md) — luật `tool`/nhánh ở `processes/domain/{tools,branch,defs}/`, use case + port `ToolInvoker`/`ToolSwitchReader` ở `application/tools/`, gọi `/mcp` + công tắc + routes catalog ở `adapters/tools/`; file cũ chạm (`step.rules.ts`, `step-persist.ts`, `back.effects.ts`) tách theo [spec-ca §5](spec-ca.md).

## 1. Mục tiêu
Flow nghiệp vụ (duyệt hợp đồng, nhắc thanh toán) cần (a) bước gọi hệ thống khác không qua agent LLM, (b) rẽ nhánh theo dữ liệu có cấu trúc. **Đảo** mục "Stage lồng/rẽ nhánh theo điều kiện" trong "Không làm" của [P-b2 §1.2](../P-b2-canvas/spec.md).

**Không làm:** tool ngoài Hub `/mcp`; LLM chọn nhánh; nhánh lùi/vòng lặp (dùng `back_to_steps`); node kiểu mới trên canvas; tự duyệt HUB-FR-108.

## 2. Nghiệp vụ — stage `tool` (PD2-R)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| PD2-R01 | Executor `{kind:'tool', tool_key, args}`. `tool_key` = `key` workflow trong catalog Admin (`^[a-z0-9-]{2,32}$`, HUB-BR-11) **khả dụng cho tenant** = workflow `enabled` ∧ công tắc `admin.tenant_workflow_tools` bật cho tenant ([TT-R04](spec-tz-tools.md)); không cần agent grant. Tool của gói (ADR-0018) để sau. Lưu def: tool không tồn tại / không bật / khác tenant / def mẫu (tenant null, D2-06) ⇒ 422 **`PROCESS_REF_INVALID`** (không lộ tồn tại, readiness #13) | D10, HUB-BR-12, câu 3 |
| PD2-R02 | `args`: map tên tham số → nguồn: `{from:'input', key}` (input run) · `{from:'field', stage_key, field}` (output hiện hành của stage ở **bước nhỏ hơn bất kỳ**, readiness #15) · `{from:'const', value}` (string/number/boolean). ≤ 20 tham số (Q6). Thiếu tham số bắt buộc của tool, tham số kiểu `file` (D2-07), nguồn không tồn tại trong def ⇒ 422 `PROCESS_DEF_INVALID` luật **`TOOL_INVALID`**. Lúc chạy stage nguồn `skipped` / không output ⇒ `tool_failed` | D10 |
| PD2-R03 | Chạy: **không tạo job agent**; Hub gọi tool qua cùng bộ điều phối của `/mcp` với danh tính **người bắt đầu** (user + tenant): workflow ⇒ Dify (biến khách theo ADR-0022 #4, token/chi phí ghi cho người bắt đầu, #5). Ngay trước khi gọi ([TT-R06](spec-tz-tools.md)): người bắt đầu active + thuộc Group được chạy quy trình (HUB-BR-27; sai ⇒ `permission_lost`/`user_inactive`); công tắc tenant còn bật ∧ workflow `enabled` (đọc DB, lọc `tenant_id` tường minh; sai ⇒ `tool_failed`). Timeout = `timeout_s` của stage | D10, câu 3 |
| PD2-R04 | Tool `side_effect` ⇒ stage phải `real_action=true` (luật P-b2: mọi stage bước trước có gate review). Sai ⇒ 422 luật **`TOOL_SIDE_EFFECT`**. Gate đạt thay xác nhận (HUB-FR-109); audit ghi người duyệt | D10, HUB-BR-20 |
| PD2-R05 | **Lỗi:** lỗi tạm **trước khi gửi** (không kết nối được, DNS) ⇒ thử lại theo PD-R03 (CR-083). Lỗi sau khi đã gửi: tool **không** `side_effect` và lỗi tạm ⇒ thử lại như PD-R03; tool `side_effect` ⇒ **không gọi lại**, `needs_decision` lý do **`tool_failed`** (thêm cuối). Lỗi nghiệp vụ của tool (4xx, từ chối quyền) ⇒ `tool_failed`. Công tắc tenant tắt / workflow tắt lúc chạy (kể cả khi tắt trong lúc run đang chờ, TT-R07) ⇒ `tool_failed`; người bắt đầu mất quyền / bị khoá ⇒ `permission_lost` / `user_inactive` (B4). `tool_failed`: `use_current` chỉ khi stage có output hiện hành (`decisionOptionsFor`, readiness #14) | D10, D3 |
| PD2-R06 | **Output:** kết quả JSON của tool lọc theo khai báo `output.fields` (kiểu `number`/`string`/`date`, `required`), lưu `process_outputs.fields`; sai kiểu/thiếu trường bắt buộc ⇒ `template_invalid` (lỗi nghiệp vụ ⇒ `needs_decision` ngay, không tự làm lại — D2-05). Kết quả > 64 KB ⇒ `tool_failed` (Q6) | D11 |
| PD2-R07 | Hub **sinh file .md** (giữ P-R03): `## Kết quả` (bảng trường) + `## Bàn giao` (≤ 200 token, liệt kê trường) + khối ```fields```. Lưu def stage `tool` ⇒ Hub **ép** `required_sections = ["Kết quả","Bàn giao"]` + template nguyên văn (như `ensureHandoff`), ép `answerer={kind:"starter"}`, `timeout_s` giữ (dùng cho timeout gọi tool) — [plan-d2 §3](plan-d2.md) (readiness #7, #51). Nội dung kết quả không đưa nguyên vào audit | D11 |
| PD2-R08 | Stage `tool` không có `sources`/`must_know`/`autofix`/`answerer` hỏi lại (tool không hỏi). `after` được `review` hoặc `auto` | D10 |
| PD2-R09 | Audit mỗi lần gọi: `tool_call` (run, stage, tool_key, người bắt đầu, trạng thái, thời gian); **không** ghi giá trị tham số/kết quả. Ghi `hub.runs` (`stage_run_id` = stage) / `hub.run_steps` (`type='tool'`, `agent_id` NULL, `workflow_id`; D2-03) / `hub.usage_logs` cho người bắt đầu **như một lời gọi workflow qua `/mcp`** (readiness #26) — nhờ đó PD-R05 nhận ra "đã gửi `side_effect`" | D10 |

## 3. Nghiệp vụ — rẽ nhánh
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| PD2-R10 | `after.branch: BranchRule[]` (≤ 10, mặc định `[]`) ở **cả hai** biến thể `after`. Chỉ cho stage **đứng một mình trong bước** (Q5); sai ⇒ 422 **`BRANCH_INVALID`** | D12 |
| PD2-R11 | `BranchRule = {field, op, value, goto_step}`; `op` ∈ `eq ne lt le gt ge` (= ≠ < ≤ > ≥). `field` phải có trong `output.fields` của chính stage; `lt…ge` chỉ cho `number`/`date` (date so `YYYY-MM-DD`); `value` cùng kiểu trường; `goto_step` (**0-based** như `ProcessStepSchema`; UI đếm từ 1 — G-4) > `step` của stage và là bước có thật. Sai ⇒ `BRANCH_INVALID` | D12 |
| PD2-R12 | Đích có stage `real_action` ⇒ stage rẽ nhánh phải `after.kind='review'` (gate đạt của nó thay "bước liền trước có gate"; bước liền trước có hiệu lực = bước gần nhất không toàn `skipped`, D2-08) — sai ⇒ `BRANCH_INVALID` | D12, HUB-BR-38(b) |
| PD2-R13 | Đánh giá khi stage chốt `done` (Đạt hoặc `auto`), trên `fields` của output hiện hành, theo thứ tự mảng; trường vắng ⇒ luật đó không khớp. Luật đầu tiên khớp ⇒ trong cùng tx join bước: mọi stage của bước `step+1 … goto_step-1` ⇒ **`skipped`** (thêm cuối `STAGE_RUN_STATUSES`, `finished_at = now`), `current_step = goto_step`; hẹn giờ của stage bị nhảy ⇒ huỷ. Không khớp ⇒ bước kế như cũ | D12 |
| PD2-R14 | Ghi tin thread "Rẽ nhánh: tới bước {X} (luật {n})" (`X` = `goto_step + 1`, `n` đếm từ 1) + audit `branch` (actor hệ thống). `skipped` được coi là xong khi xét join/`done` của run | D12, HUB-BR-38(e) |
| PD2-R15 | Quay lại (`back_to_steps`) tới bước ≤ bước bị nhảy ⇒ stage `skipped` về `pending` như mọi bước sau đích (PB2-R07); nhánh được đánh giá lại khi stage rẽ nhánh xong lần sau | D12 |

## 4. Contract P-d2
Enum thêm cuối: [spec §3](spec.md) (`EXECUTOR_KINDS`+`tool`, `STAGE_RUN_STATUSES`+`skipped`, `DECISION_REASONS`+`tool_failed`, `PROCESS_DEF_RULES`+`TOOL_INVALID`/`TOOL_SIDE_EFFECT`/`BRANCH_INVALID`).

| Chỗ | Thay đổi |
|---|---|
| `ProcessStageDefSchema.executor` | + `{kind:'tool', tool_key, args: Record<string, ArgSource>}` |
| `after` (cả `review` và `auto`) | + `branch: BranchRule[] ≤ 10, default []` |
| Hằng | `TOOL_ARGS_MAX=20` · `TOOL_RESULT_MAX_BYTES=65536` · `BRANCH_RULES_MAX=10` · `BRANCH_OPS` |
| `StageView` | trạng thái `skipped`; + `tool_key?` |
| `ProcessRunFullView` | không thêm `branch_events`: đọc từ `HistoryItem.kind=branch` |
| Catalog tool cho editor | theo D-PD11: `GET /process-editor/context` trả danh sách tool **khả dụng cho tenant người gọi** (TT-R04: tên, key, mô tả, tham số, `side_effect`) |
| Admin (ADM-FR-73) | `GET/PUT/DELETE /admin/tenants/:id/workflow-tools[/:workflow_id]` — [TT-R03](spec-tz-tools.md) |

## 5. Dữ liệu + bảo mật
- Migration hub P-d2 (dự kiến `0037_pd2_tool_branch.sql`): chỉ dựng lại CHECK nới `stage_runs.status` (`skipped`), `review_tasks.reason` (`tool_failed`), action audit (`tool_call`, `branch`), loại tin thread (`branch`, `ROOM_PROCESS_KINDS`) — readiness #12. Không bảng `hub` mới (nhánh ghi audit + thread).
- Migration **admin** P-d2: bảng `admin.tenant_workflow_tools` ([TT-R01/R02](spec-tz-tools.md)).
- **Bảo mật (security review):** tool chạy với danh tính người bắt đầu, không bao giờ token job/agent; chỉ tool trong Hub `/mcp` (không URL tuỳ ý ⇒ không SSRF mới); `side_effect` chỉ sau gate; không gọi lại sau khi đã gửi; tool không bật cho tenant / tenant khác ⇒ `PROCESS_REF_INVALID` (lưu) / `tool_failed` (chạy); công tắc đọc theo `tenant_id` của run (TT-R08); audit không chứa dữ liệu khách. Tool gói (ADR-0018) để sau.

## 6. UI P-d2 (cần mockup trước Gate)
| Màn | Thay đổi |
|---|---|
| admin-web panel stage | Executor "Gọi tool" (quy trình mẫu không chọn được tool — D2-06): chọn tool (nhãn `side_effect`), map tham số (input / trường stage trước / hằng); khối "Rẽ nhánh": danh sách luật (trường, phép so sánh, giá trị, tới bước); canvas vẽ mũi tên nét đứt từ stage tới cột đích (không node mới) |
| chat-web StageStrip / Run | nhãn "Bỏ qua" cho stage `skipped`; lý do `tool_failed` = "Gọi tool bị lỗi." (khoá `process.common.tool_failed`) — câu chữ nguyên văn: [`plan-frontend-i18n.md`](plan-frontend-i18n.md) (i18n thắng) |
| admin-web chi tiết tenant | tab mới "Tool quy trình" (công tắc mỗi workflow) — [spec-tz-tools §2](spec-tz-tools.md) |

## 7. Câu hỏi mở P-d2
Không còn — Q5, Q6 đã chốt ([`spec-decisions.md`](spec-decisions.md)).
