---
name: prototype
description: Dựng "Bản mẫu bấm được" (một file HTML, dữ liệu giả) để giám đốc/sale xác nhận màn hình hoặc luồng mới TRƯỚC khi viết code, rồi đưa câu trả lời của họ vào spec và test. Bước tùy chọn của dây chuyền.
---

# Bản mẫu bấm được

## Khi nào dùng
- CR thêm/đổi **màn hình hoặc luồng người dùng nhìn thấy** và còn điểm cần người nghiệp vụ chốt.
- **Bỏ qua** khi: backend thuần, sửa lỗi, công cụ/tools, đổi chữ nhỏ, hoặc giao diện đã có mẫu duyệt.

## Vòng lặp
1. **Dựng** (≤ 15 phút, chỉ đọc spec): viết `docs/specs/<CR>/prototype.json` theo `tools/prototype/schema.ts`. Ví dụ đủ khối: `docs/specs/pl-prototype/`.
   - Khối: heading, text, field, table, steps, button, banner, badge, stats, cards (việc), empty, modal (hộp xác nhận), toast, `states` (có việc / trống / lỗi / chờ), `tabs`.
   - `flow[]` = ai làm gì theo thứ tự (vẽ thành sơ đồ làn bơi + chạy «Đi thử từng bước»).
   - `questions[]` = chỗ cần người nghiệp vụ chốt: `{id, screen?, text, options[], default}`; `default` là gợi ý của mình. Không bịa yêu cầu, chỗ chưa biết thành câu hỏi.
2. `bun run proto:build docs/specs/<CR>` → kiểm (goto, vai, ≤ 8 màn: > 8 cảnh báo, > 12 lỗi, không từ kỹ thuật như slot/tenant/RLS/endpoint/payload/id=) rồi ghi `prototype.html`.
3. **Người duyệt xem**: điều phối đưa file cho họ (agent không tự đăng). Họ bấm «Đi thử từng bước», đánh «Đúng ý»/«Cần sửa» + ghi chú, bấm chọn đáp án các câu hỏi, rồi «Xuất góp ý» (tải `prototype-feedback.json` hoặc dán chữ vào chat).
4. `bun run proto:feedback docs/specs/<CR> <prototype-feedback.json>` → nối «Quyết định từ bản mẫu (ngày)» vào `spec.md` (không có thì `tasks.md`). Góp ý từ phiên bản cũ bị từ chối ⇒ cho họ xem bản mới.
5. `bun run proto:scenarios docs/specs/<CR>` → khung Delta (mỗi bước luồng một Kịch bản, `[test: thủ công — chưa viết]`) để dán vào `tasks.md`, thay bằng test thật khi viết.
6. Câu còn «Cần sửa» ⇒ sửa JSON, dựng lại, vòng lại bước 3. Hết ý kiến mới chia lát.

## Giới hạn cứng
- Chỉ dữ liệu giả — **không bao giờ** dùng dữ liệu khách thật. Nhãn theo nghiệp vụ, ít chữ.
- Không dựng stack, không React, không chụp ảnh; HTML một file, không gọi mạng, < 300 KB.

## Lưu ý
Bản mẫu là đồ bỏ đi, không phải nguồn sự thật — spec mới là nguồn. Lệch thì sửa spec, không sửa bản mẫu cho khớp code.
