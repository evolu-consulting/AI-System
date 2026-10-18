# Gate · P-d1 (P-d-durable, lát 1) — GĐ1 platform

**Kết quả: DUYỆT — Tự duyệt theo Luật 2b (2026-10-18, phiên chính).** Vào BUILD trên nhánh `platform/gd0` (không push).

## Căn cứ
- spec-readiness **lần 7 READY** (0 Chặn, 0 Cao; 11 Thấp mở — 71, 73, 75–80, 91, 95, 96 — sửa khi BUILD), xem `P-d-durable/readiness.md`.
- Mọi lỗ hổng Chặn/Cao các lần 1–6 đã có câu trả lời người dùng chấp nhận (15 + 14 mặc định Intake, câu múi giờ/công tắc tool, CR-092, CR-093 ngưỡng 50 ms) hoặc mặc định từ spec/BA/ADR/code (Luật 2b) — ghi ở `spec-decisions.md`.
- Không ADR thêm thư viện/dịch vụ mới; không câu hỏi mới; không hard stop.

## Điều kiện trước (đã đủ)
| # | Điều kiện | Trạng thái |
|---|---|---|
| D0a | ADR-0017 Accepted (staging Redis thật + 10.000 run) | Xong 2026-10-17, điều kiện #190 ⇒ T9 |
| D0b | Đóng mốc dọn-seed CR-081 | Xong 2026-10-17 |
| D0c | Mockup 01–04 | Người dùng duyệt 2026-10-17 |
| T3/T3a | Test trước code (qc) | Xong: 420 ca + 7 perf, đỏ đúng lý do; lock OK |

## Ràng buộc trong BUILD (báo lại ở T12)
- Security review **T6c** (`UnitOfWork`, gồm `systemBatch`), **T12** (chuyển cấp, vòng hẹn giờ, `scanDue`), hard stop nếu phát hiện lỗi cách ly tenant.
- NFR CR-093: lô 100 p95 ≤ 50 ms (đo cả lời gọi), 10.000 nhắc ≤ 6 s, 20.000 hết hạn ≤ 12 s — số đo hiện tại (T3) 441 ms / 1.676 ms; T9/T10 chưa đạt thì chưa xong.
- #190 (nhắc trùng nhiều Hub) sửa ở T9; staging chạy lại `load.spike` sau T10.
- Vòng nhắc bật lần đầu nhắc ngay task cũ quá hạn; retry `parallel_merge` tốn token (readiness câu 6).
- Luật 4b: `bun run test:all` khi đóng lát.