---
id: cr121-f5-features-entry
lát: cr121-f5-features-entry
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c
---
## Plan (ngắn)
Lỗi F5: `/features` (danh mục tính năng, platform_admin) không còn lối vào sau khi nav còn 6 mục. Spec R1/Main không nói đặt ở đâu ⇒ thêm thẻ vào màn Hệ thống (registry một nguồn).

## Làm
- `features/system/lib/registry.ts`: mục `features` → `/features`, nhãn nghiệp vụ "Danh mục tính năng" (`nav.features` đổi từ "Features"), mô tả `system.hub.features`, chỉ platform_admin; `SystemHubPage` thêm icon. Trang app `/apps/$appKey` tab Tính năng đã có link sang `/features` (giữ).
- Soát trang chỉ vào bằng URL (route `_authed/*`): `access|agents|groups|partners|users` = URL cũ có chuyển hướng sang tab công ty; `features/*` = nay có thẻ Hệ thống; `usage_.analytics` ← link từ Agents nền; `audit/$auditId` ← Nhật ký; `notifications` ← chuông thông báo (web-kit shell); `commands/*`, `workflows/*` = editor/chi tiết từ Công cụ AI. CÒN `processes/showcase`: trang minh hoạ CR-103 không có lối vào nào (không phải trang dùng thật) — để nguyên, hỏi điều phối có gỡ không.
- Soát 2 chỗ qc tự sửa: (1) `routes/_authed/tenants/index.tsx` tenant_admin `/tenants` ⇒ công ty mình: ĐÚNG (không có danh sách công ty cho vai này), giữ. (2) `workspace-search.ts` giữ `legacy` khi `validateSearch` chạy lại: ĐÚNG (router chạy lại trên kết quả đã mất `tab`); chỉ nhận đúng giá trị `workflow-tools`, không mở rộng bề mặt, giữ.

## Test tối thiểu
- unit: `features/system/lib/registry.test.ts` (platform_admin 9 mục có `features`; tenant_admin không thấy).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/he-thong-danh-muc-tinh-nang.md
#### Yêu cầu: Danh mục tính năng có lối vào ở màn Hệ thống
Quản trị nền tảng vào Danh mục tính năng từ thẻ ở màn Hệ thống (và từ tab Tính năng của trang app); quản trị công ty không thấy.
- Kịch bản: platform_admin thấy thẻ Danh mục tính năng, tenant_admin thì không [test: apps/admin-web/src/features/system/lib/registry.test.ts » platform_admin thấy đủ 9 mục (có Danh mục tính năng)]

## Việc còn lại
- e2e (qc): thẻ "Danh mục tính năng" ở `/system` mở `/features`; ca đọc nhãn "Features" ở breadcrumb `/features/<id>` nay là "Danh mục tính năng".