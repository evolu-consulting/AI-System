# PRODUCTION NOTES

Quyết định nhỏ, "đã thử & bỏ vì…", bẫy đã gặp. Mới nhất ở trên. Quyết định lớn → ADR.

| Ngày | Chủ đề | Ghi chú |
|---|---|---|
| 2026-10-05 | H2a mạng / Dify (I3, CR-036) | `/internal/*` (test-run, credential) và `/mcp` nhận Bearer bản rõ (token dịch vụ / token job) → khi Runtime hoặc Admin ở máy khác Hub **bắt buộc TLS hoặc mạng nội bộ**. Dify hiện mở HTTP thường trên IP công khai (app-key đi không mã hoá) → TLS/mạng nội bộ trước production. Production phải đặt `HUB_PUBLIC_INTERNAL_URL` (vắng → agent không có MCP, chỉ cảnh báo) và `HUB_INTERNAL_TOKEN` (vắng → test-run 503). WSL NAT: xem `docs/guides/hub-dev.md`. |
| 2026-10-05 | H2a DB (D2) | Migration Hub (`0003_h2a_dify_fn`) phải chạy bằng role chủ `admin.secrets` và `hub.usage_logs` (owner): `hub.workflow_secret` / `hub.log_dify_usage` là SECURITY DEFINER, chủ hàm = role chạy migration. Hub đọc secret Dify **chỉ** qua hàm (EXECUTE `hub_ro`), không có quyền cột `admin.secrets`. |
| 2026-10-04 | M4 mail / cấu hình | Cảnh báo quota và đặt lại gửi email qua `SMTP_URL` (dev: Mailpit trong `compose.yaml`, `smtp://127.0.0.1:1025`), `MAIL_FROM` (tuỳ chọn), `ADMIN_WEB_URL` (link trong mail). Production phải đặt SMTP thật; mail gửi sau commit (TECH-DEBT #13). |
| 2026-10-04 | M4 2FA / khoá | `SECRET_MASTER_KEY` nay mã hoá cả secret TOTP (`user_totp`, bảng riêng, Hub không đọc được): mất khoá = người dùng bật 2FA không đăng nhập được bằng mã (còn mã dự phòng HMAC). Chưa xoay khoá (#16). |
| 2026-10-04 | M4 audit | `admin.audit_log` append-only: role ứng dụng không UPDATE/DELETE được; không có đường xoá, chỉ lưu trữ ngoài DB nếu cần. Khôi phục tạo dòng mới, không sửa dòng cũ. |
| 2026-10-04 | M4 hiệu năng | `bun run test:perf` ngoài Lệnh xong, chưa chạy trên môi trường ổn định; TD #27 (đo), #28 (RLS InitPlan, chờ duyệt). Trần transfer 5000 hàng/loại → 400 `VALIDATION_ERROR` (#35); `hub_ro` đọc được `admin.tenants` (#34). |
| 2026-10-03 | M3 NOTIFY / Hub | `NOTIFY config_changed` phát **sau commit** (`lib/config/config-write.ts`), không trong transaction retry (TECH-DEBT #13). NOTIFY có thể mất nếu Hub mất kết nối: Hub phải đọc `admin.config_meta` (`config_version`) định kỳ làm dự phòng và nạp lại khi lệch. Hub dùng role `hub_ro`; SQL tham chiếu `access.repo.visibleUserCounts`. |
| 2026-10-03 | Hiệu năng / RLS | `bun run test:perf` (không thuộc Lệnh xong) chưa chạy trên môi trường ổn định; số đo Docker/Windows dao động mạnh (TECH-DEBT #27). Policy RLS `current_setting(...)::uuid` tính theo hàng, chậm ở bảng lớn; đề xuất dạng InitPlan chờ người dùng duyệt (#28, đụng cách ly tenant). Cả hai cần đánh giá trước production. |
| 2026-10-02 | `SECRET_MASTER_KEY` | Khoá dùng **chung với Hub** (Hub giải mã secret theo cùng công thức AAD, M2 plan §3.2). **Mất khoá = mất mọi secret** (không khôi phục được; phải nhập lại từng giá trị). Khoá phải được sao lưu và quản lý **ngoài repo** (secret manager của vận hành); không đặt trong DB, không commit. Chưa có xoay khoá (TECH-DEBT #16). |
| 2026-10-01 | DB production | Đặt mật khẩu cho role `admin_api` (migration chỉ tạo role, không đặt mật khẩu thật). Role owner chạy migration cần quyền `CREATEROLE`. |
| 2026-10-01 | Migration | `0002_admin_rls.sql` sửa thẳng ở `ceb5693` (siết RLS). DB dev cũ: reset hoặc `ALTER POLICY`; xem `packages/db/README.md`. Từ M2 chỉ thêm migration mới. |
| 2026-10-01 | Tài liệu | `documents/` chuyển thành `docs/design/`. Đường dẫn nội bộ giữa các file html/md giữ nguyên (tương đối). |
| 2026-10-01 | Quy trình | Chọn AI-SDLC gọn: spec → readiness → Gate một lần/mốc → code tự động. Tham khảo AWS AI-DLC, GitHub Spec Kit. |
| 2026-10-01 | Agent | Agent mới trong `.claude/agents/` chỉ hiện sau khi mở lại phiên; trong phiên hiện tại dùng general-purpose đọc nguyên văn file định nghĩa. |
