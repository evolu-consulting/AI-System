# @ai/db

Schema Drizzle, migration SQL và RLS cho Postgres. FR: ADM-NFR-06, ADM-NFR-07, ADM-FR-01, ADM-FR-10, ADM-FR-50.

- Vào: `src/` (schema, client), `migrations/` (SQL chính thức), `migrations-dev/` (chỉ dev).
- Thêm: `src/scope.ts` (`withScope`: transaction + `app.tenant_id`, chạy lại 40P01/40001 ≤ 3 lần), `src/password.ts` (argon2id), `src/seed.ts` (idempotent), `schema/admin.ts` (10 bảng: 4 M1 + 6 catalog M2).
- Chạy: `bun run db:migrate`, `bun run db:seed`, `bun run db:setup`.

## Bẫy
- Callback của `withScope` có thể chạy lại: chỉ làm việc DB, không gửi gì ra ngoài (TECH-DEBT #13).
- `migrations/0002_admin_rls.sql` đã bị sửa thẳng ở commit `ceb5693` để siết policy RLS. DB dev tạo trước `ceb5693` phải reset (`docker compose down -v` rồi migrate lại) hoặc chạy `ALTER POLICY` theo nội dung file hiện tại.
- `admin.secrets`: `admin_rw` chỉ có SELECT theo cột (không `ciphertext`/`iv`, `0004_catalog_rls`) → mọi `select`/`returning` phải liệt kê cột; `hub_ro` không có quyền nào.
- Từ M2 không sửa migration đã commit; mọi thay đổi là migration mới (`docs/CONVENTIONS.md` §8).
