---
id: cr125-sec-hub-rls
lát: cr125-sec-hub-rls
cr: CR-125
làn: đầy đủ (RLS)
migration: hub 0127_hub_rls_gap (journal idx 110, when 1806900900000)
phụ thuộc:
---
## Plan (ngắn)
sa-review B1 (S1a + S1b + S1c), `docs/specs/CR-125/sa-review.md` § "B1 fix plan".

## Làm
- [x] S1a · `0127_hub_rls_gap.sql`: ENABLE RLS 9 bảng (audit_log, agent_grants, agent_entitlements, tenant_agent_defaults,
  agent_team_entitlements, orchestrator_settings, jobs, usage_logs, cli_sessions); policy hub_rw T (như 0019);
  orchestrator_settings đọc T ∨ NULL, ghi chỉ system; agent_runtime `USING (true)` (jobs/usage_logs/cli_sessions);
  admin_rw SELECT usage_logs/agent_grants (vị từ usage_daily). Không FORCE (0128 sau).
- [x] "Một sửa code trước": hàm DEFINER `hub.orchestrator_agent_ids()`; `agent-settings.repo.ts` (listAgents) và
  `agent-grants.repo.ts` (kiểm agent + danh sách) dùng hàm thay vì đọc `orchestrator_settings` của tenant khác.
- [x] Chỗ chạy không scope (soát caller): `config.repo.ts` loadHubSnapshot ⇒ `withHubScope` system (RR, read only);
  `agent-spec.service.ts` ⇒ system; admin `daily-limits` `aiTokensUsed` ⇒ `withScope` riêng.
- [x] S1b · `apps/hub-api/src/lib/db-guard.ts` + gọi trong `server.ts` (`openDb`), pool tri thức riêng chỉ chặn superuser/BYPASSRLS.
- [x] S1c · `hub-rls.int.test.ts`: thay danh sách cứng bằng truy vấn catalog + `HUB_RLS_ALLOWLIST` (ai_token_holds, dify_runs) + kiểm mục lỗi thời + role runtime không sở hữu bảng.

## Không làm / Chạm
- Không FORCE (0128), không đổi `tests/acceptance/M1|M2|M3/db-rls` (chỉ schema admin, vẫn đúng). Không chạm admin-web/workspace-web/DLC.
- Test khoá sửa: `tests/acceptance/H3b/db-grants.int.test.ts` (kết nối hub_api đặt `app.scope=system` để kiểm GRANT) + relock.

## Test tối thiểu
- `packages/db/src/hub-rls-gap.int.test.ts` (chéo tenant 9 bảng, viết trước migration), `hub-rls.int.test.ts` (S1c),
  `apps/hub-api/src/lib/db-guard.test.ts` + `db-guard.int.test.ts`.
- evotest int -Dirty: lượt 1 (26 file db/admin/acceptance db) + lượt 2 (29 file hub-api jobs/usage/agents/audit/orchestrator) + lượt sửa đỏ (8 file) xanh.

## Quyết định trong lúc làm
- hub_ro không có GRANT trên 9 bảng ⇒ không policy hub_ro (policy chỉ hub_rw/agent_runtime/admin_rw).
- listAgents: loại agent điều phối của tenant khác so theo `agent_id` (hàm chỉ trả agent_id) thay vì `id` hàng — cùng kết quả trừ ca một agent vừa là mặc định vừa là bản riêng của tenant khác (nay vẫn hiện ở tenant dùng mặc định, đúng hơn).
- Guard pool tri thức: không kiểm chủ bảng `knowledge` (role tri thức là thành viên SET-được của role gói, giống lý do loại `packs`).
- Test hub_api kiểm GRANT thô (h3b) đặt `app.scope=system` bằng tham số kết nối.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### ADDED platform/hub-rls.md
#### Yêu cầu: bảng hub có tenant_id luôn có RLS
Mọi bảng trong schema hub/admin có cột `tenant_id` bật RLS và có ít nhất một policy, trừ bảng trong allowlist có lý do
(ai_token_holds, dify_runs — chỉ truy cập qua hàm SECURITY DEFINER). Request người dùng (scope user tenant A) không đọc
hay ghi được hàng của tenant B ở audit_log, agent_grants, agent_entitlements, tenant_agent_defaults,
agent_team_entitlements, orchestrator_settings, jobs, usage_logs, cli_sessions; worker (agent_runtime) và việc nền (scope
system) vẫn thấy mọi tenant; admin đọc usage_logs/agent_grants theo scope platform/tenant.
- Kịch bản: user tenant A đọc 9 bảng thì chỉ thấy hàng A (orchestrator: thêm hàng mặc định) [test: packages/db/src/hub-rls-gap.int.test.ts » CR-125 B1 · scope user tenant A chỉ thấy hàng A (orchestrator: + mặc định), system thấy cả hai]
- Kịch bản: user A ghi hàng tenant B thì 42501; orchestrator chỉ system ghi [test: packages/db/src/hub-rls-gap.int.test.ts » CR-125 B1 · user A ghi hàng tenant B ⇒ 42501, sửa hàng B ⇒ 0 hàng, orchestrator chỉ system ghi]
- Kịch bản: thêm bảng hub mới có tenant_id mà quên RLS thì test catalog đỏ; mục allowlist lỗi thời cũng đỏ [test: packages/db/src/hub-rls.int.test.ts » CR-125 B1 · S1c · mọi bảng hub/admin có tenant_id bật RLS + có policy (trừ allowlist có lý do)]
- Kịch bản: màn tenant vẫn biết agent nào là điều phối của tenant khác qua hàm chỉ trả agent_id [test: packages/db/src/hub-rls-gap.int.test.ts » CR-125 B1 · hub.orchestrator_agent_ids() (DEFINER) trả agent điều phối mọi tenant cho scope user]

#### Yêu cầu: hub-api từ chối khởi động bằng role bỏ qua RLS
hub-api không khởi động (exit 1) khi role DB là superuser, BYPASSRLS, hoặc (thành viên của) chủ bảng trong schema hub/admin.
- Kịch bản: kết nối bằng owner thì ném lỗi; hub_api thì qua [test: apps/hub-api/src/lib/db-guard.int.test.ts » owner (superuser) ⇒ ném]
- Kịch bản: role thường sở hữu một bảng hub thì ném [test: apps/hub-api/src/lib/db-guard.int.test.ts » role thường (NOSUPERUSER NOBYPASSRLS) sở hữu một bảng hub ⇒ ném]

## Việc còn lại
- 0128: FORCE RLS nơi không có hàm DEFINER ghi + allowlist `FORCE_EXEMPT` (sa-review S1c).
- qc: `tests/acceptance/M2|M3/db-rls` đếm cứng 23 bảng admin ⇒ chuyển sang dạng suy từ catalog (sa-review S1c, chưa làm — test khoá).
- Chạy lại `claim_scale_int_test.py` + perf claim hub một lần ở đợt cuối (claim chạy agent_runtime `USING (true)`, kế hoạch không đổi).
