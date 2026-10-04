# modules/seed — `hub:seed` (HUB-FR-60, 61, 62 · HUB-BR-08 · H1-R16 · plan H1 §3.6)

Nạp cấu hình Hub từ `apps/hub-api/seed/*.yaml` (nguồn cấu hình duy nhất tới H4/Studio).

- Điểm vào: `runHubSeed({url, dir, appEnv, profile?})` (`seed.ts`); CLI `bun run hub:seed` đọc `DATABASE_URL` (owner),
  `APP_ENV`, `HUB_SEED_DIR` (mặc định `apps/hub-api/seed`), `HUB_SEED_PROFILE`.
- `seed.schema.ts` zod từng mục yaml (strict: không trường lạ, không secret) · `seed.rules.ts` gộp file, kiểm tham chiếu,
  lọc `dev_only`, thay `$HUB_SEED_PROFILE` (thuần) · `seed.repo.ts` SQL upsert.
- Một transaction: khoá + tăng `hub.config_meta.hub_config_version` → upsert providers → model_profiles → agents →
  orchestrator_settings → entitlements/grants (không xoá; hàng không đổi giữ `version`) → `pg_notify('hub_config_changed')`.
- Tenant/user/group thiếu → bỏ mục đó + log `warn` sau commit (Q8). Chỉ đọc `admin.*`, không ghi.
