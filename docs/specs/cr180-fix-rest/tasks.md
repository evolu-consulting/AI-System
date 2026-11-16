---
id: cr180-fix-rest
lát: cr180-fix-rest
cr: CR-180
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa nốt vi phạm 4 luật mobile (R2 vùng bấm 44px, R3 chữ ≥ 12px, R4 nút trợ lý không che) ở tầng chung trước, rồi các màn còn lại; đưa 3 ca e2e hồi quy về xanh.

## Làm
- [x] Thanh đầu trang: nhận diện công ty (`Header.tsx`), «Ứng dụng» (`web-kit AppSwitcher`), chuông (`NotificationBell`) ⇒ 44px ở ≤ 640px; badge chuông 11px.
- [x] `DateInput` (ô lịch, nút tháng, ngày, Hôm nay/Xoá), `AttachDropzone` «Chọn tệp», ô chọn loại HĐ (`DealTiles`), `.field/.btn/.btn-sm/.chip/.btn-icon-ghost` (`globals.css`) ⇒ 44px.
- [x] Tổng quan (dòng việc, link HĐ/đối tác), Sản phẩm (link tên), Tin nhắn (ô tìm, tab lọc, nút thoát tìm), huy hiệu điểm (chữ ≥ 12px).
- [x] CSS Community: `styles/mobile.css` (44px) + chữ 10.5–11.5px ⇒ 12px.
- [x] `Pager`: điện thoại chừa lề phải 4.5rem, hàng nút số cho xuống dòng ⇒ «›» không nằm dưới nút trợ lý.
- [x] Hồi quy: `cr147b-people` P3 (lối vào trang công ty), `khung-tep-co-dinh` (chờ hoạt ảnh mở hộp).

## Không làm / Chạm
Không chụp lại ảnh «khớp baseline» (điều phối làm). Không đổi `mobile-rules.ts` (không thêm ngoại lệ).

## Test tối thiểu
e2e `contracts-web`, `community-web`, `community-web-stack`, `cr127` (chạy trên evotest); unit `bun test apps/workspace-web packages/web-kit`.

## Quyết định trong lúc làm
- Link trong bảng/danh sách mở rộng vùng bấm bằng `max-sm:-my-3 max-sm:py-3` (giữ bố cục) thay vì thêm `tap-target` (inline-flex làm hỏng `truncate`).
- P3 hồi quy do CR-179 bỏ link «Xem trang công ty»: lối vào nay là hàng công ty `me-company-row` ⇒ sửa test, không thêm lại link.
- `khung-tep-co-dinh`: lỗi ở test (đo trúng khung đầu của hoạt ảnh phóng 0.95), không phải ở code.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED web/web-hop-nhat.md
#### Yêu cầu: Mobile 4 luật (vùng bấm 44px, chữ ≥ 12px, nút trợ lý không che, không tràn ngang)
Ở ≤ 640px mọi nút/link/ô trên thanh đầu trang, ô ngày, ô chọn loại HĐ, tab Tin nhắn và CSS Community cao ≥ 44px; chữ ≥ 12px (số trong badge tròn ≥ 11px); hàng phân trang chừa lề phải cho nút trợ lý nổi.
- Kịch bản: khi mở các màn Sổ Hợp Tác ở 390px thì không có vi phạm vùng bấm/chữ/che [test: e2e/contracts-web/mobile-rules.cw.ts]
- Kịch bản: khi mở Bảng tin, Hồ sơ, Yêu cầu tham gia ở 390px thì không có vi phạm [test: e2e/community-web/mobile-rules.cm.ts]
- Kịch bản: khi danh sách HĐ ở 390px kéo tới cuối thì «Trang sau» không bị nút nổi đè [test: e2e/contracts-web/cr177-w4-fab-safe.cw.ts » phân trang cuối không bị nút nổi đè]
- Kịch bản: khi chủ sở hữu vào trang công ty từ hồ sơ thì đổi được ảnh bìa [test: e2e/community-web/cr147b-people.cs.ts » chủ sở hữu đổi ảnh bìa công ty ngay ở trang công ty]
- Kịch bản: khi mở xem trước tệp thì hộp không đổi cỡ lúc tải xong [test: e2e/cr179/khung-tep-co-dinh.spec.ts » hộp nền đen giữ nguyên kích thước trước và sau khi tải xong]

## Việc còn lại
Điều phối chụp lại ảnh «khớp baseline» (scenes, hd78, scenes-mobile).
