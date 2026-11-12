# fix-uat-community — lỗi UAT sau CR-129 media

## Nguyên nhân
- Hộp phóng to vỡ: Dialog render qua portal ngoài scope, nên bọc `data-mod="community"` trên CHÍNH `.imgviewer` làm mọi selector `[data-mod="community"] .imgviewer …` không khớp (cần phần tử cha). Sửa: bọc ngoài `data-mod`, `.imgviewer` bên trong; thêm `gap` thanh dưới.
- «320.0000 cuộn»: nằm ở gợi ý chủ quản «đang có {n}» (`hintLines`, `onHand` là numeric DB dạng chuỗi), không phải trường `qty`. Sửa ở `hintLines`; thêm `formatQty` cho `qty` (số đầu có đúng 4 số lẻ ⇒ thập phân theo locale).

## Việc
- [x] ImageViewer + CSS · `formatQty` (factRows, dealStrip) · `hintLines` onHand · unit

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)

### MODIFIED community/hien-thi.md
#### Yêu cầu: Số lượng và tồn kho hiển thị theo locale, bỏ số 0 thừa
Số lượng tồn từ DB (vd "320.0000") hiện «320», «1.250,5» theo locale vi; chuỗi người dùng gõ giữ nguyên.
- Kịch bản: khi tồn là "320.0000" thì gợi ý chủ quản hiện «đang có 320 cuộn» [test: apps/workspace-web/src/modules/community/domain/quote.test.ts » gợi ý: Cần mua có hàng]
- Kịch bản: khi số lượng là "1250.5000 kg" thì hiện «1.250,5 kg», còn "1.250 kg" giữ nguyên [test: apps/workspace-web/src/modules/community/domain/format.test.ts » formatQty]
