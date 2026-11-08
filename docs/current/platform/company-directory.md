# Danh bạ công ty tự nguyện (CR-124 FLOW4-FR-03/04/05, NFR-03/04)

Cập nhật: 2026-11-08 · Nguồn: CR-124/125.

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Danh bạ công ty tự nguyện (CR-124 FLOW4-FR-03/04/05, NFR-03/04) (nguồn: cr124-q2-directory)
Công ty bật "Cho phép công ty khác tìm thấy và gửi hợp đồng cho chúng tôi" (mặc định tắt) thì xuất hiện trong danh bạ; danh bạ đọc thẳng hồ sơ công ty (`admin.tenants`), chỉ trả tên pháp lý, MST, địa chỉ, dấu Đã xác minh và mã công ty để gửi; tìm theo MST đúng hoặc tên (≥ 3 ký tự), tối đa 20, không gồm chính mình. Chỉ quản trị công ty đó bật/tắt (cần có tên pháp lý + MST); chỉ quản trị nền tảng đặt Đã xác minh.
- Kịch bản: khi công ty bật thì tìm theo MST/tên thấy đúng một dòng với đúng 5 cột công khai, tắt thì không thấy, không thấy chính mình [test: apps/admin-api/src/modules/tenants/tenants.directory.int.test.ts » chỉ công ty đã bật, không phải chính mình, đúng bộ cột công khai (FR-03/04)]
- Kịch bản: khi người thường, quản trị nền tảng hay công ty khác bật hộ, hoặc thiếu MST, thì bị chặn (403/404/422) [test: apps/admin-api/src/modules/tenants/tenants.directory.int.test.ts » chỉ quản trị chính công ty bật/tắt, thiếu MST ⇒ 422, người thường/nền tảng/công ty khác bị chặn]
- Kịch bản: khi quản trị nền tảng xác minh thì dấu hiện kèm ngày + người, công ty khác không đặt được kể cả gọi thẳng hàm DB [test: apps/admin-api/src/modules/tenants/tenants.directory.int.test.ts » chỉ quản trị nền tảng đặt Đã xác minh (API + hàm DB), hiện ngày + người xác minh, công ty vẫn thấy]
- Kịch bản: khi chưa đặt phạm vi hoặc là Hub thì hàm tìm không chạy được [test: apps/admin-api/src/modules/tenants/tenants.directory.int.test.ts » hàm tìm chỉ cho admin_rw, Hub/PUBLIC không chạy được, chưa đặt phạm vi ⇒ 42501]
- Kịch bản: khi danh bạ 20.000 công ty thì tìm MST và tên p95 ≤ 20 ms [test: apps/admin-api/src/modules/tenants/tenants.directory.perf.int.test.ts » 20000 công ty: tìm MST đúng p95 ≤ 20 ms]
- Kịch bản: khi quản trị công ty mở Hồ sơ thì công tắc bật được chỉ khi đủ tên pháp lý + MST; quản trị nền tảng thấy công tắc Đã xác minh [test: apps/admin-web/src/features/tenants/lib/directory.test.ts » quản trị công ty: bật được khi đủ tên pháp lý + MST, không thấy công tắc xác minh]
