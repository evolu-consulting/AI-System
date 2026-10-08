# features/agents

Màn **Agents** của Evolu Control (`/agents`, nhóm CHỨC NĂNG) [HUB-FR-77] [HUB-FR-78] (CR-054): agent bật cho công ty, ai được dùng, đúng một agent mặc định ở Hỏi AI.

- `api.ts` (nơi duy nhất gọi API): Hub `GET /agent-settings`, `PUT /agent-settings/default`, `PUT /agent-settings/entitlements` (chỉ platform_admin), `GET/POST/DELETE /agent-grants`; Admin `/admin/groups`, `/admin/users` (≤ 200, cho ngăn Cấp quyền). `tenant_id` chỉ gửi khi platform_admin (chọn tenant qua `?tenant=<mã>`, `resolveViewedTenant`).
- `hooks/use-agents-view` (tenant + query), `use-agent-actions` (Đặt mặc định, "Không khớp agent nào →", bật/tắt cho công ty; 409 `AGENT_IS_DEFAULT` → `agents.error.isDefault`, lỗi khác → `describeHubError`), `use-grant-sheet` (ngăn Cấp quyền: Lưu = thêm trước, thu hồi sau).
- `lib/agents.ts`: nhãn model/runtime, body agent mặc định + dự phòng, chip "Ai được dùng". `lib/grant-draft.ts`: lựa chọn ↔ grant (subject `tenant` = "Cả công ty"), chênh lệch.
- Orchestrator không cấp quyền riêng (Hub 409 `AGENT_NOT_GRANTABLE`): đã bật cho công ty = cả công ty dùng được.
- Vắng `PUBLIC_HUB_URL` → "Chưa cấu hình địa chỉ Hub" (như tab Agent của Groups).
