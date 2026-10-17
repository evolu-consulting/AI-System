# ADR-0017 · Engine quy trình chạy bền cho flow nghiệp vụ dài ngày

Trạng thái: **Proposed — chờ kết quả spike** · Ngày: 2026-10-17 · Liên quan: ADR-0013, docs/platform/spike-engine.md

## Bối cảnh
Process engine (P-a, P-b, P-b2) được thiết kế cho chuỗi agent tạo tài liệu: run hết hạn sau 7 ngày, nhắc task một lần, mỗi stage ra một file. Flow nghiệp vụ (duyệt hợp đồng, nhắc thanh toán) cần sống nhiều tháng, hẹn giờ theo ngày, rẽ nhánh, gọi tool, không chạy trùng.

## Lựa chọn
| Phương án | Nhận xét |
|---|---|
| (a) Mở rộng engine hiện có | Giữ RLS, review task, audit, canvas; phải tự đúng ở mọi tình huống lỗi |
| (b) Temporal / Restate làm phần chạy bên dưới | Chạy bền sẵn có; thêm một hệ thống lớn, phải nối lại RLS và review task |

## Quyết định (dự kiến, chốt sau spike)
- Chạy 6 bài thử lỗi (spike-engine.md) cho cả hai phương án; chọn phương án ít công vận hành hơn trong số các phương án qua cả 6 bài.
- Dù chọn phương án nào, **định nghĩa flow** (`process_defs`) và các loại node giữ nguyên ở lớp trên.
- Mở rộng tối thiểu cho GĐ1: template trỏ `template@version` + biến tenant; rẽ nhánh theo `output.fields`; executor `tool`; stage không bắt buộc file; hẹn giờ theo ngày; `expires_at` không bắt buộc cho flow nghiệp vụ; khoá idempotency khi start.

## Hệ quả
- Được: một engine cho cả chuỗi tài liệu cũ và flow nghiệp vụ mới.
- Mất: đổi mô hình cốt lõi của engine; cần test hồi quy toàn bộ P-a/P-b/P-c.
