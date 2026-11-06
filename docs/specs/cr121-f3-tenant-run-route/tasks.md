---
id: cr121-f3-tenant-run-route
lát: cr121-f3-tenant-run-route
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: c13, c17, qc-admin-runs
---
## Plan (ngắn)
tenant_admin mở `/processes/<def>/runs/<run>` (Tpl-Run) bị đưa về Tổng quan. Đọc toàn bộ đường dẫn: chuyển hướng tenant_admin của c13 chỉ đặt ở `beforeLoad` của route danh sách `/processes` (`routes/_authed/processes/index.tsx`); guard `_authed` chỉ chặn `/transfer`, `/sources` (cờ đóng băng) và member; `ProcessRouteGate` chỉ chặn khi engine off. KHÔNG tìm thấy mã chuyển hướng nào áp cho route con — nên lát này (1) khoá điều đó bằng hàm guard thuần có test, (2) bỏ mọi lối rơi về Tổng quan/danh sách khi 404, (3) thêm lối vào từ UI. Nếu e2e vẫn thấy về Tổng quan: nguyên nhân còn lại là engine off (`ProcessRouteGate` → NotFound với nút "Tổng quan") hoặc 404 từ API — cần log mạng của lượt đó.

## Làm
- `lib/route-guard.ts`: `isProcessesList`, `listRedirectTarget` (chỉ đúng `/processes`), `notFoundBack` (tenant_admin → `/tenants` = công ty mình; platform → `/processes`). Route danh sách dùng `listRedirectTarget(location.pathname, …)`.
- Trang lượt chạy và trình sửa: 404 ⇒ "Không tìm thấy" có nút về đúng nơi theo vai (không về Tổng quan, không vào danh sách rồi bị chuyển hướng).
- Route lượt chạy nhận `?company=<id>` (platform mở từ Công ty › Quy trình cần công ty; tenant_admin không cần, Hub suy từ phiên).
- Lối vào: khối "Đang chạy" (Công ty › Quy trình) — tiêu đề lượt thành link tới trang lượt chạy (platform kèm `company`); tab Lượt chạy của trình sửa đã link sẵn.

## Test
unit `lib/route-guard.test.ts`. Không sửa e2e. Perf: không chạm.

## e2e cần đổi / chạy lại (qc giữ)
`e2e/P-a/pf4/admin-runs.pa.ts`: chạy lại với tenant_admin; thêm ca bấm lượt ở khối "Đang chạy" (`flows-run-open-<id>`) ⇒ vào trang lượt chạy; ca 404 ⇒ "Không tìm thấy", không về Tổng quan.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/trang-luot-chay-tenant-admin.md
#### Yêu cầu: tenant_admin vào được trang lượt chạy và trình sửa của công ty mình (CR-121 R3/R4)
Chỉ danh sách `/processes` chuyển tenant_admin tới Công ty › Quy trình; `/processes/$id` và `/processes/$id/runs/$runId` vào được khi thuộc công ty của họ, 404 hiện "Không tìm thấy" kèm nút về công ty mình. Khối "Đang chạy" của Công ty › Quy trình mở trang lượt chạy.
- Kịch bản: chuyển hướng danh sách không áp cho trang con; nút quay lại theo vai [test: apps/admin-web/src/features/processes/lib/route-guard.test.ts » CR-121 f3 · chỉ danh sách /processes bị chuyển hướng]

## Việc còn lại
- qc chạy lại e2e; nếu vẫn về Tổng quan, gửi log mạng/URL cuối để tìm nguyên nhân (không có trong mã quan sát được).