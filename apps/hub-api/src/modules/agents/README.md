# modules/agents — quyền thấy/delegate agent (HUB-FR-77, HUB-BR-03, HUB-BR-06)

Luật thuần, không I/O (plan H1 §6.1, §6.4; spec H1-R05, R06). Dùng bởi `modules/orchestrator` (danh sách `<agents>` + kiểm lại mỗi lần delegate).

| File | Vai trò |
|---|---|
| `agent-access.rules.ts` | `accessInput(ảnh run, user)` (chỉ agent `H1_RUNTIME` = `agentic-cli`) · `visibleAgents` (bật ∧ entitlement chưa thu hồi ∧ grant user/group ∧ ≠ Orchestrator, sắp `key`) · `canDelegate` (null → step `skipped not_allowed`) |
| `agent-menu.rules.ts` | H2b (HUB-FR-92, R11): `toAgentMenuItem` (`{key, name, description}`), `agentMenu(ảnh, user)` = AU sắp `key` (≤ `AGENT_MENU_MAX`) |
| `agents.service.ts` · `agents.routes.ts` | GET `/agents` (JWT ở gốc `app.ts`, mount ở `app.h2b.ts`): ảnh cấu hình + nhóm user từ cache, 0 query khi cache nóng |
| `agent-access.test.ts` | unit `accessInput`/`canDelegate`; R7 `visibleAgents` khoá ở `tests/acceptance/H1/rules/agent-access.test.ts` |

Luật:
- HUB-BR-06: quyền tính trên ảnh cấu hình chụp lúc tạo run, không đọc ảnh mới giữa run.
- Kiểu `AccessSnapshot` là kiểu cấu trúc (không import `config` ngược chiều); `config.rules` import `EntitlementRow`/`GrantRow` từ đây.

Phụ thuộc: `*.rules` thuần; `agents.service` dùng `config/config.service` (cache), `lib/auth.middleware` (kiểu).
