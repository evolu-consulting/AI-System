---
slice: fix-extract-save
lane: nhanh (không migration; không đổi quyền/RLS)
---
# fix-extract-save · AI đọc xong nhưng lưu lỗi (contracts_deal_ck)

Staging 2026-11-15: HĐ «Hợp đồng nhượng quyền» 28 trang, AI đọc được nhưng lưu lỗi `contracts_deal_ck` ⇒ `extract_failed SAVE_FAILED`, người dùng thấy câu «AI chưa trích được thông tin» (sai lý do).
Nguyên nhân: `saveResult` điền `deal` = loại AI đoán nhưng `direction` chỉ suy được cho Mua/Bán/Giới thiệu; Nhượng quyền / Hợp tác ⇒ `direction` rỗng ⇒ vi phạm CHECK. Hướng/loại chứng từ đã có sẵn trên HĐ cũng có thể trái loại AI đoán.

## Làm trong lát
- Một luật thuần `domain/deal-direction.rules.ts`: `dealCheckOk` (phản chiếu CHECK) + `aiDealWrite(cur, ai)` — chỉ lấp ô còn trống; hướng thiếu ⇒ suy từ loại
  (Mua ⇒ purchase; Nhượng quyền theo vai `kind_terms.role`; còn lại sale); tổ hợp không hợp lệ (kể cả loại chứng từ khác `contract` với Nhượng quyền/Hợp tác) ⇒ bỏ `deal`, giữ hướng. Không bao giờ làm hỏng lượt trích.
- `run-extraction.usecase.ts`: tính `dealWrite` trong `save`, chuyển cho `saveResult`; repo ghi `coalesce(cột, giá trị luật)` (bỏ `case` SQL cũ — một nguồn). `source()` đọc thêm `deal/direction/doc_type`.
- `catch` quanh verify/save ghi `contract-extract-save-failed` (chỉ `error_name`/`error`, không nội dung HĐ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Lý do không đọc được hợp đồng
Khối "Không đọc được hợp đồng này" nêu lý do nghiệp vụ (tệp hỏng / quá lớn / định dạng chưa hỗ trợ / hết lượt AI) kèm gợi ý "Nhập tay". Lượt đọc lỗi do loại hợp đồng AI đoán không khớp hướng/loại chứng từ KHÔNG còn xảy ra: lượt vẫn sang "chờ kiểm", ô Loại hợp đồng để trống cho người dùng chọn; hướng tiền thiếu thì suy từ loại (Nhượng quyền theo vai nhận/nhượng). Lỗi ghi kết quả thật vẫn báo `SAVE_FAILED` và được ghi log một lần.
- Kịch bản: khi lượt đọc lỗi PDF_TOO_LARGE thì trang rà soát nói tệp quá lớn và gợi ý Nhập tay [test: thủ công — chỉ đổi câu chữ hiển thị theo mã lỗi (ReviewParts.tsx FAIL_REASON)]
- Kịch bản: khi AI đoán Nhượng quyền mà hợp đồng chưa có hướng thì lưu được, loại Nhượng quyền và hướng suy theo vai [test: apps/hub-api/src/modules/packs/contracts/domain/deal-direction.rules.test.ts » Nhượng quyền (HĐ 28 trang trên staging)]
- Kịch bản: khi AI đoán Hợp tác mà hướng đã là mua thì lượt đọc vẫn sang chờ kiểm và loại hợp đồng để trống [test: apps/hub-api/src/modules/packs/contracts/application/extraction-deal-check.test.ts » Hợp tác mà hướng đã là purchase]
- Kịch bản: khi lưu kết quả đọc hỏng thật thì lượt đọc lỗi SAVE_FAILED và ghi log một lần [test: apps/hub-api/src/modules/packs/contracts/application/extraction-deal-check.test.ts » ghi hỏng thật]
- Kịch bản: khi lưu vào Postgres thật thì Nhượng quyền được lưu hợp lệ, tổ hợp sai bị bỏ loại [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-writes.int.test.ts » fix-extract-save]

## Quyết định trong lúc làm
- Tổ hợp sai ⇒ bỏ `deal` (không đổi `direction` do người dùng/nguồn đã đặt); người dùng chọn lại ở màn kiểm.
- `ai_read.deal` vẫn giữ nguyên lời AI đoán (gợi ý hiển thị), chỉ cột `deal` thật bị bỏ.
- Việc cổng đọc `source()` thêm 3 cột: cùng một câu SQL, không thêm truy vấn.
