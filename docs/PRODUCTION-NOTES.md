# PRODUCTION NOTES

Quyết định nhỏ, "đã thử & bỏ vì…", bẫy đã gặp. Mới nhất ở trên. Quyết định lớn → ADR.

| Ngày | Chủ đề | Ghi chú |
|---|---|---|
| 2026-10-02 | `SECRET_MASTER_KEY` | Khoá dùng **chung với Hub** (Hub giải mã secret theo cùng công thức AAD, M2 plan §3.2). **Mất khoá = mất mọi secret** (không khôi phục được; phải nhập lại từng giá trị). Khoá phải được sao lưu và quản lý **ngoài repo** (secret manager của vận hành); không đặt trong DB, không commit. Chưa có xoay khoá (TECH-DEBT #16). |
| 2026-10-01 | DB production | Đặt mật khẩu cho role `admin_api` (migration chỉ tạo role, không đặt mật khẩu thật). Role owner chạy migration cần quyền `CREATEROLE`. |
| 2026-10-01 | Migration | `0002_admin_rls.sql` sửa thẳng ở `ceb5693` (siết RLS). DB dev cũ: reset hoặc `ALTER POLICY`; xem `packages/db/README.md`. Từ M2 chỉ thêm migration mới. |
| 2026-10-01 | Tài liệu | `documents/` chuyển thành `docs/design/`. Đường dẫn nội bộ giữa các file html/md giữ nguyên (tương đối). |
| 2026-10-01 | Quy trình | Chọn AI-SDLC gọn: spec → readiness → Gate một lần/mốc → code tự động. Tham khảo AWS AI-DLC, GitHub Spec Kit. |
| 2026-10-01 | Agent | Agent mới trong `.claude/agents/` chỉ hiện sau khi mở lại phiên; trong phiên hiện tại dùng general-purpose đọc nguyên văn file định nghĩa. |
