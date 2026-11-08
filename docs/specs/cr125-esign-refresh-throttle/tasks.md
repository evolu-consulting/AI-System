---
id: cr125-esign-refresh-throttle
lát: cr125-esign-refresh-throttle
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-fix-docusign-return
---
## Plan (ngắn)
Hai việc nhỏ sau review 9a11b235f: (1) không gọi API nhà cung cấp quá dày cho cùng phong bì; (2) ghép người nhận ↔ người ký chính xác theo mã người nhận.

## Làm
- `esign-throttle.ts`: cửa sổ 10 s theo phong bì (đồng hồ `d.now`); `refresh` và kiểm lượt của «Ký ngay» (`esign-turn.ts`) dùng `syncByUser` — vừa đồng bộ < 10 s ⇒ trả trạng thái DB, không gọi nhà cung cấp. Webhook/vòng nền không qua cửa sổ này. Web vốn đã ghi «Đã kiểm tra lúc …» sau mọi lần làm mới thành công ⇒ không đổi.
- `mergeSigners`: ghép theo `recipientId` (= vị trí + 1 lúc gửi), rồi `routingOrder` + email, rồi email theo vị trí; adapter DocuSign trả thêm `recipientId`, `routingOrder`.

## Không làm / Chạm
Không migration, không web, không DLC.

## Test tối thiểu
Unit `esign-throttle.test.ts` (đồng hồ giả), `esign-merge.test.ts`; int `esign-multi.int.test.ts` (evotest -Dirty).

## Quyết định trong lúc làm
- Mốc đồng bộ giữ trong bộ nhớ tiến trình (không cột DB): nhiều instance chỉ giảm tải, không ảnh hưởng đúng đắn.
- Int không có seam đồng hồ ⇒ kiểm hành vi trong cửa sổ (lần bấm thứ hai trả DB); ranh giới 10 s kiểm ở unit.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Làm mới trạng thái ký không gọi nhà cung cấp quá dày
Làm mới trạng thái ký (và kiểm lượt khi «Ký ngay») chỉ hỏi nhà cung cấp nếu phong bì chưa được đồng bộ trong 10 giây gần nhất; trong cửa sổ đó trả trạng thái hiện có, vẫn thành công.
- Kịch bản: khi bấm làm mới lần hai trong 10 giây thì trả trạng thái hiện có không gọi nhà cung cấp [test: tests/acceptance/esign-multi/esign-multi.int.test.ts » giám đốc ký xong ở nhà cung cấp (webhook không tới) ⇒ refresh ghi signed_at và hết lượt, bấm lại trong 10 s không gọi nhà cung cấp (giữ hạn mức API)]
- Kịch bản: khi đủ 10 giây thì cho gọi lại [test: apps/hub-api/src/modules/packs/contracts/application/esign-throttle.test.ts » vừa đồng bộ < 10 s ⇒ bỏ qua, đủ 10 s ⇒ cho gọi lại, phong bì khác không ảnh hưởng]

#### Yêu cầu: Ghép người ký theo mã người nhận
Trạng thái người ký từ nhà cung cấp được ghép theo mã người nhận (rồi thứ tự gửi + email, rồi vị trí) nên danh sách trả về khác thứ tự hoặc trùng email vẫn đúng người.
- Kịch bản: khi nhà cung cấp trả người nhận khác thứ tự thì ghép theo mã người nhận [test: apps/hub-api/src/modules/packs/contracts/application/esign-merge.test.ts » nhà cung cấp trả người nhận KHÁC thứ tự ⇒ ghép theo recipientId (= vị trí + 1), kể cả trùng email]

## Việc còn lại
