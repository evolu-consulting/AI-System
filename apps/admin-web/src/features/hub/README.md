# features/hub

Admin gọi Hub THẲNG [ADM-FR-37] [ADM-FR-36] (X1 F5, CR-043): `/agent-grants*` bằng JWT admin, địa chỉ `PUBLIC_HUB_URL` (`lib/hub.ts`, nhúng lúc build; vắng → "Chưa cấu hình địa chỉ Hub (PUBLIC_HUB_URL).", không gọi).

- `api.ts`: `useGroupAgentGrants(groupId, tenantId?)` (GET theo group, Hub trả mọi agent + grant của group), `useSetGroupAgentGrant` (POST cấp / DELETE thu hồi, idempotent; xong → làm mới quyền hiệu lực), `useEffectiveAgents` (`/agent-grants/effective/:user_id`, `staleTime 0`).
- `hooks/use-hub-tenant`: `?tenant_id=` chỉ gửi khi `platform_admin`; `tenant_admin` để Hub lấy tenant từ JWT.
- `hooks/use-effective-agents`: trạng thái `EffectiveAgentsState` cho `AccessExplainer` (Kiểm tra quyền + tab Quyền hiệu lực của drawer user). `EffectiveAccess.agents` của admin-api bị bỏ qua.
- Người dùng: tab Agent của group (`features/groups/components/editor/AgentTab.tsx`, `lazy()`), `components/shared/access/AgentSection.tsx`.
- Lỗi: `describeHubError` (`lib/errors.ts`, key `hubErrors.*`, mã `HUB_ADMIN_ERRORS`); mạng/5xx → "Không kết nối được Hub."
