---
id: cr121-c10-admin-nav
lát: cr121-c10-admin-nav
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: docs/specs/cr121-c/spec.md R1
---
## Plan (ngắn)
Làm theo artboard `scratchpad\cr121-design\project\Main.dc.html` (phần "3. Biểu tượng": 6 biểu tượng điều hướng Tổng quan · Công ty · Ứng dụng · Quy trình · Công cụ AI · Hệ thống). Sidebar phẳng 6 mục, không tiêu đề nhóm.

## Làm
- `shell/lib/nav.ts`: `navItems(role, {processes})` thay `navGroups`; 6 mục; `aiToolsDestination` + `parseAiToolKind`.
- `SidebarNav.tsx`: danh sách phẳng, biểu tượng theo artboard, thu gọn = icon + `title` tooltip, hỗ trợ badge số (`badges`).
- Route `/ai-tools?kind=` (tạm chuyển → `/workflows`); `/commands` (danh sách) và `/agents` (platform_admin) chuyển tới `/ai-tools?kind=command|agent`.
- Gỡ `SidebarCompanies` + `lib/companies` (nhóm CÔNG TY động) và khoá i18n `nav.group.*`; nhãn mới `nav.companies|aiTools`, `nav.system` = "Hệ thống".

## Không làm / Chạm
Màn Công cụ AI thật (c16), tab Công ty (c14), nguồn dữ liệu badge. Perf: không.

## Test tối thiểu
`bun test apps/admin-web/src/features/shell` (nav.test.ts) xanh; chụp màn hình thật mở/thu gọn (scratchpad `c10-nav-open.png`, `c10-nav-collapsed.png`). Không chạy e2e.

## Quyết định trong lúc làm
- tenant_admin: Tổng quan · Công ty · Quy trình (khi engine bật). Mục Chi phí/Nhật ký/Góp ý/Secrets/Nguồn/Bước DLC/Import-Export không còn trên sidebar (route giữ nguyên) — cần màn "Hệ thống" gom lại (ngoài c10).
- Chưa có nguồn dữ liệu badge: `SidebarNav` nhận `badges` nhưng chưa ai truyền.

## Khác biệt so với artboard (chưa duyệt)
1. Badge số: có component, chưa nối dữ liệu nên không hiện.
2. Tooltip thu gọn dùng `title` gốc của trình duyệt, không phải tooltip tuỳ biến.
3. Artboard chỉ định nghĩa biểu tượng + nhãn (không có khung sidebar đầy đủ) nên cấu trúc/khoảng cách giữ theo shell hiện có.
4. "Quy trình" ẩn khi engine quy trình tắt (dev stack chụp không có Hub) ⇒ ảnh chụp chỉ 5 mục.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Thanh điều hướng 6 mục phẳng
Sidebar admin-web gồm Tổng quan · Công ty · Ứng dụng · Quy trình · Công cụ AI · Hệ thống, không nhóm; Features/Commands/Agents/Workflow Dify gộp vào Công cụ AI; `/commands` và `/agents` chuyển tới `/ai-tools?kind=` (c16: trang Công cụ AI thật, lọc theo loại dùng).
- Kịch bản: khi platform_admin mở admin thì sidebar đúng 6 mục theo thứ tự, không tiêu đề nhóm [test: apps/admin-web/src/features/shell/lib/nav.test.ts » platform_admin: đúng 6 mục theo thứ tự artboard Main, không nhóm]
- Kịch bản: khi vào /commands hoặc /agents thì sang /ai-tools?kind=command|agent [test: apps/admin-web/src/features/ai-tools/lib/ai-tools.test.ts » tham số URL lạ bị bỏ]

## Việc còn lại
- Nối badge số; màn Công cụ AI (c16); nơi gom Chi phí/Nhật ký/Góp ý/Secrets.