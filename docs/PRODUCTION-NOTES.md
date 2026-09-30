# PRODUCTION NOTES

Quyết định nhỏ, "đã thử & bỏ vì…", bẫy đã gặp. Mới nhất ở trên. Quyết định lớn → ADR.

| Ngày | Chủ đề | Ghi chú |
|---|---|---|
| 2026-10-01 | Tài liệu | `documents/` chuyển thành `docs/design/`. Đường dẫn nội bộ giữa các file html/md giữ nguyên (tương đối). |
| 2026-10-01 | Quy trình | Chọn AI-SDLC gọn: spec → readiness → Gate một lần/mốc → code tự động. Tham khảo AWS AI-DLC, GitHub Spec Kit. |
| 2026-10-01 | Agent | Agent mới trong `.claude/agents/` chỉ hiện sau khi mở lại phiên; trong phiên hiện tại dùng general-purpose đọc nguyên văn file định nghĩa. |
