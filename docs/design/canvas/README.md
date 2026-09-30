# Canvas (nguồn design đã duyệt)

Bản sao nguồn của canvas **Admin UI — đề xuất v0.4** (https://claude.ai/artifact/FTSiKuF9ax5DkMBVKMdHDB), chép ngày 2026-10-01, 18 artboard.

- `*.dc.html` — mỗi file một artboard (HTML + style inline, runtime riêng của canvas: `<x-dc>`, `<sc-for>`, `{{…}}`). **Đọc để lấy bố cục, số đo, câu chữ; không chạy trực tiếp.**
- `canvas.json` — vị trí và tiêu đề artboard.
- `tokens.md` — token trích tự động (`node docs/design/canvas/extract-tokens.mjs`). `tokens-map.md` — tên token → Tailwind/shadcn.
- Đồng bộ: trước mỗi Gate, điều phối đọc lại canvas; khác bản ở đây → cập nhật + ghi `docs/CHANGE-REQUESTS.md`.

| Artboard | Màn (ui-admin.md) |
|---|---|
| Login | 7.1 Đăng nhập |
| Main · TenantOverview | 7.2 Tổng quan (platform · tenant) |
| Commands | 7.4 Command editor |
| Workflows | 7.6 Workflows |
| Secrets | 7.8 Secrets |
| Users | 7.9 Users |
| Audit | 7.10 Nhật ký |
| ImportPreview | 7.11 Import |
| TenantCreate · TenantQuota | 7.13 Tenants |
| Groups | 7.14 Groups |
| Access | 7.15 Phân quyền |
| Usage | 7.16 Chi phí & quota |
| ChangePassword · Enable2FA | 7.1 mở rộng: đổi mật khẩu, 2FA |
| States | §9 trạng thái chung |
| Sidebar | §4 khung app |
