# Tasks · N5b-legacy-hash

Làn **đầy đủ** (đường đăng nhập) — một agent một lát (Luật 1b). Test viết trước code.

| # | Task | Làn | Rủi ro | File | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|
| T1 | spec + plan + readiness 1 vòng | đầy đủ | cao | `spec.md`, `plan.md`, `readiness.md` | — | [x] |
| T2 | Test trước: unit rules/verify/timing [N5B-FR-02, N5B-FR-04, N5B-NFR-01], importer [N5B-FR-01], int login [N5B-FR-02..05, N5B-NFR-02] | đầy đủ | cao | `auth.legacy*.test.ts`, `auth.legacy.int.test.ts`, `import.rules.test.ts` | `bun test apps/admin-api/src/modules/auth apps/admin-api/src/modules/identity-import` | [x] |
| T3 | Luật + verify + repo + service + config | đầy đủ | cao | `auth.legacy.rules.ts`, `auth.legacy.ts`, `auth.repo.ts`, `auth.service.ts`, `config/env.ts`, `app.ts`, `server.ts` | T2 xanh | [x] |
| T4 | Importer: `importableHash` | đầy đủ | cao | `identity-import/domain/import.rules.ts` | T2 xanh | [x] |
| T5 | Cổng lát | — | — | — | unit, int, perf, M1/N5 auth, check:fn, typecheck, depcruise, test:lock | [x] |

## Kết quả cổng (2026-10-19)
- Unit admin-api: 200 pass / 0 fail (gồm 7 rules + 10 verify/timing + 3 importer + 1 env mới).
- Int `test:int:par apps/admin-api tests/acceptance/M1 N5 M4` (60 file): 513 pass / 1 fail — `M4/import-apply` C-A09 (song song cấu hình, không thuộc auth) chập chờn khi tải; chạy riêng 15/15 xanh. `auth.legacy.int.test.ts` 9/9.
- Perf p95 login (`auth.legacy.perf.int.test.ts`, 20 lần): trước (= M1, chỉ argon2) 46,6 ms → sau (argon2 ‖ scrypt giả) 50,2 ms; legacy lần đầu (verify + rehash + audit) 48,4 ms. Lần đo khác khi máy tải: 50,9 → 73,5 / 48,0 ms. `users.perf` (ADM-NFR-03, 5.000 user) xanh < 150 ms.
- tsc admin-api sạch; depcruise: 0 vi phạm mới (3 sẵn có ở hub-api); check:fn: 0 vi phạm mới; `test:lock:verify` OK (không thêm file khoá — test mới nằm trong `apps/`).
- Không đổi test khoá: fixture `SCRYPT_HASH` của N5 sai độ dài dk (24 byte) ⇒ vẫn `reset`, test N5 giữ nguyên.