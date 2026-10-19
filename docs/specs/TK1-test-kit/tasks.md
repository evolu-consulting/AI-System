---
id: TK1-test-kit
---

# Tasks · TK1 test kit

Làn: **nhanh** (hạ tầng test, không đổi code sản phẩm). Riêng `defineRlsSuite` chạm RLS nhưng chỉ ĐỌC/kiểm; test do chính agent viết, reviewer đọc kỹ.

| # | Task | Làn | Trạng thái |
|---|---|---|---|
| T1 | spec/plan/tasks + luật depcruise `test-kit-no-apps` | nhanh | [x] |
| T2 | kit: env, db, stack, builders, clock, fakes, perf, rls-suite + unit (`kit.test.ts`) | nhanh | [x] |
| T3 | int kit: `rls-packs.int.test.ts` (contracts + pkdemo), `builders.int.test.ts`; perf `kit.perf.int.test.ts` | nhanh | [ ] chờ "gate done" |
| T4 | Liên kết workspace (`@ai/test-kit` trong root devDependencies, `bun install` một lần) + kiểm lefthook | nhanh | [ ] |
| T5 | Di cư test đã khoá (xem dưới) | nhanh | [ ] |
| T6 | Cổng lát | — | [ ] |

## Di cư (điền khi làm)
Quy tắc: assertion không đổi; số pass trước = sau; relock chỉ file đổi.

| Suite | File đổi | Pass trước | Pass sau | Thời gian trước -> sau |
|---|---|---|---|---|

Danh sách file đã relock (`test:lock:write`): _(điền)_

## Còn lại sau lát
_(điền)_

## Quyết định trong lúc làm
- `@ai/db/test-db` đã có template + advisory lock + GC; kit BỌC chứ không dựng lại.
- Kit không import `apps/**` (depcruise). `bootStack` nhận `createApp` do test truyền; fake transport dùng kiểu cấu trúc.
- Ca thăm dò tồn tại so sánh kết quả đọc/ghi/chèn của id có thật và id không tồn tại dưới tenant khác phải GIỐNG HỆT.
- Bảng chỉ-INSERT (`index_outbox`) khai `writeOnly`: bỏ ca đọc, vẫn kiểm chèn chéo = 42501 và FORCE RLS.
