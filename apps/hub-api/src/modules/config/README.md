# modules/config — cache cấu hình Admin + Hub của instance (HUB-FR-02, HUB-FR-03, HUB-BR-06, HUB-BR-08)

Plan H1 §4 Cache, §3.1, §3.4; spec H1-R04, R15, R17. Một `ConfigCache` mỗi instance, dựng trong `createApp` (`startConfigCache`).

| File | Vai trò |
|---|---|
| `config.repo.ts` | SELECT (role `hub_api`): `readVersions` (`config_version`/`hub_config_version`), `loadHubSnapshot`, `loadTenants`, `loadUsers` (cột `admin.users` được GRANT). Bảng cấu hình không RLS, không lọc tenant |
| `config.rules.ts` | kiểu `ConfigSnapshot`/`AgentConfig`/`TenantState`/`UserState` + thuần `orchestratorProblem` (BR-08), `accountUsable` (H1-R04) |
| `config.service.ts` | `ConfigCache`: `snapshot()` (run chụp lúc bắt đầu, HUB-BR-06), `tenant()`, `user()` (user lạ → đọc DB rồi cache), `accountUsable()`, `catalog()` (H2a, nạp cùng phần Admin); nạp lại qua LISTEN `config_changed` + `hub_config_changed` và poll `pollS` giây · `bootOrchestratorProblem` (`server.ts`) |
| `catalog.repo.ts` | `loadCatalogRows` (H2a §3): `admin.workflows/commands/command_names/features/feature_commands/feature_entitlements` (chưa thu hồi)`/feature_grants/groups/tenants(key)` + `hub.workflow_flags`; cột `admin.workflows.side_effect` nếu `information_schema` có (R23). Một transaction REPEATABLE READ |
| `catalog.rules.ts` | `CatalogSnapshot` bất biến, `buildCatalog` (jsonb zod ở biên, hàng hỏng bị bỏ + `warn`), `commandAccessInput`/`usableCatalogCommands` (P5, Q4) |
| `catalog.test.ts` · `catalog.int.test.ts` | unit; int đối chiếu `computeEffectiveAccess` Admin trên cùng SQL (HUB-H2a-AC-10) |
| `config.test.ts` | unit với nguồn giả (`ConfigSource`): NOTIFY, poll, nạp lỗi, đua `user()` với nạp Admin |

Luật:
- Đọc phiên bản **trước** dữ liệu: thay đổi xen giữa ⇒ vòng poll sau nạp lại, không bỏ sót.
- `user()` chỉ cache khi không có lần nạp Admin nào bắt đầu trong lúc đọc (thế hệ `#adminGen`), tránh ghi đè bản mới bằng bản cũ.
- Admin/DB lỗi ⇒ giữ cache cũ, log `warn`; lần nạp đầu lỗi ⇒ thử lại ở lần gọi sau.
- `signal` abort ⇒ bỏ LISTEN, dừng poll.

Phụ thuộc: `@ai/contracts` (kênh NOTIFY + payload, schema catalog), `@ai/db`, `modules/agents` (kiểu entitlement/grant), `modules/commands` (kiểu catalog + `usableCommands`).
