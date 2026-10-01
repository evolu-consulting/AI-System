# @ai/db

Schema Drizzle, migration SQL và RLS cho Postgres. FR: ADM-NFR-06, ADM-NFR-07, ADM-FR-01, ADM-FR-10, ADM-FR-50, ADM-FR-62, ADM-FR-53.

- Vào: `src/` (schema, client), `migrations/` (SQL chính thức), `migrations-dev/` (chỉ dev).
- Thêm: `src/scope.ts` (`withScope`: transaction + `app.tenant_id`, chạy lại 40P01/40001 ≤ 3 lần), `src/password.ts` (argon2id), `src/seed.ts` (idempotent), `schema/admin.ts` (10 bảng: 4 M1 + 6 catalog M2), `schema/permissions.ts` (4 bảng M3: groups, group_members, feature_grants, config_meta; RLS + trigger `beta-testers` ở `0006`).
- Chạy: `bun run db:migrate`, `bun run db:seed`, `bun run db:setup`.

## Bẫy
- Callback của `withScope` có thể chạy lại: chỉ làm việc DB, không gửi gì ra ngoài (TECH-DEBT #13).
- `migrations/0002_admin_rls.sql` đã bị sửa thẳng ở commit `ceb5693` để siết policy RLS. DB dev tạo trước `ceb5693` phải reset (`docker compose down -v` rồi migrate lại) hoặc chạy `ALTER POLICY` theo nội dung file hiện tại.
- `admin.secrets`: `admin_rw` chỉ có SELECT theo cột (không `ciphertext`/`iv`, `0004_catalog_rls`) → mọi `select`/`returning` phải liệt kê cột; `hub_ro` không có quyền nào.
- Trigger `tenants_beta_group` (0006) tạo group `beta-testers` cùng mọi INSERT tenant, kể cả fixture SQL.
- Từ M2 không sửa migration đã commit; mọi thay đổi là migration mới (`docs/CONVENTIONS.md` §8).

## DB test riêng (mỗi agent/worktree, TECH-DEBT #17)
NOTIFY, bộ đếm deadlock (`pg_stat_database`) và hàng `config_meta` là trạng thái chung của **một database** → test `notify`/`concurrency`/`lock-order` đỏ ngẫu nhiên nếu nhiều agent cùng chạy trên `ai_system_test`.
- Tạo: `bun run db:test:create <tag>` (tag `^[a-z0-9_]{1,24}$`, vd `be`, `fe`, `qc`) → database `ai_system_<tag>_test` (cùng server với `TEST_DATABASE_URL`, đã migrate, role dùng chung của cluster) + file `.env.test-<tag>.local` (bản sao `.env.local`, chỉ đổi `TEST_DATABASE_URL`, `TEST_ADMIN_API_DATABASE_URL`; đã bị gitignore). Chạy lại được (không tạo trùng, migrate tiếp).
- Dùng: `bun --env-file=.env.test-<tag>.local --config=bunfig.int.toml test --timeout 30000 <file…>`.
- e2e giữ `ai_system_test`. Nếu cần DB riêng: chỉ truyền hai biến trên dòng lệnh, `TEST_DATABASE_URL=… TEST_ADMIN_API_DATABASE_URL=… bunx playwright test …` (Playwright chỉ nạp `.env.local`, không ghi đè biến đã có). **Không** `set -a; . .env…` — khoá PEM có `\n` bị shell đọc sai.
- Xoá: `bun run db:test:drop <tag>` (`DROP DATABASE … WITH (FORCE)`, chỉ tên `ai_system_<tag>_test`; xoá luôn `.env.test-<tag>.local`).
