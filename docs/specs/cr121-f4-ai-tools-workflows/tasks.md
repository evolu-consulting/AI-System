---
id: cr121-f4-ai-tools-workflows
lát: cr121-f4-ai-tools-workflows
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c16-ai-tools
---
## Plan (ngắn)
Lỗi sản phẩm F4: gộp Công cụ AI làm mất chức năng của danh sách workflow cũ. Chuyển (D6) vào `/ai-tools`, dùng lại hook/API của `features/workflows`:
UI theo artboard `AiTools.dc.html` (hàng + ngăn chi tiết), phần mới nằm trong ngăn/menu hàng, không đổi bố cục bảng.

## Làm
- Menu hàng (workflow): Bật/Tắt, Xoá (đọc bản mới `fetchWorkflow` để có `version`/`key`). Ngăn chi tiết (workflow): công tắc "Bật toàn hệ thống", Secret, "Mở trong Dify" (`console_url`), Xoá.
- Bật/tắt/xoá dùng `useWorkflowActions` cũ ⇒ 409 `WORKFLOW_IN_USE` mở `WorkflowBlockedDialog` nêu agent/lệnh đang dùng + câu cách gỡ mới (`workflows.blocked.howToFix`); xoá = gõ lại mã như cũ; xung đột phiên bản = ConflictDialog.
- Lọc `?secret=<tên>`: API `/admin/ai-tools` thêm `secret` + `key` cho dòng workflow (cùng một UNION ALL, không thêm câu SQL); chip "Dùng secret X" bỏ được. Ô tìm khớp cả mã workflow (không hiện trên UI) để liên kết từ Secrets (`?q=<mã>`) hoạt động.
- Secrets: 4 chỗ trỏ `/ai-tools?kind=workflow&secret=` / `&q=<mã>`; `/workflows?secret=` cũ chuyển hướng giữ `secret`, `q`.
- Gỡ: `WorkflowsPage`, `components/list/{WorkflowFilters,WorkflowGuide,WorkflowRowMenu,WorkflowTable,UsageCell}`, `use-workflows-nav`.

## Không làm / Chạm
Khoá i18n `workflows.list.*`/`workflows.chip.*`… của list cũ còn mồ côi (dọn khi có check key thừa). Perf: không thêm câu SQL (1 cột subquery theo secret_id trong UNION ALL hiện có).

## Soát 3 chỗ qc tự sửa (F4)
- Nút "Tạo lệnh"/"Tạo workflow" ở `AiToolsPage`: ĐÚNG, giữ (danh sách lệnh/workflow cũ mất nút tạo; trỏ `/commands/new`, `/workflows/new`).
- Nút "Xoá" ở editor `/commands/$id`: ĐÚNG, giữ (xác nhận nặng gõ tên + nêu tính năng; xong về `/ai-tools?kind=command`).
- Gỡ `CommandsPage` + `components/list/*` + 4 hook: ĐÚNG về D6 (danh sách thay bằng Công cụ AI). Mất: công tắc bật/tắt lệnh ngay trên hàng — công tắc "Bật" còn ở editor lệnh (phải Lưu). Chấp nhận; nếu cần bật/tắt lệnh từ hàng thì làm lát riêng.

## Test tối thiểu
unit `ai-tools.test.ts` (lọc secret, tìm theo mã); int `workflow-tools.usage.int.test.ts` (dòng workflow có `secret`, `key`). e2e: KHÔNG sửa (qc). Ca e2e cần đổi: `workflows.spec.ts` (13 chỗ trỏ trang danh sách cũ: tìm/lọc chip/bật-tắt/xoá/409/phân trang ⇒ sang `/ai-tools?kind=workflow`, menu hàng + ngăn), `workflows-dify.spec.ts` (nút "Mở trong Dify" nay ở ngăn chi tiết), `conflict-workflows.spec.ts` (bật/tắt từ ngăn/menu), `m2-flow.spec.ts` (đường dẫn danh sách), `secrets.spec.ts` + `studio/h4b1-secrets.studio.ts` (nút "Xem các workflow dùng secret này" ⇒ `/ai-tools?kind=workflow&secret=`), `x1/workflows-side-effect.x1.ts`, `combine/x1-side-effect.combine.ts`, `deployed/_support.ts`.

## Quyết định trong lúc làm
- Ngăn chi tiết đọc `GET /admin/workflows/:id` (có `version`, `console_url`, secret) thay vì nhét vào API danh sách gộp.
- Mã workflow chỉ để tìm, không hiện (Luật GỐC 3).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Công cụ AI giữ đủ thao tác của danh sách workflow cũ
Trên `/ai-tools`, workflow có menu hàng và ngăn chi tiết để bật/tắt, xoá (đang dùng ⇒ hộp thoại nêu agent/lệnh và cách gỡ), mở trong Dify; lọc theo secret bằng chip "Dùng secret X" (`?secret=`), nút ở trang Secrets trỏ tới đó.
- Kịch bản: khi lọc `?secret=<tên>` thì chỉ còn workflow dùng secret đó [test: apps/admin-web/src/features/ai-tools/lib/ai-tools.test.ts » lọc theo secret (nút ở Secrets) và tìm theo mã workflow]
- Kịch bản: khi danh sách gộp được đọc thì dòng workflow có secret và mã [test: apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts » đọc theo tập]

## Việc còn lại
- qc sửa các ca e2e nêu trên; chụp màn hình thật cạnh artboard ở lượt UAT điều phối.