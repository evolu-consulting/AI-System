# dify-workflows — "Mở trong Dify" + lịch sử chạy Dify (làn nhanh)

Phạm vi: Admin → Workflows (platform_admin). Không đụng RLS tenant; bảng `hub.dify_runs` cấp platform như `usage_logs`.

## Plan ngắn
1. **Link console:** env admin-api `DIFY_CONSOLE_URL` (vắng ⇒ nút ẩn) + cột mới `admin.workflows.dify_app_id` (migration main `0023`).
   `workflows.links.ts`: `workflow` → `/app/<id>/workflow`, `chat`/`agent` → `/app/<id>/configuration`, log → `/app/<id>/logs`.
   Server trả `console_url` ở list/detail; web chỉ render `<a target=_blank rel=noopener>`. Không bao giờ có app-key.
2. **Ghi lịch sử:** hub migration `0056_dify_runs` (`hub.dify_runs` + `hub.log_dify_run`, EXECUTE hub_rw, SELECT admin_rw).
   `difyUsageSelect` nhận `run?: DifyRunMeta` ⇒ cùng một câu SQL ghi usage + lịch sử (giữ số câu của T18-perf).
   3 điểm ghi: command driver (`command`), `DifyAgentRunner` + tool MCP (`agent`). `DifyClient` lấy thêm `workflow_run_id`.
3. **API:** `GET /admin/workflows/:id/runs?tenant_id&status&from&to&limit&offset` (route khoá platform_admin; Hub chưa migrate ⇒ `available:false`).
   `GET /admin/usage?workflow_id=` (platform_admin; tenant_admin 403): lọc `usage_logs.step_id` thuộc lượt Dify của workflow.
4. **Web:** tab "Lịch sử chạy" ở editor workflow (+ mục menu hàng), trường "Mã app Dify", nút "Mở trong Dify" (menu hàng + header), bộ lọc workflow ở trang Usage.

## Quyết định trong lúc làm
- Dify không có deep-link theo run id ⇒ "Xem chi tiết trong Dify" mở trang log của app (`/app/<id>/logs`).
- Trigger `schedule` có trong CHECK nhưng chưa có đường ghi (Hub chưa có lịch chạy workflow Dify trực tiếp).
- Không ghi lượt "Chạy thử" của Admin (test-run) và lỗi trước khi gọi Dify (NOT_CONFIGURED) — giống quy tắc ghi usage hiện hành.
- `dify_app_id` chưa nằm trong export/import catalog (transfer) — workflow import xong cần nhập mã app tay.
- Mã Dify (workflow_run_id/conversation_id/task_id) không phải bí mật; `error_message` lấy từ thân lỗi đã che app-key, ≤ 500 ký tự.

## Test
- unit: `workflows.links.test.ts` (builder theo loại app), `dify.usage.test.ts` (`difyRunMeta`).
- int: `workflows.runs.int.test.ts` (scoped/paged/lọc, console_url, usage theo workflow), `workflows.runs.http.int.test.ts`
  (tenant_admin 403, platform 200, PATCH dify_app_id), `dify.runs.int.test.ts` (Dify giả → dify_runs có id Dify).
- e2e (chỉ viết): `e2e/workflows-dify.spec.ts`.

## Còn lại
- e2e + UAT chạy một lần cuối đợt; server cần đặt `DIFY_CONSOLE_URL` (admin-api) rồi nhập "Mã app Dify" cho từng workflow.
