# hub rls

Cập nhật: 2026-11-08 · Nguồn: CR-125.

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: bảng hub có tenant_id luôn có RLS (nguồn: cr125-sec-hub-rls)
Mọi bảng trong schema hub/admin có cột `tenant_id` bật RLS và có ít nhất một policy, trừ bảng trong allowlist có lý do
(ai_token_holds, dify_runs — chỉ truy cập qua hàm SECURITY DEFINER). Request người dùng (scope user tenant A) không đọc
hay ghi được hàng của tenant B ở audit_log, agent_grants, agent_entitlements, tenant_agent_defaults,
agent_team_entitlements, orchestrator_settings, jobs, usage_logs, cli_sessions; worker (agent_runtime) và việc nền (scope
system) vẫn thấy mọi tenant; admin đọc usage_logs/agent_grants theo scope platform/tenant.
- Kịch bản: user tenant A đọc 9 bảng thì chỉ thấy hàng A (orchestrator: thêm hàng mặc định) [test: packages/db/src/hub-rls-gap.int.test.ts » CR-125 B1 · scope user tenant A chỉ thấy hàng A (orchestrator: + mặc định), system thấy cả hai]
- Kịch bản: user A ghi hàng tenant B thì 42501; orchestrator chỉ system ghi [test: packages/db/src/hub-rls-gap.int.test.ts » CR-125 B1 · user A ghi hàng tenant B ⇒ 42501, sửa hàng B ⇒ 0 hàng, orchestrator chỉ system ghi]
- Kịch bản: thêm bảng hub mới có tenant_id mà quên RLS thì test catalog đỏ; mục allowlist lỗi thời cũng đỏ [test: packages/db/src/hub-rls.int.test.ts » CR-125 B1 · S1c · mọi bảng hub/admin có tenant_id bật RLS + có policy (trừ allowlist có lý do)]
- Kịch bản: màn tenant vẫn biết agent nào là điều phối của tenant khác qua hàm chỉ trả agent_id [test: packages/db/src/hub-rls-gap.int.test.ts » CR-125 B1 · hub.orchestrator_agent_ids() (DEFINER) trả agent điều phối mọi tenant cho scope user]

#### Yêu cầu: hub-api từ chối khởi động bằng role bỏ qua RLS (nguồn: cr125-sec-hub-rls)
hub-api không khởi động (exit 1) khi role DB là superuser, BYPASSRLS, hoặc (thành viên của) chủ bảng trong schema hub/admin.
- Kịch bản: kết nối bằng owner thì ném lỗi; hub_api thì qua [test: apps/hub-api/src/lib/db-guard.int.test.ts » owner (superuser) ⇒ ném]
- Kịch bản: role thường sở hữu một bảng hub thì ném [test: apps/hub-api/src/lib/db-guard.int.test.ts » role thường (NOSUPERUSER NOBYPASSRLS) sở hữu một bảng hub ⇒ ném]

