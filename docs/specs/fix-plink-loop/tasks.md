---
id: fix-plink-loop
lát: fix-plink-loop
cr: CR-157
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Smoke bản test S7 (nhân viên «Gửi duyệt», HĐ AI đọc có 1 dòng hàng) báo hộp «Gắn sản phẩm» hiện lại sau Xác nhận.
Chẩn đoán từ log bản test (chỉ đọc), phiên 2026-11-15 11:24Z: sau khi hộp mở KHÔNG có yêu cầu nào tới nginx/hub-api (không POST `/review`,
không `…/actions/approve`, không 4xx/5xx); hai POST `/review` đều 200, thân phản hồi 99 byte (cùng trạng thái `draft`) = hai lần ghi nháp
(Lưu nháp của smoke + bước lưu trước của Gửi duyệt). S7 hết giờ đúng 120 s sau (chờ bước «Trưởng phòng duyệt»). ⇒ Hộp chưa từng được Xác nhận.
Nguyên nhân thật: vòng `toPass` của smoke dùng «nút Gửi duyệt ẩn» làm dấu xong; hộp (Radix) đặt `aria-hidden` lên nền ⇒ `getByRole` coi nút «ẩn»
ngay khi hộp mở ⇒ vòng thoát TRƯỚC khi bấm Xác nhận. Không phải lỗi quyền (không có lời gọi tạo SP nào) và không phải vòng lặp state của app.

## Làm
- `e2e/smoke-journey/smoke-journey.smoke.ts` S7: bấm Gửi duyệt một lần ⇒ chờ hộp «Gắn sản phẩm» hoặc bước «Trưởng phòng duyệt»; có hộp ⇒ Xác nhận ⇒ BẮT BUỘC hộp biến mất (lỗi nói rõ «hộp còn đó sau Xác nhận»).

## Không làm / Chạm
Không đổi code app (`ProductLinkDialog`, `use-approval-ui`, `use-confirm-save`, hub). Không chạm quyền / RLS / migration ⇒ không cần Opus soát.

## Việc còn lại
- Chạy lại smoke S7 trên bản test (điều phối). Nếu hộp còn sau Xác nhận thì mới có lỗi app thật, lúc đó có log POST để chẩn đoán.
- Rủi ro G3 (ghi nhận, chưa sửa — ngoài phạm vi): lỗi lưu (`info.err`/`ap.err`) hiện ở `SaveNotice` PHÍA SAU lớp phủ của hộp ⇒ lỗi khi Xác nhận (vd 422 `PRODUCT_INVALID`) người dùng không thấy, hộp cứ giữ nguyên (`afterConfirm` giữ hộp với lỗi lạ). Nên đưa câu lỗi vào trong hộp (`ProductLinkDialog` thêm prop `error`).

## Quyết định trong lúc làm
Không bịa lỗi app khi bằng chứng chỉ ra lỗi ở công cụ kiểm; sửa công cụ kiểm để lần sau cho ra bằng chứng thật.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Hộp «Gắn sản phẩm» lúc gửi duyệt phải được xác nhận và đóng lại
Khi nhân viên gửi duyệt HĐ có dòng hàng, hộp «Gắn sản phẩm cho các dòng hợp đồng» hiện; Xác nhận gửi lựa chọn đi cùng lệnh duyệt và hộp đóng.
- Kịch bản: khi nhân viên gửi duyệt HĐ có dòng hàng, chọn tạo sản phẩm mới và Xác nhận thì hộp đóng và HĐ sang bước «Trưởng phòng duyệt» [test: e2e/smoke-journey/smoke-journey.smoke.ts » Gửi duyệt]
