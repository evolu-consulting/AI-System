---
name: prototype
description: Dựng "Bản mẫu bấm được" (một file HTML, dữ liệu giả) để giám đốc/sale xác nhận màn hình hoặc luồng mới TRƯỚC khi viết code. Bước tùy chọn của dây chuyền.
---

# Bản mẫu bấm được

## Khi nào dùng
- CR thêm/đổi **màn hình hoặc luồng người dùng nhìn thấy** và còn điểm cần người nghiệp vụ chốt.
- **Bỏ qua** khi: backend thuần, sửa lỗi, công cụ/tools, đổi chữ nhỏ, hoặc giao diện đã có mẫu duyệt.

## Các bước (≤ 15 phút)
1. Đọc spec của CR (chỉ spec, không đọc code).
2. Viết `docs/specs/<CR>/prototype.json` theo `tools/prototype/schema.ts`: `title`, `roles`, `screens` (khối: heading, text, field, table, steps, button, banner, states), `flow`, `notes`. Nhãn theo ngôn ngữ nghiệp vụ, không thuật ngữ kỹ thuật.
3. Chạy `bun run proto:build docs/specs/<CR>` → `prototype.html` (ví dụ: `docs/specs/pl-prototype/`).
4. Điều phối cho người dùng xem/đăng bản mẫu (agent không tự đăng).
5. Gom câu trả lời → ghi vào mục "Quyết định" của spec.
6. Chỉ sau đó mới chia lát và viết code.

## Giới hạn cứng
- ≤ 15 phút, ≤ 8 màn hình, chỉ dữ liệu giả — **không bao giờ** dùng dữ liệu khách thật.
- Không bịa yêu cầu mới: chỗ chưa biết ghi thành câu hỏi trong `notes`.
- Không dựng stack, không React, không chụp ảnh.

## Lưu ý
Bản mẫu là đồ bỏ đi, không phải nguồn sự thật — spec mới là nguồn. Lệch thì sửa spec, không sửa bản mẫu cho khớp code.
