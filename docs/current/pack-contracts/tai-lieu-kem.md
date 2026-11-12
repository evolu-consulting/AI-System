# Tài liệu kèm của hợp đồng (CR-133)

Nguồn: lát cr133-attach (gộp 2026-11-12). Code: `H/adapters/contract-files*`, migration `MG` 0106; web chi tiết HĐ. File chính vẫn theo luật PDF khi công ty bật ký số.

#### Yêu cầu: Một khối «Tài liệu kèm» cho mọi tệp ngoài file chính
Hai nhóm trong một chỗ: tệp gắn thẳng vào HĐ (Word, Excel, ảnh… theo danh sách nhận được; thêm/gỡ/xem/tải) và tệp kèm các bước duyệt (chỉ đọc, ghi rõ khi nào được kèm). Không đem đi ký.
- Kịch bản: thêm .docx ⇒ hiện trong khối, có link tải, rồi gỡ [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » thêm → liệt kê hai nhóm → link tải → gỡ]
- Kịch bản: gom hai nhóm và tính quyền gỡ từng dòng [test: apps/hub-api/src/modules/packs/contracts/domain/contract-files.rules.test.ts » hai nhóm trong một khối]
- Kịch bản: e2e thêm .docx thấy trong khối và tải được [test: thủ công — e2e/contract-files/contract-files.spec.ts viết sẵn, chạy một lần cuối đợt]

#### Yêu cầu: Ai thêm/gỡ; từ chối nói rõ định dạng và số lượng
Xem = xem được HĐ. Thêm = người có quyền sửa HĐ. Gỡ = người có quyền sửa hoặc chính người đã thêm. Định dạng ngoài danh sách bị từ chối bằng câu nêu định dạng nhận được; tối đa 20 tệp/HĐ.
- Kịch bản: đuôi lạ, không quyền sửa, đủ 20 tệp [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » đuôi lạ ⇒ file_type]
- Kịch bản: .doc bị từ chối, .docx nhận [test: apps/hub-api/src/modules/packs/contracts/domain/contract-files.rules.test.ts » mimeByName]

#### Yêu cầu: Không thấy được từ công ty khác
Bảng tệp kèm chặn đọc chéo công ty bằng RLS.
- Kịch bản: công ty khác không thấy/thêm/gỡ/lấy link [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » chặn đọc chéo công ty]
