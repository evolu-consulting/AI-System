# Admin · tổng quan hiện hành

Cập nhật: 2026-11-03 · Nguồn: PDF "ai-admin – Tài liệu nghiệp vụ" Phần A (intake CR-112: các ý "Đã có"). Chi tiết theo mảng: `tenant-user.md`, `nhom-doi-tac.md`, `ung-dung-quyen.md`, `catalog-quota-audit.md`. Ghi chú đối tác: `ghi-chu.md`. Hướng cải tổ (chưa code): `docs/specs/cr112-admin-config/README.md`.

## Mục đích
Một nơi quyết định tenant nào, nhóm nào, ai được dùng gì và bao nhiêu, đổi hành vi hệ thống không cần deploy. Admin lo: danh tính (tenant, user, group, đăng nhập, token), phân quyền (3 vai hệ thống, feature/entitlement/grant), catalog workflow Dify + command dùng chung, quota & chi phí theo tenant, secret mã hoá, audit + export/import.
Admin KHÔNG lo: chạy workflow, gọi LLM, lưu hội thoại, cấu hình agent (thuộc Agent Hub; nút Test nhờ Hub chạy thử).

## Nền
- Bốn khối: Admin · Agent Hub · Worker · Chat App/Extension. Trang Quy trình và Nguồn hiển thị trong admin-web nhưng dữ liệu thuộc schema `hub`.
- Command, workflow, secret, key Dify dùng chung toàn hệ thống; tenant chỉ được cấp quyền dùng, không tự tạo (ADM-BR-14).
- Admin và Hub chung một Postgres; admin sở hữu schema `admin`.
- Actor: platform_admin · tenant_admin · member · Agent Hub (đọc `hub_ro`) · Builder.

## Phi chức năng (ADM-NFR-01..07, AC-A01..A15)
argon2id, JWT EdDSA, master key ở env, giới hạn IP/VPN cho API platform_admin · lan truyền cấu hình ≤ 5 giây (NFR-02) · CRUD < 300 ms, báo cáo chi phí < 2 s (NFR-03) · Admin chết thì Hub vẫn chạy bằng cache + verify JWT (NFR-04) · cách ly tenant ở tầng repository (truy vấn tenant_admin kẹp `tenant_id`, ngoài ⇒ 404) · chống ghi đè bằng `version` (FR-55, 409). AC chính: AC-A01 (đăng nhập + khoá sau 5 lần), AC-A02 (khoá user ⇒ mất quyền ≤ 15 phút), AC-A06 (secret không lộ).

## Tổng quan (Dashboard)
Màn Tổng quan khác nhau theo vai: số tenant, command, workflow, user, tenant vượt quota (module `overview`).

## Đóng băng (`ADMIN_FROZEN_MODULES`)
admin-api workflows/workflow-tools/commands/transfer; admin-web Commands/Workflows/Transfer/Nguồn; hub sources.
