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
- Cờ `ADMIN_FROZEN_MODULES=off`: `GET /admin/workflow-tools/usage` mount KHÔNG theo cờ (`mountAiToolsUsage`) ⇒ danh sách + "Dùng bởi" luôn có; `/:id/companies` + công tắc theo công ty vẫn theo cờ, ngăn chi tiết (cờ build `PUBLIC_FROZEN_MODULES`) thay bằng dòng "Workflow Dify chưa bật trên hệ thống này" + lý do. Int có ca cờ off.

## Khác biệt so với artboard
Ảnh chụp do điều phối làm ở lượt UAT trên stack gộp. Đã sửa: ⓘ cạnh tiêu đề + ⓘ cột "Dùng bởi", chú giải biểu tượng agent/lệnh ở chân bảng, "6 trong N · Xem thêm" (đầu 6, +20). Còn lại, CHỜ DUYỆT UAT:
1. Chip: thêm 2 chip loại (Agent, Lệnh) ngoài 3 chip artboard (spec R6 "+ loại"); hook/quy trình chưa có nguồn nên chưa có chip.
2. "Dùng bởi" chỉ agent + lệnh; tooltip bằng `title` gốc.
3. Ngăn chi tiết artboard không vẽ: dùng `DetailDrawer` chung.
4. Breadcrumb "Hệ thống › Công cụ AI" như artboard; link Hệ thống chờ c22.

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
