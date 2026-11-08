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
`/ai-tools` thay điểm đến tạm `/workflows` của c10. MỖI DÒNG = một công cụ, gộp agent · lệnh · workflow Dify (nhãn loại nhỏ dưới tên; "Quy trình" dành cho quy trình Hub nên Dify gọi là "workflow"). "Dùng bởi" = các CÔNG TY dùng (avatar + số công ty).

## Làm
- admin-api `modules/workflow-tools`: `GET /admin/ai-tools` (danh sách gộp {kind,id,name,enabled,companies_count,companies[≤5]}: 2 câu SQL cố định = kiểm quyền đọc bảng Hub + MỘT `UNION ALL` subquery tương quan; agent + lệnh luôn có, workflow chỉ khi module bật) và `GET /admin/workflow-tools/:workflow_id/companies` (công ty + công tắc, 2 câu: tồn tại + select). platform_admin only, vai khác 403 ở middleware. Công tắc vẫn `PUT|DELETE /admin/tenants/:id/workflow-tools/:wid` (không đổi).
- contracts `AiToolUsage*`, `WorkflowCompany*` trong `workflow-tools.ts`.
- admin-web `features/ai-tools/**` (api, lib thuần + test, hooks, toolbar chip, bảng, ngăn `AiToolDrawer`, `CompanyToolsList`, `ToolOffDialog`); route `/ai-tools?kind=agent|command&status=on|unused&q=&tool=<id>&notice=company-tools`.
- D6 (cùng lát): chuyển công tắc từ tab công ty sang ngăn Công cụ AI; GỠ `features/tenants/{components/tools/*,hooks/use-tenant-tools.ts,lib/tenant-tools.test.ts}`, hàm `useTenantWorkflowTools/useSetTenantTool` ở `tenants/api.ts`, tab `workflow-tools` (`workspace-tabs.ts`, `TenantDetailPage.tsx`), khoá i18n `tenants.tools.*` + `tenants.tab.workflowTools`; `?tab=workflow-tools` ⇒ `/ai-tools?notice=company-tools` (route `$tenantId` `beforeLoad`).
- `nav.ts`: gỡ `aiToolsDestination`/`parseAiToolKind` (điểm đến tạm c10), thêm breadcrumb `/ai-tools`.
- e2e cũ PD2-E03 (`e2e/P-d/admin-tenant.pd.ts`, đọc tab cũ) gỡ; thay bằng `e2e/cr121-c16-ai-tools.spec.ts`.
- i18n `aiTools.*` vi+en.

## Không làm / Chạm
Hệ thống (c22), Công ty › Quy trình (c11), hub-api processes. Hook: admin KHÔNG có nguồn (không có bảng hook) ⇒ bỏ, không tự chế bảng; thêm loại khi có nguồn. Nguồn "công ty dùng": agent = `hub.agent_grants.tenant_id`; lệnh = `feature_commands` ⇒ `feature_entitlements` (chưa thu hồi); workflow = `tenant_workflow_tools` (chưa thu hồi). Bẫy: agent chỉ có id (không tên) nên hiện "Agent …xxxxxx"; quyền xem công ty của agent theo grant, không phải "đang chạy". Perf: đọc theo tập, số câu SQL cố định (int đo); danh sách ≤ 200 công cụ lọc ở client.

## Test tối thiểu
unit `features/ai-tools/lib/ai-tools.test.ts`, `tenants/lib/{workspace-tabs,workspace-search}.test.ts`, `shell/lib/nav.test.ts`; int `apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts` (đường chính + đếm câu SQL không đổi khi thêm 20 workflow; 403 tenant_admin); e2e viết, KHÔNG chạy.

## Quyết định trong lúc làm
- Chip loại: Agent · Lệnh · Workflow. "Chưa dùng" = chưa công ty nào dùng.
- "Đang bật" = công cụ bật (lệnh/workflow bật toàn hệ thống; agent luôn tính bật).
- Số đếm chip tính trên toàn danh mục, không đổi theo bộ lọc.
- Cờ `ADMIN_FROZEN_MODULES=off`: `GET /admin/ai-tools` mount KHÔNG theo cờ (`mountAiToolsUsage`) ⇒ danh sách + "Dùng bởi" luôn có; `/:id/companies` + công tắc theo công ty vẫn theo cờ, ngăn chi tiết (cờ build `PUBLIC_FROZEN_MODULES`) thay bằng dòng "Workflow Dify chưa bật trên hệ thống này" + lý do. Int có ca cờ off.

## Khác biệt so với artboard
Đã khớp: mỗi dòng một công cụ + nhãn loại, cột Công cụ · Trạng thái · Dùng bởi (công ty) · Thao tác, chip Tất cả · Đang bật · Chưa dùng (+ chip loại), ô "Tìm công cụ", "6 trong N · Xem thêm", chú giải loại, ⓘ, rỗng "Mọi công cụ đều đang được dùng." + "Xem tất cả". CHỜ DUYỆT UAT:
1. Thiếu loại hook (không có nguồn ở admin).
2. Avatar công ty = chữ cái đầu (tối đa 3) + "N công ty"; artboard chưa vẽ ô "Dùng bởi" theo công ty nên chờ đối chiếu ảnh.
3. Ngăn chi tiết artboard không vẽ: dùng `DetailDrawer` chung (workflow có "Công ty dùng" bật/tắt; agent/lệnh chỉ xem).
4. Breadcrumb "Hệ thống › Công cụ AI" như artboard; link Hệ thống chờ c22.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Công cụ AI — danh sách gộp + bật/tắt Dify theo công ty
Trang `/ai-tools` (platform_admin) liệt kê MỖI DÒNG một công cụ (agent · lệnh · workflow Dify) với trạng thái, "Dùng bởi" (công ty), chip Tất cả · Đang bật · Chưa dùng · Agent · Lệnh · Workflow và ô tìm; bấm hàng mở ngăn chi tiết có "Dùng bởi" và "Công ty dùng" với công tắc bật/tắt theo công ty (nơi duy nhất; tab `workflow-tools` của trang công ty đã gỡ, URL cũ chuyển tới `/ai-tools`).
- Kịch bản: khi lọc "Chưa dùng" thì chỉ còn công cụ chưa công ty nào dùng [test: apps/admin-web/src/features/ai-tools/lib/ai-tools.test.ts » filterTools]
- Kịch bản: khi mở `?tab=workflow-tools` của công ty thì chuyển tới /ai-tools kèm thông báo [test: apps/admin-web/src/features/tenants/lib/workspace-search.test.ts » CR-121 c16 · ?tab=workflow-tools cũ]
- Kịch bản: khi bật workflow cho một công ty ở ngăn chi tiết thì dòng đó có companies_count 1 và tên công ty [test: apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts » đọc theo tập]
- Kịch bản: khi tenant_admin gọi `/admin/ai-tools` hoặc `/companies` thì 403 [test: apps/admin-api/src/modules/workflow-tools/workflow-tools.usage.int.test.ts » vai khác platform_admin]
- Kịch bản: hành trình tìm công cụ, bật cho công ty, tải lại vẫn bật, tắt có xác nhận [test: e2e/cr121-c16-ai-tools.spec.ts » tìm công cụ → ngăn chi tiết]

## Việc còn lại
- Chụp ảnh thật cạnh artboard (bị chặn đọc mật khẩu seed) + duyệt các khác biệt 1–8; hook / quy trình trong "Dùng bởi" khi có nguồn đọc.
- qc: e2e cũ nào còn nhắc tab `Quy trình`/`Tool quy trình` (xem báo cáo).
