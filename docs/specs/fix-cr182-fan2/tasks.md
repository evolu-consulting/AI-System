---
id: fix-cr182-fan2
lát: fix-cr182-fan2
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: cr182-fan
---
## Plan (ngắn)
Soát UI lượt 5: «kéo chữ ký vào trang ở Xoè quạt thì màn về Từng trang». Tìm nguyên nhân gốc, test ở tầng hàm thuần trước, rồi sửa.

## Làm
- [x] Nguyên nhân: KHÔNG phải thả chữ ký. Mọi chỗ gọi `setView` đã liệt kê: chọn ở `ViewBar`, `PageRail`, `FileTabs` (đổi tệp), và hiệu ứng điện thoại ≤ 640px. Đường thả (kéo từ khay, chuột phải, chạm giữ) cùng vào `place` ⇒ `store.add`, không đụng kiểu xem. Bằng chứng ảnh 409: chữ ký là khung «Trang 1» kéo được ⇒ lúc thả `viewKey` đã là «page» (nếu thả ở Xoè quạt thì nó mang «fan-right-0» và sang Từng trang sẽ chỉ là lát khoá). Bộ ảnh chụp từng bước ở 1440 rồi 390: đổi cỡ cửa sổ xuống 390 làm hiệu ứng điện thoại GHI ĐÈ kiểu xem đã chọn thành «Từng trang», rộng lại không trở về.
- [x] Sửa: `effectiveView(chosen, phone)` (`lib/fan.ts`); `SignWorkspace` giữ kiểu người dùng chọn, điện thoại chỉ đổi kiểu hiệu lực ⇒ đổi cỡ cửa sổ rồi rộng lại vẫn là Xoè quạt (cùng mép, cùng nhóm).
- [x] Test (đỏ trước): `lib/fan.test.ts` — hiệu lực theo điện thoại; thả vào Xoè quạt mép dưới mang khoá `fan-bottom-0` và sửa được.

## Không làm / Chạm
Không đổi nhãn, API, hình học xoè quạt. Chạm `SignWorkspace` (state `chosen` + `phone`).

## Test tối thiểu
`bun test apps/workspace-web/src/features/doc-sign`; tsc; biome; `check:ui-kit`; `openspec:check`.

## Quyết định trong lúc làm
- Thả ở Xoè quạt qua chuột phải / chạm giữ dùng chung `place` với kéo-thả ⇒ không cần nhánh riêng; test `placeItem` bao cả ba.
- Không có môi trường DOM trong repo để test kéo thả thật; e2e `fan-seam-sign` (đã viết ở lát trước) kéo thả ở 1440 là kiểm chứng thật, chưa chạy.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Kiểu xem đã chọn không mất khi đổi cỡ cửa sổ
Điện thoại (≤ 640px) chỉ có Từng trang; rộng lại thì trở về kiểu xem người dùng đã chọn (Xoè quạt, cùng mép và nhóm trang).
- Kịch bản: khi cửa sổ hẹp rồi rộng lại thì Xoè quạt đã chọn được giữ nguyên [test: apps/workspace-web/src/features/doc-sign/lib/fan.test.ts » hẹp ≤ 640px ⇒ hiệu lực là «Từng trang», rộng lại ⇒ trở về Xoè quạt đã chọn, không mất mép/nhóm]
- Kịch bản: khi thả chữ ký vào Xoè quạt thì chữ ký mang đúng kiểu xem và sửa được [test: apps/workspace-web/src/features/doc-sign/lib/fan.test.ts » thả vào Xoè quạt: chữ ký mang đúng khoá kiểu xem, sửa được, 1 phần trên trang đầu]
