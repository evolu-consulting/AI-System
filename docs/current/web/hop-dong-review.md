# Web · Màn xác nhận hợp đồng (review)

Cập nhật: 2026-11-09 · Nguồn: cr120-contracts-flow (CR-120). Code: `apps/workspace-web/src/features/contract-review/`, `features/contract-approval/lib/moved-to`.

#### Yêu cầu: Màn xác nhận HĐ nói rõ bản nháp và bước kế (nguồn: cr120-contracts-flow)
Cạnh "Lưu nháp" có gợi ý "Bản nháp chỉ bạn thấy — bấm Xác nhận và lưu để chuyển duyệt"; sau Xác nhận và lưu thẻ báo "Đã chuyển: <bước kế>" (tên bước mở sau bước soạn đã Đạt). HĐ nháp/không quyền xem (404/403) hiện cùng một câu chung, không lộ HĐ có tồn tại.