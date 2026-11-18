---
id: cr182-fan
lát: cr182-fan
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: s11b, s12
---
## Plan (ngắn)
Màn ký thêm «Kiểu xem khi ký»: Từng trang (có «Liền mép») và Xoè quạt (Mép phải | Mép dưới, nhóm 5 trang). Hình học thuần ở `lib/fan.ts` + `partsOf` cắt theo phần lộ. Mỗi chữ ký nhớ kiểu xem đã đặt nó. API Lưu không đổi.

## Làm
- [x] `lib/fan.ts` (dải lộ 40px, nhóm 5 trang, `viewKey`, `editableIn`), `geometry.ts` (`StagePage.visible`; `partsOf` cắt theo phần lộ), `layout.ts` (tham số khe), `sign-items.ts` (`view`, `relayoutItems`)
- [x] `components/ViewBar.tsx` (trong `SignTopBar`, chỉ chế độ ký, ẩn ≤ 640px), `LockedMark.tsx` (chữ ký khác kiểu xem: hiện từng lát, không kéo), `PageStage`/`StageItems`/`SignWorkspace` nối kiểu xem
- [x] i18n `contracts.docsign.view.*` (vi + en); test `lib/fan.test.ts`, `components/view-bar.test.tsx`; e2e `e2e/cr181/fan-seam-sign.spec.ts` (chưa chạy)

## Không làm / Chạm
Không: đổi contract/API, kiểu xem Hàng ngang, in hai mặt. Chạm `BoxFrame` (z-10 để nổi trên trang xếp chồng), `PageStage` (prop `view`, mặc định Từng trang nên `SignedViewer` không đổi).

## Test tối thiểu
`bun test apps/workspace-web/src/features/doc-sign` xanh; tsc workspace-web; biome; `check:ui-kit`; `i18n:check`.

## Quyết định trong lúc làm
- Thanh «Kiểu xem» chỉ ở chế độ ký (chế độ chuẩn bị chỗ ký vẫn một kiểu: Từng trang) — ô chỗ ký chỉ ở Từng trang như bản mẫu.
- Xoè quạt: ô chỗ ký ẩn; chữ ký của kiểu xem khác vẽ lại đúng các lát đã cắt, chỉ phần đang lộ.
- Đổi «Liền mép» ⇒ tính lại phần cắt của chữ ký đã đặt ở Từng trang (khe đổi thì lát giáp lai đổi). «Liền mép» không đổi khoá kiểu xem.
- Điện thoại ≤ 640px: cụm nút ẩn (`max-sm:hidden`) và ép về Từng trang.
- Nút ‹ › dùng ký tự chữ (bảng icon chung chưa có mũi tên chuyển nhóm).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Kiểu xem khi ký — Từng trang và Xoè quạt
Màn ký có hai kiểu xem. Từng trang: có công tắc «Liền mép» (bỏ khe giữa các trang, kéo qua mép vẫn hít khe). Xoè quạt: xấp tối đa 5 trang, mỗi trang dưới lộ một dải 40px ở Mép phải hoặc Mép dưới, nút ‹ Trang 1–5 › sang nhóm kế. Điện thoại (≤ 640px) chỉ có Từng trang. Lưu vẫn chỉ gửi parts như cũ.
- Kịch bản: khi chọn Từng trang thì có «Liền mép» và khi chọn Xoè quạt thì có Mép phải, Mép dưới và nút nhóm trang [test: apps/workspace-web/src/features/doc-sign/components/view-bar.test.tsx » Xoè quạt: Mép phải | Mép dưới và ‹ Trang 1–5 ›, không còn «Liền mép»]
- Kịch bản: khi ở điện thoại thì cụm nút kiểu xem bị ẩn [test: apps/workspace-web/src/features/doc-sign/components/view-bar.test.tsx » Từng trang: có «Liền mép», không có Mép phải hay Mép dưới, cụm ẩn ở điện thoại]
- Kịch bản: khi bật Liền mép thì khe giữa các trang bằng 0 [test: apps/workspace-web/src/features/doc-sign/lib/fan.test.ts » «Liền mép» bỏ khe giữa các trang, «Từng trang» vẫn có khe 16px]

#### Yêu cầu: Giáp lai xoè quạt cắt theo phần đang lộ
Mỗi trang dưới chỉ lộ một dải 40px; chữ ký cắt theo phần lộ, toạ độ vẫn quy về điểm PDF của trang đầy đủ; một chữ ký đè lên các dải giáp lai cả nhóm, tối đa 5 trang (BR-L4).
- Kịch bản: khi chữ ký đè lên dải của 4 trang dưới thì có 5 phần, mỗi phần cắt theo dải [test: apps/workspace-web/src/features/doc-sign/lib/fan.test.ts » chữ ký đè lên dải của 4 trang dưới + trang đầu ⇒ giáp lai 5 phần, mỗi phần cắt theo dải]
- Kịch bản: khi chữ ký chỉ nằm ở vùng bị trang đầu che thì không có phần của trang dưới [test: apps/workspace-web/src/features/doc-sign/lib/fan.test.ts » vùng bị trang đầu che (không phải dải lộ) không tạo phần của trang dưới]
- Kịch bản: khi xoè mép dưới thì chữ ký đè các dải đáy cũng giáp lai nhiều trang [test: apps/workspace-web/src/features/doc-sign/lib/fan.test.ts » mép dưới: đè lên các dải đáy ⇒ giáp lai nhiều trang]
- Kịch bản: khi ký giáp lai xoè quạt mép phải trên 5 trang rồi Lưu thì bản ký có 5 phần [test: e2e/cr181/fan-seam-sign.spec.ts » giám đốc: Xoè quạt mép phải, chữ ký đè 5 trang ⇒ Lưu ⇒ POST /sign có 1 giáp lai 5 phần]

#### Yêu cầu: Chữ ký thuộc kiểu xem đã đặt nó
Sang kiểu xem khác thì chữ ký vẫn hiện trên trang nhưng không kéo được, để giáp lai không bị cắt sai.
- Kịch bản: khi chữ ký đặt ở kiểu xem này thì kéo được [test: apps/workspace-web/src/features/doc-sign/components/view-bar.test.tsx » đặt ở kiểu xem này ⇒ khung kéo được]
- Kịch bản: khi chữ ký đặt ở kiểu xem khác thì vẫn hiện nhưng không kéo được [test: apps/workspace-web/src/features/doc-sign/components/view-bar.test.tsx » đặt ở kiểu xem khác (Từng trang) ⇒ vẫn hiện theo từng lát nhưng không có khung kéo]
- Kịch bản: khi chỉ đổi Liền mép thì phần cắt của chữ ký Từng trang được tính lại, chữ ký kiểu xem khác giữ nguyên [test: apps/workspace-web/src/features/doc-sign/lib/fan.test.ts » đổi «Liền mép»: tính lại phần cắt của chữ ký «page», chữ ký kiểu xem khác giữ nguyên]

## Việc còn lại
- Chạy e2e `fan-seam-sign` cuối đợt (chưa chạy). Soát UI người dùng thật: xem trực quan xoè quạt (cả hai mép) và «Liền mép».
