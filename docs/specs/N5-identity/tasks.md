# Tasks · N5-identity

Làn **đầy đủ** (auth/mật khẩu/tenant) — một agent một lát (Luật 1b). Test tenant/mật khẩu viết trước code.

| # | Task | Làn | Rủi ro | Đọc | File | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|
| T1 | spec + plan + readiness 1 vòng | đầy đủ | cao | ADR-0018, intake-hd câu 11, N1 PK-FR-05 | `spec.md`, `plan.md`, `readiness.md` | — | [x] readiness vòng 1: 9 Cao có mặc định ⇒ áp (spec §7) |
| T2 | Test trước: unit luật + int (cách ly tenant, idempotent, dry-run, mật khẩu, không lộ hash) + perf 10k | đầy đủ | cao | spec §2, plan | `domain/import.rules.test.ts`, `tests/acceptance/N5/**` | `bun test …/identity-import` · `bun run test:int:par tests/acceptance/N5` | [x] 15 unit + 13 int + 3 perf |
| T3 | Domain + application + adapters + CLI [N5-FR-01…07] | đầy đủ | cao | plan | `apps/admin-api/src/modules/identity-import/**` | test T2 xanh | [x] |
| T4 | Cổng lát: typecheck, depcruise, check:fn, int N5+M1+M3+N1, perf, lock | — | — | — | `tests/.lock` | — | [x] xem "Kết quả cổng" |

## Việc cần người dùng
- Export thật từ mgmt-app theo schema `mgmt-app-users/v1` (spec N5-FR-01) — hiện chỉ có fixture giả.

## Kết quả cổng (2026-10-19)
- `tsc` admin-api + `tsconfig.tests.json` (phần N5): sạch. Turbo typecheck đỏ ở `@ai/hub-api`, `@ai/mocks` — file processes/notify của lát N2/N3 đang làm (không thuộc N5).
- depcruise: 0 vi phạm ở identity-import; 3 vi phạm sẵn có ở `hub-api` (processes/kh → repo module khác) — không thuộc N5.
- `check:fn`: 0 ở identity-import/N5 (các vi phạm còn lại thuộc hub-api notify/packs/processes).
- `test:int:par N5 M1 M3 N1`: 610 pass / 7 fail khi chạy chung (timeout do tải); chạy riêng: M3 concurrency 13/13, N1 admin-packs+api 24/24 xanh; N1 hops PK-AC12 đỏ do `hub-api/.../contracts/adapters/tax-registry.http.ts` (lát khác), không liên quan N5.
- Perf 10.000 user (lô 500): apply 2.195 ms, 6 câu/lô cố định, lô org 9 câu; chạy lại 248 ms (≤ 2 câu/lô); dry-run 263 ms.
- `test:lock:write` + `verify`: OK.

## Vòng sửa sau review + security (2026-10-19)
- Sửa M1, M2, L1–L4, Trung 1–2, Thấp 4/5/7/8/9/10 (spec §7 F1). Test: 23 unit, 17 int (2 file, mỗi describe tự seed), 3 perf.
- Perf 10.000 user: apply 1.937 ms (6 câu/lô), lô org 9 câu, chạy lại 267 ms (≤ 2 câu/lô), dry-run 143 ms.

**Đóng 2026-10-19:** [`ket-luan.md`](ket-luan.md) (gồm N5b); cổng gộp [`wave2-gate.md`](../wave2-gate.md). Sau cổng: `check:fn` đã sửa (`c85b4411`). **Điều kiện cứng trước import thật:** rate limit đăng nhập (TECH-DEBT #224).
