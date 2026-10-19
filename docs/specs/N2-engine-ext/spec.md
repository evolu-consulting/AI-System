---
id: N2-engine-ext
status: approved
fr: [N2-FR-01, N2-FR-02, N2-FR-03, N2-FR-04, N2-FR-05]
nguon: docs/platform/intake-hd.md (N2 — R10, R13, R14, R15, R16), CR-094 đợt 2, CR-087
---
# N2 · Mở rộng engine quy trình

Chạm engine P-d đã đóng (`ket-luan-pd2.md`) + khung gói N1 (`N1-pack-frame/ket-luan.md`). Làn đầy đủ (quyền, tenant, contract). Quyết định: `plan.md` §Quyết định (mã N2-Dxx).

## 1. Phạm vi
| Làm | Không làm |
|---|---|
| N2-FR-01 gói khởi chạy run trong cùng process (cổng `PackRuns`), gắn `run_id` vào bản ghi gói; mẫu ở `pkdemo` | HD2/HD3 (def mẫu duyệt HĐ, route gói hợp đồng), N3 thông báo, N5 định danh |
| N2-FR-02 kết quả task review **Từ chối** (`reject`): bắt buộc lý do, kết thúc run | Màn chat-web nút "Từ chối" (HD3 dùng; chat-web chỉ có nhãn) |
| N2-FR-03 tool của gói: đăng ký trong Hub, chạy trong tx gói (`withPackScope`), stage `tool` gọi được, `/mcp` liệt kê/gọi khi job cho phép | Tool gói `side_effect` gọi từ agent qua `/mcp` (luôn từ chối — chỉ stage `real_action`) |
| N2-FR-04 trần run đồng thời cấu hình theo tenant (mặc định 5, `waiting_review` vẫn đếm) + ô sửa ở admin | Đổi tập trạng thái tính trần (giữ `PROCESS_RUN_CAP_COUNTED`) |
| N2-FR-05 cờ stage `after.review.exclude_starter`: người bắt đầu run không được quyết task duyệt của stage + checkbox ở editor | Chặn người bắt đầu ở task `ask` và `decision` lý do ngoài `redo_limit`/`back_limit` (N2-D06) |

## 2. Yêu cầu
| Mã | Yêu cầu | AC |
|---|---|---|
| N2-FR-01 | `PackRuns.start(user, {process_key, input, inputs?})` mở run như `POST /process-runs` origin none (kiểm def bật + Group chạy + trần + inputs) **chưa kick**; gói ghi `run_id` vào bản ghi trong tx gói rồi `kick()`. Ghi lỗi ⇒ huỷ run (bù). Không HTTP nội bộ (PK-BR-01) | N2-AC01: `POST /pack/pkdemo/items/:id/run` ⇒ 201 `{run_id}`, `items.run_id` = run, run `started_by` = người gọi, cùng tenant. N2-AC02: def không chạy được ⇒ 404 `PROCESS_NOT_FOUND`, trần ⇒ 429, item tenant khác ⇒ 404; cả ba `run_id` vẫn null, không có run mới |
| N2-FR-02 | `ReviewDecisionRequest.result` thêm `reject`; `TASK_RESULTS` thêm `reject` **cuối**. Thiếu/rỗng `feedback` ⇒ 422 `FEEDBACK_REQUIRED`. Từ chối ⇒ task `closed/reject` (+ feedback), stage + run `cancelled`, task khác đóng `cancelled`, tin thread `task_result` + `run_end` | N2-AC03: reject không lý do 422, run vẫn `waiting_review`. N2-AC04: reject có lý do ⇒ run `cancelled`, task `reject` + feedback; Đạt sau đó ⇒ 409 `REVIEW_TASK_CLOSED`. N2-AC05: "Chưa đạt" giữ nguyên hành vi (làm lại) |
| N2-FR-03 | `PackToolRegistry.register({pack, name, description, side_effect, params, run})`; khoá tool = `<pack>-<name>` (khớp `ProcessKeySchema`). Stage `tool` dùng khoá này như workflow: lưu def kiểm theo registry + tenant đã bật gói; chạy giữ nguyên kiểm P-d2 (`usable`, `canRun`, công tắc = gói bật cho tenant, `side_effect ∧ ¬real_action ⇒ tool_failed` D2-49, audit `tool_call`). `run` nhận `{tenantId, userId = người bắt đầu, runId}` và mở `withPackScope` của tenant run | N2-AC06: stage tool gói ⇒ hàng gói ghi đúng tenant run, output fields, run tiếp. N2-AC07: tenant chưa bật gói ⇒ lưu def 422 `PROCESS_REF_INVALID`; tắt gói sau khi lưu ⇒ `tool_failed`, 0 lời gọi. N2-AC08: tool gói `side_effect` ở stage không `real_action` ⇒ `tool_failed`, 0 lời gọi. N2-AC09: `/mcp` `tools/list` có tool gói chỉ khi khoá ∈ `payload.mcp.tools` ∧ tenant bật gói ∧ không `side_effect` |
| N2-FR-04 | Cột `admin.tenants.process_runs_max int NOT NULL DEFAULT 5 CHECK 1..1000`; Hub đọc cùng câu đếm trần (0 câu thêm); seam test `processRunsPerTenant` vẫn thắng. Admin `PATCH /admin/tenants/:id` nhận `process_runs_max` (platform_admin), response có trường | N2-AC10: tenant A trần 1 ⇒ run 2 429 (`waiting_review` vẫn đếm); tenant B cùng lúc 201. N2-AC11: PATCH 0 / 1001 ⇒ 400; 200 ⇒ đọc lại 200 |
| N2-FR-05 | `after.review.exclude_starter: boolean` (mặc định false, snapshot cũ đọc `?? false`). Bật ⇒ người bắt đầu quyết task review của stage ⇒ 403 `STARTER_CANNOT_REVIEW` (kể cả là thành viên Group duyệt/chuyển cấp/được chuyển), `can_act=false` | N2-AC12: starter ∈ G1 ⇒ 403, người khác ∈ G1 ⇒ 200. N2-AC13: cờ tắt ⇒ starter ∈ G1 quyết được (hành vi cũ) |

## 3. Contract (chỉ thêm)
| Chỗ | Thay đổi |
|---|---|
| `chat/processes.ts` | `TASK_RESULTS` += `"reject"` (cuối) |
| `chat/processes-api.ts` | `ReviewDecisionRequestSchema.result` = `pass \| fail \| reject` |
| `chat/processes-errors.ts` | khối riêng `CHAT_PROCESS_N2_ERRORS`: `STARTER_CANNOT_REVIEW: 403`, `PROCESS_ENGINE_OFF: 503` |
| `hub-admin/processes.ts` | `after.review.exclude_starter: z.boolean().default(false)` |
| `tenants.ts` | `process_runs_max` (1…1000): response optional (server luôn trả), PATCH optional; `TENANT_PROCESS_RUNS_MAX = {min:1,max:1000,default:5}` |
| DB | hub `0041_n2_engine.sql` (CHECK `review_tasks_result_ck` += `reject`); admin `0013` cột `process_runs_max`; gói `pkdemo/0002` cột `items.run_id uuid` |

## 4. Hiệu năng
Start: 0 câu thêm (đọc trần gộp vào câu đếm). Quyết review: +0 câu (cờ đọc từ snapshot đã khoá). Tool gói: `loadCall` vẫn MỘT câu; kiểm gói bật = cache (0 SQL nóng). Perf P-d d2 không xấu hơn (đo lại `d2.perf`).

## Quyết định trong lúc làm
Xem `plan.md` §Quyết định.

## Tranh chấp test
(trống)
