# modules/seed — `hub:seed` (HUB-FR-60, 61, 62 · HUB-BR-08 · H1-R16 · plan H1 §3.6)

Nạp cấu hình Hub từ `apps/hub-api/seed/*.yaml` (nguồn cấu hình duy nhất tới H4/Studio).

- Điểm vào: `runHubSeed({url, dir, appEnv, profile?})` (`seed.ts`); CLI `bun run hub:seed` đọc `DATABASE_URL` (owner),
  `APP_ENV`, `HUB_SEED_DIR` (mặc định `apps/hub-api/seed`), `HUB_SEED_PROFILE`.
- `seed.schema.ts` zod từng mục yaml (strict: không trường lạ, không secret) · `seed.rules.ts` gộp file, kiểm tham chiếu,
  lọc `dev_only`, thay `$HUB_SEED_PROFILE` (thuần) · `seed.repo.ts` SQL upsert.
- H2b (R13): mục `orchestrator_tenants` (`SeedOrchestratorTenantSchema`, ≤ 1 000/file) → `planOrchestratorTenants` (thuần)
  trong transaction sau khi đọc `admin.tenants`: trùng `tenant_key` / agent lạ / tắt / runtime ≠ `agentic-cli` →
  `SeedValidationError` (path `orchestrator_tenants.<i>.<trường>`), rollback; tenant lạ → bỏ + `warn
  seed-orchestrator-tenant-unknown`. Ghi sau `orchestrator_settings` mặc định: upsert theo `tenant_id` (`id ≥ 2`),
  `remove` → xoá; bản không nhắc giữ nguyên.
- Một transaction: khoá + tăng `hub.config_meta.hub_config_version` → upsert providers → model_profiles → agents →
  orchestrator_settings → entitlements/grants (không xoá; hàng không đổi giữ `version`) → `pg_notify('hub_config_changed')`.
- Tenant/user/group thiếu → bỏ mục đó + log `warn` sau commit (Q8). Chỉ đọc `admin.*`, không ghi.
- H2a (plan-db §4, `seed.workflows.ts`): provider `dify`; agent `dify-workflow`/`dify-agent` có `runtime_options` đúng
  `{workflow_key}` (thừa khoá → lỗi); `workflows.yaml` `agent_workflows` (thêm, không xoá) + `workflow_flags.side_effect`
  (chỉ bật). Workflow vắng trong `admin.workflows` → bỏ dòng + `warn`; agent `dify-*` sai `app_type` hoặc
  `difyAgentInput` = null → `SeedValidationError`, rollback, CLI exit 1.
