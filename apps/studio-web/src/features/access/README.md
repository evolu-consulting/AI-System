# features/access

Quyền agent [HUB-FR-77, HUB-FR-78] (H4b-2): `/access` — ma trận entitlement hàng = agent × cột = tenant (`Access.dc.html`, plan-frontend H4b2 D9–D11). Chỉ platform_admin (khung chặn role khác).

- `api.ts`: `GET /studio/api/agent-entitlements`, `GET|PUT|DELETE /:agent_id/:tenant_id`. Chỉ file này gọi API.
- `hooks/use-access-mutations.ts`: cấp/thu hồi lạc quan. `AGENT_IS_DEFAULT` ⇒ hoàn ô + toast riêng, **không** tải lại; lỗi khác ⇒ hoàn ô + toast `access.errors.conflict` + tải lại. Thành công ⇒ invalidate ma trận + `me`.
- `lib/matrix.ts`: tra ô, lọc phía client (≤ 200), ô không áp dụng (`only_tenant_id` khác cột ⇒ "—"). Test cạnh file.
- `components/AccessCell.tsx` (memo): `switch "{agent.key} × {tenant.key}"` + nút "Chi tiết …" (chữ "{n} grant"). `CellDrawer` chỉ đọc; `RevokeDialog` nêu số grant.

Bẫy: bật = cấp ngay, không hỏi; tắt luôn qua alertdialog. Switch có kiểm soát theo cache query — đừng giữ state riêng trong ô. Lọc server → TECH-DEBT.
