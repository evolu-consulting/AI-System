# modules/agent-grants — cấp/thu hồi agent cho group/user (HUB-FR-78, HUB-FR-79, HUB-BR-17, ADM-FR-37)

API quản trị Hub (H3b). Chỉ `tenant_admin`/`platform_admin` (`requireAdminRole`, 403 trước parse). Mount ở `app.h3b.ts`; `/agent-grants` trong `PROTECTED_PREFIXES` của `app.ts`.

| File | Vai trò |
|---|---|
| `agent-grants.rules.ts` | `targetTenant` (tenant đích, gọi **một lần** ở route — R02) · `grantProblem` (thứ tự lỗi R04) |
| `agent-effective.rules.ts` | `effectiveAgents` (Kiểm tra quyền phần agent, R12–R14) |
| `agent-effective.service.ts` | GET `effective/:user_id`: tính trên ảnh cache (kéo theo kịp `hub_config_version` DB) + `GROUP_REFS`; chỉ đọc (R15) |
| `agent-grants.routes.ts` | GET/POST/DELETE `/agent-grants`: parse query/body (400) → `tenantOf` → service. Không logic |
| `agent-grants.service.ts` | `grant`/`revoke`/`list`. Ghi: `config_meta` FOR UPDATE → `agent_grants` → bump → audit → NOTIFY trong một transaction; trùng/không có hàng ⇒ không ghi gì (tập hợp, R06/R07) |
| `agent-grants.repo.ts` | SQL nguyên văn `plan-db` §2 — mọi câu có `tenant_id = T` (bảng không RLS, R03); ngoại lệ có lý do `actorName` + join `gb` (N5/QP2) |
| `agent-grants.map.ts` | hàng DB → contract `@ai/contracts/hub-admin` (cắt grant/agent, `runnable`, `is_beta`) |

Luật:
- Tenant đích chốt một lần đầu request; service/repo nhận `T` làm tham số, không đọc lại JWT.
- `GET` đọc DB trong REPEATABLE READ read only (thấy ngay sau POST — PL5); grant mồ côi (group/user đã xoá) ẩn bằng join (Q-K8).
- Audit `grant`/`revoke` qua `HubAuditWriter` (`lib/hub-audit.ts`); lỗi audit ⇒ rollback cả thao tác (500).

Phụ thuộc: `lib/{hub-config-write,hub-audit,admin-role.middleware,http}`, `agents/agent-access.rules` (`RUNNABLE_RUNTIMES`), `@ai/db/hub-scope`.
