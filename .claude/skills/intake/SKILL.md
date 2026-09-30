---
name: intake
description: Đối chiếu thông tin mới (yêu cầu, ghi chú, file, feedback) với spec/design hiện có trước khi cập nhật tài liệu hoặc code. Gọi bằng /intake, hoặc khi người dùng đồng ý chạy Intake sau khi được hỏi.
---

# Intake

1. **Gom dữ liệu**: lấy mọi thông tin mới người dùng đã gửi kể từ lần Intake trước (có thể nhiều tin nhắn, file). Người dùng còn đang gửi ("còn nữa", "gửi tiếp") → chờ tới khi họ nói "xong".
2. **Chọn mức** (nếu người dùng chưa chọn, hỏi một câu):
   - **Nhanh** (1–3 ý, không file): tự làm các bước của `.claude/agents/intake-analyst.md` ngay trong phiên, không gọi agent.
   - **Đầy đủ** (nhiều ý, có file/tài liệu dài): gọi agent `intake-analyst` (chưa hiện trong danh sách → general-purpose đọc nguyên văn file định nghĩa), đưa nguyên văn dữ liệu + mốc hiện tại.
3. **Trình kết quả**: bảng phân loại, ảnh hưởng, câu hỏi một lượt. Không sửa tài liệu trước khi người dùng chốt.
4. **Sau khi chốt**: `docs-architect` cập nhật BA/spec, ghi dòng `CR-xxx` vào `docs/CHANGE-REQUESTS.md`, cập nhật `docs/STATE.md`. Spec bị ảnh hưởng → chạy lại `spec-readiness` (hỏi xác nhận theo Luật 1). Spec đã qua Gate → đưa vào Gate lại.
