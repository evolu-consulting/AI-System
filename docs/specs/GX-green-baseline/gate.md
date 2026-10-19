# Cổng GX · nền xanh cho `test:all` (2026-10-19)

Máy Windows dev, nhánh `platform/gd0`, Postgres 16 + Redis 7.4 local, bun 1.4.3 (repo ghim 1.3.14), Node 22.23.3 (Playwright qua `tools/scripts/src/run-playwright.ts`). **Không có `docker`, `uv`** trên PATH. Lượt cuối: `bun run test:all` sau commit `ac9bf251`, không chạy gì khác song song, **2347 s (39,1 phút)**. Số thật.

**Kết quả: CHƯA xanh hoàn toàn.** `test:all` giờ chạy đủ mọi bước (20 cấu hình e2e thay vì 0); 5/23 bước đỏ, 2 bước bị chặn vì thiếu công cụ. Phần đỏ còn lại là Tranh chấp test / lỗi giao diện cần người quyết (mục 3), không phải lỗi hạ tầng.

## 1. Từng bước

| Bước | Kết quả | Thời gian |
|---|---|---|
| check (biome + size + depcruise + i18n + fn) | xanh | 20,6 s |
| typecheck (`typecheck:host`: turbo 13 gói + `tsc -p tsconfig.tests.json`) | xanh | 35,1 s |
| typecheck:agent-runtime | BỊ CHẶN: thiếu `docker` (#230) | — |
| unit (`bun --env-file=.env.local test`) | **4913 pass / 3 fail** | 42,4 s |
| int (`test:int:par`, 6 worker + 4 file tuần tự) | **3914 pass / 1 fail** | 627,2 s |
| lock | xanh (980 file) | 0,4 s |
| python | BỊ CHẶN: thiếu `docker` (chạy qua container `uv`); không tải về | — |
| e2e K1 | 5 pass | 30,2 s |
| e2e N1 | 29 pass | 21,2 s |
| e2e N2 | 2 pass | 22,1 s |
| e2e P-a | 25 pass / **1 fail** | 132,8 s |
| e2e P-b | 13 pass | 58,1 s |
| e2e P-b2 | 23 pass | 76,5 s |
| e2e P-c | 14 pass | 45,8 s |
| e2e P-c2 | 17 pass | 59,1 s |
| e2e P-d | 21 pass | 74,9 s |
| e2e chat | 69 pass / **2 fail** | 126,8 s |
| e2e chat x2a / x2b / x2b2 | 12 / 11 / 8 pass | 46,4 / 54,0 / 33,4 s |
| e2e combine | 4 pass | 26,5 s |
| e2e contracts-web | 25 pass | 22,2 s |
| e2e studio | 82 pass | 104,4 s |
| e2e x1 | 20 pass | 64,1 s |
| e2e gốc (`playwright.config.ts`, admin) | 190 pass / **4 fail** | 623,1 s |

Tổng e2e 1 620 s, int 627 s, unit 42 s, check + typecheck 56 s.

## 2. Mười file int chậm nhất (lượt cuối, `.data/int-timings.json`)

| # | File | Giây |
|---|---|---|
| 1 | `tests/acceptance/H1/concurrency.int.test.ts` | 85,2 |
| 2 | `tests/acceptance/M3/concurrency.int.test.ts` | 83,0 |
| 3 | `tests/acceptance/M2/concurrency.int.test.ts` | 68,1 |
| 4 | `packages/db/src/test-db-template.int.test.ts` | 57,1 |
| 5 | `tests/acceptance/P-b/pfs4/team-fix.int.test.ts` | 51,9 |
| 6 | `tests/acceptance/H2b/run-limit.int.test.ts` | 49,5 |
| 7 | `packages/db/src/migrate-lock.int.test.ts` | 41,9 |
| 8 | `tests/acceptance/M2/features.int.test.ts` | 39,7 |
| 9 | `tests/acceptance/P-b2/back/race.int.test.ts` | 38,3 |
| 10 | `packages/db/src/migrate-hub.int.test.ts` | 36,9 |

Thời gian đi đâu (đo, chưa tối ưu): e2e 69 % (gốc admin 623 s một mình: 194 ca, 1 worker, mỗi cấu hình build + dựng server riêng); int 27 % (3 file `concurrency` cố ý chạm đua/khoá ≈ 85 s mỗi file, cộng nhóm dựng/migrate DB); unit + check + typecheck 4 %. Trước GX bước e2e chạy 0 cấu hình nên con số cũ (684 s) thiếu hơn 1 600 s e2e.

## 3. Còn đỏ (ghi ở `tasks.md`, nợ #232)

- Unit 3: R48, R49 (`H2c/rules/contracts-h2c`), R-K01 (`P-a/step0/rules/contracts-pa`) — Tranh chấp test.
- e2e gốc 4: `conflict-workflows`, `m2-flow`, `secrets`, `workflows` — menu "Workflows" thành nhóm sổ xuống (DLC-R15, nhánh merge `0ad3700f`), trang `/workflows` mang tiêu đề khác; test khoá còn khẳng định liên kết/tiêu đề cũ — Tranh chấp test.
- e2e chat 2: CHAT-AC-35 (nền tối `rgb(14,19,27)` thay `#0F1020` của CR-049) — Tranh chấp test/thiết kế; UC-02 (nút "Ẩn nhắc" bị thay node ~0,8 s sau `run.started`, ~1,5 s sau biến mất) — cần frontend-lead.
- e2e P-a 1: pf2 `forward` CHAT-AC-57 — locator strict-mode thấy hai phần tử trùng câu "Chỉ chuyển được cho người cùng nhóm kiểm".
- int 1: `migrate-lock` hook `afterAll` (DROP DATABASE ×4 WITH FORCE) quá 30 s ngay sau lượt 6 worker (checkpoint Windows dồn); chạy riêng 34 s xanh. Lượt trước: `P1-48e` (pf1/lock-order, đua apply ∥ sweep: sweep SKIP LOCKED bỏ hàng, apply còn dở), `M4/quota-alerts`, `P-c/flow` F10 chập chờn tải; chạy riêng xanh trừ P1-48e.