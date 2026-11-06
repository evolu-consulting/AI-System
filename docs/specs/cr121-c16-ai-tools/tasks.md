---
id: cr121-c16-ai-tools
lát: cr121-c16-ai-tools
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: docs/specs/cr121-c/spec.md R6 (+ R1, R2 dòng `?tab=workflow-tools`), c10
---
## Plan (ngắn)
Làm theo artboard `scratchpad\cr121-design\project\AiTools.dc.html` (toàn trang: tiêu đề, hàng chip, ô tìm, bảng 4 cột, "n trong N · Xem thêm", trạng thái rỗng "Mọi công cụ đều đang được dùng.") + ngăn chi tiết theo spec R6 (artboard không vẽ ngăn; dùng `DetailDrawer` chung của C-1b).
`/ai-tools` thay điểm đến tạm `/workflows` của c10. Hàng = một công cụ AI (workflow Dify); "Dùng bởi" = số agent + số lệnh gọi tới nó.

## Làm
- admin-api `modules/workflow-tools`: `GET /admin/workflow-tools/usage` ("Dùng bởi" cả danh mục: một lượt, 2 câu SQL cố định = kiểm quyền đọc bảng Hub + một select subquery tương quan) và `GET /admin/workflow-tools/:workflow_id/companies` (công ty + công tắc, 2 câu: tồn tại + select). platform_admin only, vai khác 403 ở middleware. Công tắc vẫn `PUT|DELETE /admin/tenants/:id/workflow-tools/:wid` (không đổi).
- contracts `AiToolUsage*`, `WorkflowCompany*` trong `workflow-tools.ts`.
- admin-web `features/ai-tools/**` (api, lib thuần + test, hooks, toolbar chip, bảng, ngăn `AiToolDrawer`, `CompanyToolsList`, `ToolOffDialog`); route `/ai-tools?kind=agent|command&status=on|unused&q=&tool=<id>&notice=company-tools`.
- D6 (cùng lát): chuyển công tắc từ tab công ty sang ngăn Công cụ AI; GỠ `features/tenants/{components/tools/*,hooks/use-tenant-tools.ts,lib/tenant-tools.test.ts}`, hàm `useTenantWorkflowTools/useSetTenantTool` ở `tenants/api.ts`, tab `workflow-tools` (`workspace-tabs.ts`, `TenantDetailPage.tsx`), khoá i18n `tenants.tools.*` + `tenants.tab.workflowTools`; `?tab=workflow-tools` ⇒ `/ai-tools?notice=company-tools` (route `$tenantId` `beforeLoad`).
- `nav.ts`: gỡ `aiToolsDestination`/`parseAiToolKind` (điểm đến tạm c10), thêm breadcrumb `/ai-tools`.
- e2e cũ PD2-E03 (`e2e/P-d/admin-tenant.pd.ts`, đọc tab cũ) gỡ; thay bằng `e2e/cr121-c16-ai-tools.spec.ts`.
- i18n `aiTools.*` vi+en.

## Không làm / Chạm
Hệ thống (c22), Công ty › Quy trình (c11), hub-api processes. Hook / quy trình trong "Dùng bởi" + chip loại: CHƯA có nguồn đọc ở admin (không có bảng hook; quy trình gọi tool qua `hub` không có liên kết workflow ở schema admin) ⇒ chỉ agent + lệnh; thêm khi có nguồn. Perf: đọc theo tập, số câu SQL cố định (int đo); danh sách ≤ 200 công cụ lọc ở client.

## Test tối thiểu
unit `features/ai-tools/lib/ai-tools.test.ts`, `tenants/lib/{workspace-tabs,workspace-search}.test.ts`, `shell/lib/nav.test.ts`; int `apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts` (đường chính + đếm câu SQL không đổi khi thêm 20 workflow; 403 tenant_admin); e2e viết, KHÔNG chạy.

## Quyết định trong lúc làm
- Hàng = công cụ (workflow Dify) theo artboard; chip loại = lọc theo loại đang dùng (Agent · Lệnh). `?kind=workflow` cũ = không lọc.
- "Chưa dùng" = 0 agent và 0 lệnh; "Đang bật" = workflow bật toàn hệ thống.
- Số đếm chip tính trên toàn danh mục, không đổi theo bộ lọc.
- `workflow-tools` chỉ mount khi `ADMIN_FROZEN_MODULES=on` (app.ts) — route mới đi cùng mount đó (như tab cũ).

## Khác biệt so với artboard (chưa duyệt)
CHƯA CHỤP ĐƯỢC ảnh thật: dev stack ở worktree đã dựng (admin-api :3411 + admin-web :3410) nhưng đăng nhập cần mật khẩu seed trong `.env.local` mà phiên bị chặn đọc (credential) ⇒ không vào được. Đối chiếu bằng code (CHƯA duyệt, cần ảnh):
1. Tiêu đề: artboard có biểu tượng ⓘ cạnh "Công cụ AI" (tooltip), bản làm dùng dòng mô tả dưới tiêu đề (PageHeader chung).
2. Tooltip ⓘ ở cột "Dùng bởi": bản làm không có; mỗi pill có `title` + chữ cho trình đọc màn hình.
3. Hàng chip: artboard 3 chip trạng thái + loại nằm cùng hàng; bản làm thêm 2 chip loại (Agent, Lệnh) cùng hàng, ô tìm bên phải (cuộn xuống dòng khi hẹp). Chip dạng nút `aria-pressed`, màu theo token shell (không mã màu cứng).
4. Bảng: cột, nhãn đúng artboard; cột "Công cụ" dùng biểu tượng workflow chung (artboard cũng 1 biểu tượng); trạng thái chấm + chữ; "Dùng bởi" chỉ agent + lệnh (hook/quy trình chưa có nguồn).
5. Chân bảng: artboard "6 trong 26 công cụ · Xem thêm" + chú giải biểu tượng loại; bản làm có "n trong N công cụ · Xem thêm" (đầu 10, +25), KHÔNG có chú giải biểu tượng.
6. Trạng thái rỗng "Mọi công cụ đều đang được dùng." + "Xem tất cả": có, hiện khi lọc Chưa dùng mà không còn công cụ nào (artboard vẽ riêng như ví dụ).
7. Breadcrumb: artboard "Hệ thống › Công cụ AI"; bản làm đặt đúng như vậy (link Hệ thống → /system, route do c22).
8. Ngăn chi tiết: artboard không vẽ; theo spec R6 làm bằng `DetailDrawer` (C-1b).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Công cụ AI — danh sách gộp + bật/tắt Dify theo công ty
Trang `/ai-tools` (platform_admin) liệt kê công cụ AI với trạng thái, "Dùng bởi" (số agent, số lệnh), chip Tất cả · Đang bật · Chưa dùng · Agent · Lệnh và ô tìm; bấm hàng mở ngăn chi tiết có "Dùng bởi" và "Công ty dùng" với công tắc bật/tắt theo công ty (nơi duy nhất; tab `workflow-tools` của trang công ty đã gỡ, URL cũ chuyển tới `/ai-tools`).
- Kịch bản: khi lọc "Chưa dùng" thì chỉ còn công cụ không agent/lệnh nào gọi [test: apps/admin-web/src/features/ai-tools/lib/ai-tools.test.ts » filterTools]
- Kịch bản: khi mở `?tab=workflow-tools` của công ty thì chuyển tới /ai-tools kèm thông báo [test: apps/admin-web/src/features/tenants/lib/workspace-search.test.ts » CR-121 c16 · ?tab=workflow-tools cũ]
- Kịch bản: khi bật công cụ cho một công ty ở ngăn chi tiết thì công ty đó đếm trong "Công ty dùng" [test: apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts » đọc theo tập]
- Kịch bản: khi tenant_admin gọi API "Dùng bởi"/"Công ty dùng" thì 403 [test: apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts » vai khác platform_admin]
- Kịch bản: hành trình tìm công cụ, bật cho công ty, tải lại vẫn bật, tắt có xác nhận [test: e2e/cr121-c16-ai-tools.spec.ts » tìm công cụ → ngăn chi tiết]

## Việc còn lại
- Chụp ảnh thật cạnh artboard (bị chặn đọc mật khẩu seed) + duyệt các khác biệt 1–8; hook / quy trình trong "Dùng bởi" khi có nguồn đọc.
- qc: e2e cũ nào còn nhắc tab `Quy trình`/`Tool quy trình` (xem báo cáo).
