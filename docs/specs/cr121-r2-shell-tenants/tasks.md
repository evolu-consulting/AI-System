---
id: cr121-r2-shell-tenants
lát: cr121-r2-shell-tenants
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c
---
## Plan (ngắn)
Sửa lỗi review cuối đợt CR-121 C (R2) vùng shell + tenants: chuyển hướng `/workflows`, breadcrumb và sidebar, `workflow-tools` cũ của tenant_admin, trạng thái lượt chạy dùng chung, một định nghĩa mức, i18n không lộ khái niệm kỹ thuật.

## Làm
- `/workflows` (danh sách) `beforeLoad` ⇒ `/ai-tools?kind=workflow` (như `/commands`); `/workflows/new`, `/workflows/<id>` giữ nguyên. Khoá `nav.workflows` = "Công cụ AI" vẫn đúng nghĩa (nhãn gốc breadcrumb của editor Workflow), giữ.
- Breadcrumb `/ai-tools` chỉ còn "Công cụ AI" (bỏ cấp Hệ thống). tenant_admin: sidebar bỏ mục Quy trình (dùng Công ty › Quy trình). `?tab=workflow-tools` cũ: tenant_admin ⇒ tab Quy trình của công ty mình (không tới /ai-tools Forbidden); platform_admin ⇒ /ai-tools như cũ (`legacyTabRedirect(search, role)`).
- Khối "Đang chạy": `isRunEnded` và `RunStatusBadge` dùng chung (xoá `RUN_ENDED`, tập WAITING và nhãn riêng); chuỗi `process.common.status.*` nạp lười bằng `ensureProcessLocale`.
- Một định nghĩa mức: `tenants.apps.levelDesc.{read,write,admin}` (vi+en), `LevelHelp` (ⓘ) và `RoleDialog` cùng đọc; gỡ `tenants.apps.levelHelp` và `appRoles.dialog.levelHint`.
- i18n: `appcfg.flow.slotMissing`, `appcfg.flow.needsAddon`, `ops...flow_coverage` viết lời nghiệp vụ kèm cách khắc phục (vi+en), bỏ "khe/hub/def/tính năng thêm/tenant".

## Không làm / Chạm
Không sửa e2e (qc giữ). Nhãn hồ sơ của "Đang chạy": R1 chưa gộp nên `tenants/flows/lib/run-title.ts` vẫn là bản chuẩn — sau khi R1 gộp hàm nhãn về `processes/lib/`, đổi `run-title.ts` dùng hàm đó (bẫy).

## Test tối thiểu
- unit: `shell/lib/nav.test.ts` (tenant_admin không có Quy trình; breadcrumb /ai-tools), `tenants/lib/workspace-search.test.ts » CR-121 c16 · ?tab=workflow-tools cũ`.
- Test khoá i18n sẵn có (key literal, tham số vi/en, `{{`) xanh.

## Quyết định trong lúc làm
- `slotMissing` bỏ tham số `{def}` ở cả vi và en (test tham số vi/en phải khớp).

## Ca e2e cần đổi (qc, không chạy)
- `e2e/x1/workflows-side-effect.x1.ts:40` (`goto("/workflows")` nay chuyển sang `/ai-tools?kind=workflow`).
- `e2e/cr121-c16-ai-tools.spec.ts:105` (tenant_admin mở `?tab=workflow-tools` ⇒ tab Quy trình, thêm ca).
- Mọi ca tenant_admin bấm link sidebar "Quy trình" (`P-a/pf4/admin-processes.pa.ts`, `admin-editor.pa.ts`, `P-b2/admin/canvas.pb2.ts` đã treo) và ca đọc breadcrumb "Hệ thống › Công cụ AI".
- Ca đọc chữ cũ: hộp thoại vai ("Xem: chỉ đọc."), "Cần tính năng thêm", "Khe chưa có trên hub", "Quy trình hiển thị cho tenant".

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/dieu-huong-shell-r2.md
#### Yêu cầu: Điều hướng khung quản trị theo vai
Công cụ AI là mục gốc (breadcrumb không có cấp Hệ thống); quản trị công ty không có mục Quy trình riêng ở thanh bên; URL cũ `workflow-tools` đưa quản trị công ty về tab Quy trình của công ty mình.
- Kịch bản: quản trị công ty thấy Tổng quan, Công ty, Hệ thống [test: apps/admin-web/src/features/shell/lib/nav.test.ts » tenant_admin: Tổng quan · Công ty · Hệ thống (không có Quy trình riêng, dùng Công ty › Quy trình)]
- Kịch bản: quản trị công ty mở URL cũ workflow-tools ⇒ tab Quy trình, quản trị nền tảng ⇒ Công cụ AI [test: apps/admin-web/src/features/tenants/lib/workspace-search.test.ts » CR-121 c16 · ?tab=workflow-tools cũ]

## Việc còn lại
- Đổi `run-title.ts` theo hàm nhãn hồ sơ chung khi R1 gộp.