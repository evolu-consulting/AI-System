# Admin · Việc của ứng dụng chưa dùng bị khoá và lỗi gán nói rõ cách sửa

Cập nhật: 2026-11-09 · Gộp từ: cr121-f6-assign-error (đợt cr125-wave).

## Yêu cầu: Việc của ứng dụng chưa dùng bị khoá và lỗi gán nói rõ cách sửa (nguồn: cr121-f6-assign-error)
Việc thuộc ứng dụng công ty chưa dùng hiện "Chưa dùng ứng dụng" kèm link bật ở tab Ứng dụng và không gán được; khi gán lỗi, câu thông báo nêu lý do và nơi khắc phục theo mã lỗi (thiếu nhóm, chưa xuất bản, lỗi cấu hình, ứng dụng chưa dùng).
- Kịch bản: app mức Tắt ⇒ hàng việc Chưa dùng ứng dụng, không tính vào tóm tắt [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » CR-121 f6 · việc của ứng dụng công ty chưa dùng]
- Kịch bản: thiếu nhóm, chưa xuất bản, 422 lạ ⇒ câu nghiệp vụ và hành động khắc phục [test: apps/admin-web/src/features/tenants/flows/lib/assign-error.test.ts » CR-121 f6 · assignErrorOf]
