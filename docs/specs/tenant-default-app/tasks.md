# tenant-default-app — platform_admin sửa "App mặc định" của công ty (làn nhanh)

Nguồn: `docs/specs/app-perm/tasks.md` bước 5. Trước đây phải SQL hoặc tenant admin dùng `PUT /me/tenant-default-app`.

## Plan
- BE: `GET|PUT /admin/tenants/:id/default-app` (chỉ platform_admin; `tenant-default-app.service.ts`, route trong `app-catalog.routes.ts`, mount ở `app.ts`). Khoá hàng tenant `FOR UPDATE`, khoá app phải có trong catalog, ghi audit `update`/`tenant` (`summary.op = default_app.set`, `from`/`to`; không ghi khi không đổi). Không migration. Contract: `TenantDefaultAppResponse`.
- FE: `TenantDefaultAppCard` (component riêng; trang chi tiết tenant chỉ thêm một dòng chèn ở tab Thông tin). Chọn là lưu ngay.
- Test: int `tenant-default-app.int.test.ts`; e2e `e2e/tenant-default-app.spec.ts` (mock, chưa chạy).

## Quyết định
- App lạ ⇒ `INVALID_REFERENCE` (HTTP 400, như `PUT /me/*`); contract `API_ERRORS` không có 422 nên giữ 400.
- "Trang chủ AI System" và "Không đặt" cùng là `null` (effective null = trang chủ) ⇒ một mục "Không đặt (Trang chủ AI System)".
- Không đòi app "mở được với người gọi" (platform đặt hộ công ty khác), chỉ cần tồn tại trong catalog.
- Danh sách chọn = catalog đang bật (+ giá trị hiện tại nếu đã bị tắt).

## Việc còn lại
- Chạy e2e + test:all một lần cuối đợt; `test:lock:write` nếu chưa.
