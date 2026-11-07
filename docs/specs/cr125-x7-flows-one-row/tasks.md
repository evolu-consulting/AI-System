---
id: cr125-x7-flows-one-row
lát: cr125-x7-flows-one-row
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Công ty › Quy trình: một sự kiện hiện HAI dòng (bản công ty "Đang dùng" + bản gốc Thư viện "Đã thay bằng bản công ty") với nhiều nút. Giám đốc cần MỘT dòng: quy trình đang dùng, trạng thái, "Mở" và "…".

## Làm
- `splitRows`/`isReplacedOriginal`/`menuOf` (thuần): bản gốc đã bị thay ⇒ mục "Mẫu thư viện (n)" gập bên dưới; menu "…" giữ Quay về bản gốc + Tắt/Bật. "Sao chép để sửa" vẫn là nút riêng ở flow Thư viện chưa sao (lối vào sửa).
- Dòng trong "Mẫu thư viện" chỉ có "Mở" (không "Bật" gây lỗi "không bật cùng lúc").

## Không làm / Chạm
Không canvas, không API (dữ liệu giữ nguyên), không migration.

## Test tối thiểu
unit `company-flow-view.test.ts`; journey e2e G2 (đi qua menu "…" + mục Mẫu thư viện) một lần + ảnh.

## Quyết định trong lúc làm
- Bản công ty đã "Quay về bản gốc" (Tắt · đã quay về bản gốc) vẫn là dòng chính — còn việc để làm (mở lại / dùng lại).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Nhân bản rồi gán
Nhân bản mọi quy trình (kể cả đang dùng) thành nháp mới cùng khe, chưa gán; sửa bản nhân bản không ảnh hưởng tenant nào. Danh sách quy trình của công ty chỉ hiện MỘT dòng cho quy trình đang dùng với "Mở" và menu "…" (Quay về bản gốc, Tắt); bản gốc Thư viện đã được bản công ty thay nằm trong mục "Mẫu thư viện" gập.
- Kịch bản: khi bản công ty thay bản gốc thì danh sách chính chỉ còn bản công ty và bản gốc vào mục Mẫu thư viện [test: apps/admin-web/src/features/tenants/flows/lib/company-flow-view.test.ts » CR-125 · x7 · một dòng cho mỗi quy trình đang dùng: bản gốc đã bị thay vào mục Mẫu thư viện]
- Kịch bản: khi mở menu … của dòng thì có Quay về bản gốc và Tắt cho bản công ty đang dùng [test: apps/admin-web/src/features/tenants/flows/lib/company-flow-view.test.ts » menu …: Quay về bản gốc + Tắt cho bản công ty đang dùng, Bật cho flow được gán đang tắt, bản công ty chưa áp dụng không có gì]
- Kịch bản: khi quản trị công ty áp dụng bản công ty thì danh sách còn một dòng hiện, bản gốc nằm trong Mẫu thư viện không có nút Bật [test: e2e/journey-approval/cr122-flows.spec.ts » G2 · tenant_admin: Sao chép → 3 lỗi 409 → sửa người duyệt → Xuất bản (gốc tự Tắt) → HĐ B theo bản công ty, HĐ A giữ bản cũ → Quay về bản gốc]

## Việc còn lại