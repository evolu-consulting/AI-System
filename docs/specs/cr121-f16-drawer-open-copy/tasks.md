---
id: cr121-f16-drawer-open-copy
lát: cr121-f16-drawer-open-copy
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c
---
## Plan (ngắn)
UAT lượt 3 (L9): ngăn việc của việc đã gán BẢN RIÊNG không có nút mở bản riêng; dòng "Chưa xem được các bước của quy trình này." thiếu lý do.

## Làm
- Nguyên nhân: nút mở bản riêng chỉ hiện khi `lib.error` đúng mã `NOT_LIBRARY_DEF`; bất kỳ lệch nào của lỗi đó (mã, vai, phản hồi) làm nút biến mất. Nay `lib/def-kind.ts` (`defView`) quyết theo DỮ LIỆU: có bản thư viện ⇒ "thư viện" (chỉ xem; có bản sao ⇒ thêm nút mở bản riêng); đọc xong mà không phải thư viện ⇒ "bản riêng" (nút "Mở trình sửa" sửa được); đang tải ⇒ chưa quyết. Mọi việc có quy trình đều có nút mở trang chi tiết (`flows-open-detail` cho thư viện, `flows-open-editor` cho bản riêng), link mang `?company=<tenantId>` (F14), cho cả platform_admin và tenant_admin.
- Lý do không vẽ được bước: `stepsGap` ⇒ "Không tải được các bước. Tải lại trang; nếu vẫn lỗi, mở trang chi tiết" (lỗi tải) hoặc "Quy trình này chưa có danh sách bước để vẽ (chưa xuất bản hoặc nội dung chưa đủ). Mở trang chi tiết để xem hoặc hoàn thiện." (đọc được nhưng không có bước tuần tự); `FlowRowsView` nhận `unavailable`.

## Kiểm
Không tái hiện bằng trình duyệt: cần công ty đã gán bản riêng (dữ liệu của lượt UAT 3), stack UAT mặc định không có — điều phối cho UAT chụp lại ngăn việc "Duyệt hợp đồng" của evolu và một việc dùng bản thư viện.

## Không làm / Chạm
Không sửa e2e. Không đổi API.

## Test tối thiểu
- unit: `tenants/flows/lib/def-kind.test.ts » CR-121 f16 · defView` và `» CR-121 f16 · stepsGap`.

## Ca e2e cần đổi (qc)
- Việc dùng bản riêng ⇒ có `flows-open-editor` (href chứa `company=<id>`) cả platform_admin và tenant_admin; việc dùng thư viện ⇒ `flows-open-detail` và `flows-copy`; ca đọc câu "Chưa xem được các bước của quy trình này." nay có lý do + bước kế (`tenants.flows.stepsGap.*`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/ngan-viec-mo-chi-tiet.md
#### Yêu cầu: Mọi việc có quy trình đều mở được trang chi tiết từ ngăn việc
Ngăn việc luôn có một nút mở trang chi tiết: bản riêng của công ty mở để sửa, bản thư viện mở để xem; link mang công ty đang xem; khi không vẽ được các bước thì nói lý do và bước kế.
- Kịch bản: bản thư viện/bản riêng/đang tải quyết theo dữ liệu, không theo mã lỗi [test: apps/admin-web/src/features/tenants/flows/lib/def-kind.test.ts » CR-121 f16 · defView]
- Kịch bản: lỗi tải hoặc thiếu danh sách bước ⇒ lý do rõ [test: apps/admin-web/src/features/tenants/flows/lib/def-kind.test.ts » CR-121 f16 · stepsGap]

## Việc còn lại
- UAT chụp lại ngăn việc bản riêng; e2e (qc) theo danh sách trên.
