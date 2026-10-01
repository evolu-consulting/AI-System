# @ai/db

Schema Drizzle, migration SQL và RLS cho Postgres. FR: ADM-NFR-06, ADM-NFR-07.

- Vào: `src/` (schema, client), `migrations/` (SQL chính thức), `migrations-dev/` (chỉ dev).
- Chạy: `bun run db:migrate`.

## Bẫy
- `migrations/0002_admin_rls.sql` đã bị sửa thẳng ở commit `ceb5693` để siết policy RLS. DB dev tạo trước `ceb5693` phải reset (`docker compose down -v` rồi migrate lại) hoặc chạy `ALTER POLICY` theo nội dung file hiện tại.
- Từ M2 không sửa migration đã commit; mọi thay đổi là migration mới (`docs/CONVENTIONS.md` §8).
