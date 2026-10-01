# Tasks · M1-foundation-identity

Khung do docs-architect tạo; backend-lead / frontend-lead / qc điền sau khi có plan và test-plan (đường dẫn file, lệnh xong cụ thể). Mỗi task: một commit `[ADM-FR-xx]`, diff ≈ ≤ 400 dòng (không tính test, migration, lockfile). Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Nguồn luật: `spec.md` §2 (M1-Rnn). Làm theo thứ tự; task cùng phụ thuộc chạy song song được (mỗi agent một worktree).

| # | Task | Agent | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|
| P1 | `plan.md` backend (contract, dữ liệu, RLS vs role, quyết định Mơ hồ A–B) | backend-lead | `docs/specs/M1-foundation-identity/plan.md` | spec.md | spec-readiness đọc được | [ ] |
| P2 | `plan-frontend.md` (shell, route guard, i18n, màn M1) | frontend-lead | `docs/specs/M1-foundation-identity/plan-frontend.md` | spec.md | spec-readiness đọc được | [ ] |
| Q1 | `test-plan.md` (AC-A01, A02, A09 + M1-AC01…08) | qc | `docs/specs/M1-foundation-identity/test-plan.md` | P1, P2 | spec-readiness đọc được | [ ] |
| G1 | spec-readiness + Gate (`docs/specs/M1-gate.md`, Luật 2b) | điều phối | `docs/specs/M1-foundation-identity/readiness.md`, `docs/specs/M1-gate.md` | P1, P2, Q1 | READY | [ ] |
| Q2 | Viết test khoá (đỏ trước code) | qc | `tests/acceptance/M1/**`, `e2e/**` | G1 | `ls tests/acceptance/M1` | [ ] |
| T1 | Contract auth/tenants/users/common | backend-lead | `packages/contracts/src/…` | G1 | `bun test packages/contracts` | [ ] |
| T2 | Migration schema `admin` + RLS + role | backend-lead | `packages/db/migrations/0001_…`, `packages/db/src/schema/admin.ts` | T1 | `bun run db:migrate && bun run test:int` | [ ] |
| T3 | Seed idempotent + `db:seed` (NFR-06, M1-R20) | backend-lead | `packages/db/src/seed.ts` | T2 | `bun run db:seed` hai lần | [ ] |
| T4 | Auth: login, JWT, khoá tạm, refresh xoay vòng, logout, đổi mật khẩu, `/auth/me` | backend-lead | `apps/admin-api/src/modules/auth/**` | T2 | `bun test apps/admin-api/src/modules/auth` | [ ] |
| T5 | Middleware xác thực + role + tenant context (RLS) | backend-lead | `apps/admin-api/src/lib/…` | T4 | `bun test apps/admin-api` | [ ] |
| T6 | Tenants (CRUD, lock/unlock, first admin) | backend-lead | `apps/admin-api/src/modules/tenants/**` | T5 | `bun test apps/admin-api/src/modules/tenants` | [ ] |
| T7 | Users (CRUD, lock, reset, logout-all, BR-08/09) | backend-lead | `apps/admin-api/src/modules/users/**` | T5 | `bun test apps/admin-api/src/modules/users` | [ ] |
| FE1 | App shell: layout, sidebar, topbar, route guard, http client + refresh | frontend-lead | `apps/admin-web/src/{app,lib,features/shell}/**` | T1 | `bun run --filter @ai/admin-web typecheck && bun test apps/admin-web` | [ ] |
| FE2 | i18n VI/EN đầy đủ cho M1 + `i18n:check` | frontend-lead | `packages/i18n/locales/*.json` | FE1 | `bun run i18n:check` | [ ] |
| FE3 | Màn Đăng nhập + Đổi mật khẩu + modal phiên hết hạn | frontend-lead | `apps/admin-web/src/features/auth/**` | FE1, T4 | `bunx playwright test auth` | [ ] |
| FE4 | Màn Tenants (danh sách, tạo + dialog mật khẩu tạm, chi tiết) | frontend-lead | `apps/admin-web/src/features/tenants/**` | FE3, T6 | `bunx playwright test tenants` | [ ] |
| FE5 | Màn Users (danh sách, drawer, khoá, reset) + bộ trạng thái chung | frontend-lead | `apps/admin-web/src/features/users/**` | FE3, T7 | `bunx playwright test users` | [ ] |
| Q3 | Ghi `tests/.lock` sau Gate | qc | `tests/.lock` | G1, Q2 | `bun run test:lock:write && bun run test:lock:verify` | [ ] |
| T8 | Nghiệm thu M1 (Lệnh xong M1, spec §8) | backend-lead + qc | — | tất cả | xem `spec.md` §8 "Lệnh xong" | [ ] |
| D1 | CODEMAP, TRACE, STATE, ROADMAP, README module | docs-architect | `docs/CODEMAP.md`, `docs/TRACE.md`, `docs/STATE.md`, `docs/ROADMAP.md` | T8 | review | [ ] |
