# ADR-0017 · Engine quy trình chạy bền cho flow nghiệp vụ dài ngày

Trạng thái: **Proposed — đề xuất phương án (a) theo kết quả spike 2026-10-17** · Liên quan: ADR-0013, docs/platform/spike-engine.md, `spikes/engine/engine.spike.test.ts`

## Bối cảnh
Process engine (P-a, P-b, P-b2) được thiết kế cho chuỗi agent tạo tài liệu: run hết hạn sau 7 ngày, nhắc task một lần, mỗi stage ra một file. Flow nghiệp vụ (duyệt hợp đồng, nhắc thanh toán) cần sống nhiều tháng, hẹn giờ theo ngày, rẽ nhánh, gọi tool, không chạy trùng.

## Lựa chọn
| Phương án | Nhận xét |
|---|---|
| (a) Mở rộng engine hiện có | Giữ RLS, review task, audit, canvas; phải tự đúng ở mọi tình huống lỗi |
| (b) Temporal / Restate làm phần chạy bên dưới | Chạy bền sẵn có; thêm một hệ thống lớn, phải nối lại RLS và review task |

## Kết quả spike (2026-10-17)
Môi trường: Windows, PostgreSQL 16.15 portable, fakeredis 2.40 (Redis giả lập), hub-api thật in-process, đồng hồ giả, runtime giả (hạ tầng test P-a/PF1). Chỉ chạy phương án (a); (b) chưa chạy vì máy không có Docker.

| # | Bài | Kết quả | Hành vi hiện tại |
|---|---|---|---|
| 1 | Sập giữa bước: job lỗi ⇒ tự chạy lại | **Đỏ** | Run và stage chuyển `needs_decision`, `attempt` = 1; chờ người quyết, không tự thử lại |
| 2 | Chạy trùng: cùng `client_msg_id` gửi 2 lần | **Đạt** | Chỉ một `process_run` |
| 3a | Nhắc task sau khi Hub khởi động lại | **Đạt** | Vòng nhắc đọc DB, instance mới vẫn nhắc đúng một lần |
| 3b | Loại bước hẹn ngày / gọi tool / rẽ nhánh | **Đỏ** (đã biết) | `executor` chỉ nhận `agent`, `team`, `apply` |
| 4 | Quá hạn: nhắc lại / chuyển cấp | **Đỏ** | Chỉ nhắc một lần (`reminded_at`), không nhắc lại, không chuyển cấp |
| 4b | Run chờ duyệt quá 7 ngày | **Đỏ** | Bị `expired` sau 7 ngày (`expires_at` bắt buộc) |
| 5 | Sửa template khi run đang chạy | **Đạt** | Run giữ `def_version` 1 và snapshot 2 stage, chạy hết theo bản cũ |
| 6 | Tải: 1.000 task chờ duyệt | **Đạt** | Nhắc đủ 1.000 trong 11 lượt (lô 100), p95 một lượt 537 ms, `sweepOnce` 24 ms |

**Bài tải mở rộng (`spikes/engine/load.spike.test.ts`, local, N=1.000, 2026-10-17):** nhắc 1.000 task trong 11 lượt (p95 362 ms/lượt); `sweepOnce` với 2.000 run đang chạy 27 ms; hết hạn 2.000 run trong 21 lượt (p95 1,6 s/lượt). **Hai Hub nhắc song song: ĐỎ — nhắc trùng** (1.800 lượt, 3.600 notice thay vì 1.000 / 2.000) do `dueTasks` không khoá hàng và `markReminded` không kiểm số dòng (TECH-DEBT #190; sửa ở P-d T9 trước khi bật HA hai node). Bản N=10.000 trên Redis thật chạy ở staging (người dùng chọn chờ staging).

Nhận xét: nền chạy bền **đã đúng** ở những chỗ khó (vòng nền đọc DB nên an toàn khi khởi động lại, start không trùng, snapshot theo version, tải 1.000 task ổn). Các bài đỏ là **thiếu tính năng cho flow dài ngày**, không phải lỗi mất dữ liệu.

## Quyết định (đề xuất)
Chọn **(a) mở rộng engine hiện có**. Chưa cần Temporal/Restate. Việc cần làm ở GĐ1:
1. **Chính sách thử lại theo loại lỗi:** lỗi tạm (mạng, timeout, provider bận) tự thử lại có backoff tới `attempt_limit`; chỉ lỗi nghiệp vụ mới chuyển `needs_decision` (bài 1).
2. **Bảng hẹn giờ** (`due_at`, `fired_at`, khoá idempotency) + executor `wait_until` (bài 3b).
3. **Nhắc lặp và chuyển cấp** trong định nghĩa bước duyệt: nhắc mỗi N giờ, quá M giờ chuyển nhóm khác (bài 4).
4. **`expires_at` không bắt buộc** cho flow nghiệp vụ; giữ 7 ngày cho chuỗi tài liệu cũ (bài 4b).
5. Executor `tool` (MCP) và rẽ nhánh theo `output.fields` (bài 3b).

Xem lại phương án (b) nếu: bài tải 10.000 run trên staging không đạt NFR, hoặc logic hẹn giờ/thử lại tự viết gây lỗi khó sửa.

## Hệ quả
- Được: một engine cho cả chuỗi tài liệu cũ và flow nghiệp vụ mới; không thêm hệ thống phải vận hành.
- Mất: đổi mô hình cốt lõi của engine; cần test hồi quy toàn bộ P-a/P-b/P-c.
- Còn thiếu để chốt Accepted: chạy lại spike trên Redis thật (không phải fakeredis) và bài tải 10.000 run trên staging.
