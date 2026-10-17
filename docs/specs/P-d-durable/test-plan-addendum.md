# Test plan · P-d · phụ lục bổ sung (readiness lần 2 · qc) — của [test-plan.md](test-plan.md) §6

`test-plan.md` sát trần 30 720 B nên phần thêm nằm ở đây.

## 1. Test khoá phải SỬA — K30
| # | File:dòng | Lý do | Sửa thành | Khi |
|---|---|---|---|---|
| K30 | `P-a/step0/rules/run-access.test.ts` | T8s dời `core/run-access.rules.ts` ⇒ `domain/runs/run-access.rules.ts` (plan-domain §7); file mới import contract ⇒ khai lại hằng trong domain (ADR-0023, CA-R03) | nạp bằng `loadDomain("runs/run-access.rules.ts")` (hoặc `loadAnyOf` nếu T8s/T8q lệch pha); ca cũ giữ nguyên ý định và dữ liệu; hằng khai lại được đối chiếu hằng contract ở `rules/domain-contract.test.ts` (PD-C10) | T8q (cùng task dời, relock) |
Kiểm ở bước 8 của test-plan §8: `bun test tests/acceptance/P-a/step0/rules/run-access.test.ts` xanh trước và sau T8s; `bun run test:lock:verify` sau relock. spec-ac §2 trỏ test-plan §6 (K01–K30).

## 2. Ca thêm ở phụ lục khác
- `teamResumePlan`: PD-U93…U97 trong [test-plan-rules](test-plan-rules.md) (đã đếm vào test-plan §9).
- PD-I47 (`ESCALATE_INVALID` 422 chỉ khi trùng Group duyệt / `escalate` ở stage `auto`; `after_h` sai ⇒ 400): [test-plan-int](test-plan-int.md).
- e2e: [test-plan-e2e](test-plan-e2e.md) viết lại theo `plan-frontend.md` §7, `plan-frontend-d2.md` §13, `plan-frontend-i18n.md`.