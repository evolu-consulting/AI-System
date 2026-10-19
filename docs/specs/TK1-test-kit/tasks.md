---
id: TK1-test-kit
---

# Tasks · TK1 test kit

Làn: **nhanh** (hạ tầng test, không đổi code sản phẩm). Riêng `defineRlsSuite` chạm RLS nhưng chỉ ĐỌC/kiểm; test do chính agent viết, reviewer đọc kỹ.

| # | Task | Làn | Trạng thái |
|---|---|---|---|
| T1 | spec/plan/tasks + luật depcruise `test-kit-no-apps` | nhanh | [x] |
| T2 | kit: env, db, stack, builders, clock, fakes, perf, rls-suite + unit (`kit.test.ts`) | nhanh | [x] |
| T3 | int kit: `rls-packs.int.test.ts` (contracts + pkdemo), `builders.int.test.ts`; perf `kit.perf.int.test.ts` | nhanh | [x] |
| T4 | Liên kết workspace (`@ai/test-kit` trong root devDependencies, `bun install` một lần) + kiểm lefthook | nhanh | [x] |
| T5 | Di cư test đã khoá (xem dưới) | nhanh | [x] một phần |
| T6 | Cổng lát | — | [ ] |

## Di cư (điền khi làm)
Quy tắc: assertion không đổi; số pass trước = sau; relock chỉ file đổi.

| Suite | File đổi | Pass trước | Pass sau | Thời gian (par, 1 dir) trước -> sau |
|---|---|---|---|---|
| N1 | `N1/_support/n1.ts` (inPack, pgCode, percentile -> kit) | 101 | 101 | 13,5 s -> 13,2 s |
| N2 | (qua n1.ts) | 27 | 27 | 6,4 s -> 6,6 s |
| N3 | `N3/_support/n3.ts` (inPack, inHub, pgCode -> kit) | 46 | 46 | 5,7 s -> 5,8 s |
| HD1 | `HD1/_support/hd1.ts` (literalize, seqScansIn -> kit) | 158 | 158 | 9,5 s -> 9,9 s |
| HD2 | (qua hd1.ts) | 18 | 18 | 4,5 s -> 4,5 s |

Không có lợi thế thời gian: các helper được gộp là hàm nhỏ, không phải đường nóng. Lợi ích là bỏ 109 dòng chép lại và một nguồn duy nhất.
Assertion không đổi: chỉ thay phần cài đặt helper bằng import/re-export cùng chữ ký trong 3 file `_support`; không file `*.int.test.ts` nào bị sửa.

Danh sách file đã relock (`test:lock:write`, chỉ 3 dòng đổi trong `tests/.lock`):
- tests/acceptance/N1/_support/n1.ts
- tests/acceptance/N3/_support/n3.ts
- tests/acceptance/HD1/_support/hd1.ts
## Còn lại sau lát
- `_fixtures` H1/M1–M4 là chuỗi bọc nhau (M3 bọc M2 bọc M1), `_stack` H1–H3a bọc nhau, `_local` P-a/P-b là kịch bản riêng từng lát: không phải chép lại thuần, di cư cần đổi cấu trúc (rủi ro/đổi assertion gián tiếp) nên chưa làm. `makeClock` M1 (đối tượng thường, `set/advance` có thể bị tách khỏi đối tượng) chưa đổi sang `FakeClock`.
- `pct` cục bộ trong 4 perf test (N3 dispatch, P-d background/remind/d2): cần chạy lại perf để đối chiếu, chưa làm.
- `X2a/_x2a.ts pgCode`, `H1/isolation.int.test.ts pgCode` (dạng nhận Promise): chữ ký khác, giữ.
- `captureSql` HD1 (tap pool Hub) giữ ở HD1 vì gắn `hubActivity`; bản kit nhận client postgres.js.
- Lỗi typecheck có sẵn (không do TK1): 5 lỗi TS2769 ở N2 `pack-outcome`/`pack-tool`/`reject` (`expect(RowList).toEqual([])`).

## Quyết định trong lúc làm
- `@ai/db/test-db` đã có template + advisory lock + GC; kit BỌC chứ không dựng lại.
- Kit không import `apps/**` (depcruise). `bootStack` nhận `createApp` do test truyền; fake transport dùng kiểu cấu trúc.
- Ca thăm dò tồn tại so sánh kết quả đọc/ghi/chèn của id có thật và id không tồn tại dưới tenant khác phải GIỐNG HỆT.
- Bảng chỉ-INSERT (`index_outbox`) khai `writeOnly`: bỏ ca đọc, vẫn kiểm chèn chéo = 42501 và FORCE RLS.
