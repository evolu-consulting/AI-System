---
id: cr112-e2e-fix
lát: cr112-e2e-fix
cr: CR-112
làn: nhanh
migration: không
phụ thuộc: cr112-wizard
---
## Plan (ngắn)
Hai việc, chỉ test + hạ tầng test: (1) cấu hình gốc `playwright.config.ts` chạy trực tiếp qua `run-playwright.ts` dùng DB riêng theo làn
(trước đây dùng `ai_system_test` chung ⇒ hai worktree chạy song song giẫm nhau, trùng khoá); (2) sửa e2e cũ sau UI CR-111/CR-112.

## Làm
- `e2e-lane.rules.ts`: `laneDbEnv`, `DIRECT_DB_CONFIGS`, `directDbEnv` (thuần). `run-playwright.ts`: cấu hình gốc chạy trực tiếp ⇒ `TEST_DATABASE_URL`/`TEST_ADMIN_API_DATABASE_URL`
  = `ai_system_e2e_root[_l<làn>]_test` (cùng tên việc `root` của `test:e2e:par`), `test-db-cli ensure` tạo DB rỗng, prepare-db migrate. Đặt tay `TEST_DATABASE_URL=…` vẫn thắng.
  `test-e2e-par.rules.ts` dùng chung `laneDbEnv`.
- e2e: `auth` / `m3-flow` bỏ cổng 3000 cứng (dùng baseURL); `partners` (cell có badge Đối tác), `secrets` (Workflows là liên kết),
  `users-groups` (không còn trạng thái "chưa chọn tenant"), `tenants` (wizard: "Tiếp tục cấu hình", tab Tổng quan), `cr112-nav` (tenant_admin có tab Quota).

## Không làm / Chạm
Không đổi code app. Lỗi app thật chỉ báo cáo (không che bằng sửa test).

## Test tối thiểu
Unit `tools/scripts/src/e2e-lane.rules.test.ts` (ánh xạ làn → DB). e2e: `bun run test:e2e:par --only=root` một lần.

## Quyết định trong lúc làm
- Làn 0 (main) chạy trực tiếp cũng dùng `ai_system_e2e_root_test` (không còn đụng `ai_system_test` của test int).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ test + hạ tầng test)

## Việc còn lại
