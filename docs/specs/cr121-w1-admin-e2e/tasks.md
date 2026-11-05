---
id: cr121-w1-admin-e2e
lát: cr121-w1-admin-e2e
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lượt test cuối đợt có e2e admin-web đỏ mới. Phân loại từng ca (a = lỗi sản phẩm, b = test cũ lệch thiết kế đã duyệt, c = chập chờn/có sẵn), sửa, chạy lại đúng các job.

## Làm
Mỗi ca một dòng:
- (a) cr121-list `/commands` phễu → chip `n / tổng`, cr121-tenants-list phễu Đã khoá, tenants.spec chip Đã khoá: khoá i18n `common.list.{removeFilter,result,noMatch}` viết `{{x}}` trong khi admin-web nội suy `{x}` ⇒ hiện thô "{{shown}} / {{total}}", nhãn bỏ lọc sai. Sửa vi+en.
- (a) cr121-list `/commands` Esc đóng ngăn: nút Đóng tự focus ⇒ tooltip mở theo focus, Esc đầu chỉ tắt tooltip. `DetailDrawer` không autofocus nút Đóng.
- (b) conflict-tenants (2 ca): tên công ty sửa tại chỗ ở tab Hồ sơ chỉ gửi `{name}` ⇒ diff chỉ có name, Ghi đè giữ `max_concurrent_sub` của người kia (7); sau Tải bản mới ô tên đóng.
- (b) tenant-default-app, N2-FR-04: tab mặc định là Hồ sơ; "App mặc định" và trần run nằm ở tab Cài đặt ⇒ vào `?tab=info`.
- (b) app-config F3 Xem trước: D-4 bỏ add-on `contracts-approval-engine` ⇒ hành động duyệt theo quy trình hiện ở mức Sửa, khe duyệt "Đang chạy"; assert đổi tương ứng (không còn "Cần bật tính năng thêm").
- (b) cr112-wizard AC4: dòng tóm tắt đầu trang (mọi vai) đọc `grants/matrix?tenant_id=<công ty mình>&limit=1`; vẫn chặn `daily-limits`/`packs`, kiểm matrix chỉ là lời gọi tóm tắt đó.
- (b) pm-checklist admin-cr112: tab "Ứng dụng & Gói" đổi nhãn thành "Ứng dụng". (Lượt gộp root+pm đụng cổng 3420 do cùng slot, không phải lỗi code: chạy pm riêng.)
- (b) cr121-tenants-list Q-1: fixture e2e không có sẵn feature `contracts-read` ⇒ spec tự tạo phần của mình.

## Không làm / Chạm
workspace-web, hub-api engine, DLC. Chỉ: `packages/i18n/locales/{vi,en}.json` (3 khoá), `DetailDrawer.tsx`, e2e admin-web.

## Test tối thiểu
`deploy/evotest/run-tests.ps1 -Step e2e -Filter "root,N2"` và `-Filter pm-checklist-pm`.

## Quyết định trong lúc làm
Không có ca loại (c) ⇒ `tests/known-red.json` không đổi.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa lỗi hiển thị i18n `n / tổng`/nhãn bỏ lọc và Esc đóng ngăn đúng như thiết kế ListPage đã duyệt; phần còn lại chỉ chỉnh e2e cho khớp thiết kế đã duyệt)

## Việc còn lại
