# ADR-0013 · Canvas quy trình admin-web: `@xyflow/react`

Trạng thái: **Proposed (Đề xuất)** — chưa duyệt; trình Gate mốc P-b2 (thêm thư viện) · Ngày: 2026-10-12 · CR-063 · Kế thừa: ADR-0001, ADR-0004/0005 (nguyên tắc ít thư viện, biểu đồ Admin không recharts)

## Bối cảnh
CR-063: `/processes` ở admin-web đổi từ accordion stage sang canvas kéo thả theo **bước** (stage song song cùng cột, mũi tên quay lại). Cần kéo thả, pan/zoom, cạnh nối; tự viết toàn bộ tốn thời gian và dễ lỗi trợ năng.

## Lựa chọn
| # | Phương án | Nhận xét |
|---|---|---|
| A | Giữ accordion + nút lên/xuống | Không hiện được song song/quay lại rõ |
| B | Tự viết SVG + pointer events | Nhiều việc kéo thả/zoom/a11y |
| C | **`@xyflow/react`** (React Flow) | Chọn: đủ tính năng; kiểm bundle |

## Quyết định (dự kiến)
1. Dùng `@xyflow/react` **chỉ trong `apps/admin-web`**; không dùng ở chat-web/studio-web. Phiên bản và license (kỳ vọng MIT) chốt/kiểm khi cài (BUILD P-b2).
2. **Lazy chunk**: chỉ tải ở route `/processes/:id`; kiểm bằng `bun run check:bundle` (thêm ngân sách cho chunk này).
3. **Layout tự viết theo cột bước**; **không lưu toạ độ** (vị trí suy ra từ bước/thứ tự trong `process_defs`) — không thêm dagre/elk.
4. Form stage giữ trong **panel bên** với cùng nhãn ARIA "Giai đoạn n: …" (giảm sửa test khoá E-P15b/E-PB08/E-PB09; qc cập nhật phần còn lại khi tới mốc).
5. **StageStrip ở chat-web vẽ bằng CSS thuần** (không kéo xyflow vào chat).

## Hệ quả
- Thêm một phụ thuộc runtime cho admin-web; bundle chính không đổi nhờ lazy chunk.
- Canvas cần artboard (chưa có) và bàn phím/ARIA thay thế kéo thả (a11y).
- Test e2e hiện có phải chạy lại sau khi đổi UI.
