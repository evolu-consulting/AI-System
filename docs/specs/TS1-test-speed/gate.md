# Cổng TS1 · tốc độ test (2026-10-19)

Máy Windows dev, 12 luồng, 16 GB, Postgres 16 (max_connections 200) + Redis 7.4 local, bun 1.4.3. Trước = GX2 (`docs/specs/GX-green-baseline/gate.md`). Số thật, không retry, không nới timeout.

## 1. Trước → sau từng bước

| Bước | Trước | Sau | Ghi chú |
|---|---|---|---|
| check / typecheck / unit (chạy song song, đợt 1) | 20,9 / 48,8 / 42,5 s (nối tiếp ≈ 112 s) | 28,4 / 45,4 / 54,4 s, đợt ≈ 55 s | `test:all` đợt nhẹ chạy cùng lúc |
| int (`test:int:par`) | 608–658 s | 438–475 s (pool 6 worker: 526 → 350 s) | reset DELETE, H1 `peek` theo tín hiệu, template donor, GC nền |
| e2e (21 việc, 5 cùng lúc) | 1 620 s (18 cấu hình nối tiếp) | 560–606 s | root admin 623 s → 4 ca 230–300 s song song; m4-2fa 237 → 58 s |
| `test:all` tổng | 2 308 s | **1 136 s** (đợt nhẹ 55 + int 475 + e2e 606) | CHƯA đạt < 10 phút |
| `test:affected` mẫu (sửa 1 file chat-web) | — | 119,5 s (check 25 + typecheck 27 + unit 5 + e2e chat 91) | < 3 phút đạt |

Từng file int: H1 concurrency 85,2 → 3,8 s · M3 concurrency 56,6 → 23,9 s · M2 concurrency 65 → 20 s · `test-db-template` 53 → 21 s (chạy riêng).

Vì sao chưa < 10 phút: tổng công việc (int ≈ 6 worker × 350 s; e2e ≈ 2 750 s trình duyệt/server chia 5 chỗ) vượt sức một máy 12 luồng. Chạy int song song e2e làm int 438 → 916 s và vỡ ca có ngân sách thời gian (M2-R27 < 900 ms, NOTIFY M4, HUB-FR-60 A26/A27) ⇒ **không** song song hai bước đó (`test:all` đợt nhẹ → int → e2e). Hai việc còn lại để xuống thêm: bỏ chờ thật trong ~170 ca int > 1 s (reset + đăng nhập argon2 ≈ 0,15–0,3 s mỗi ca) và giảm ca e2e kịch bản (5–15 s/ca).

## 2. Mười file int chậm nhất sau (`.data/int-timings.json`)

| # | File | Giây |
|---|---|---|
| 1 | `packages/db/src/test-db-template.int.test.ts` | 88,3 (nối tiếp lượt có tải; riêng 21) |
| 2 | `tests/acceptance/P-b/pfs4/team-fix.int.test.ts` | 51,4 |
| 3 | `tests/acceptance/H2b/run-limit.int.test.ts` | 48,5 |
| 4 | `apps/admin-api/src/lib/lock-order.int.test.ts` | 36,2 |
| 5 | `tests/acceptance/P-b2/back/race.int.test.ts` | 35,9 |
| 6 | `tests/acceptance/M3/concurrency.int.test.ts` | 33,8 |
| 7 | `tests/acceptance/H2c/command-file.int.test.ts` | 33,7 |
| 8 | `tests/acceptance/FB1/bytes.int.test.ts` | 32,6 |
| 9 | `tests/acceptance/X2b/security-rv1.int.test.ts` | 31,1 |
| 10 | `tests/acceptance/N1/migrate.int.test.ts` | 31,0 |

## 3. Chập chờn #234 (nguyên nhân gốc)
- SC-2 (P-a) và E-PB11 (P-b): `room.message` tới khi truy vấn tin/flow tải lần đầu bị `setQueryData` bỏ qua ⇒ tin vắng vĩnh viễn; `event-router` huỷ + tải lại (unit 3 ca).
- migrate-lock afterAll: DROP DATABASE ×4 ép checkpoint ⇒ bỏ DROP (DB tên cố định theo ô, tái dùng).
- Gặp thêm khi đo: P1-48e (apply bất đồng bộ), H3b A30 (NOTIFY trễ) — sửa bằng tín hiệu chờ.

## 4. Lượt `test:all` cuối (sau commit `6f7f6811`+)
check, typecheck, unit, lock xanh; int 475 s đỏ 1 ca (`test-db-template` quá 60 s do serial chạy song song ⇒ hoàn lại nối tiếp; chạy lại riêng int: 3914 pass / 0 fail, 449 s); e2e 590 pass / 2 fail: P-a SC-1 `sdlc` và chat CHAT-AC-28 (chập chờn tải, chạy lại riêng chưa đo), combine không khởi động vì mock `GITHUB_MOCK_PORT` 4040 trùng hub combine ⇒ đã đổi cổng (chat+combine+x1 chạy lại 126/126 xanh). Chưa đạt "test:all xanh trong một lượt"; python và typecheck agent-runtime BỊ CHẶN (docker). Nợ #235: ECONNRESET không xử lý sau teardown hub.
