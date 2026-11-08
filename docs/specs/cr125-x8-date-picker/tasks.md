---
id: cr125-x8-date-picker
lát: cr125-x8-date-picker
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Ô ngày gốc của trình duyệt (`<input type="date">`) hiện mm/dd/yyyy theo máy Mỹ (09/30/2031). Thay bằng MỘT bộ chọn ngày tiếng Việt dùng chung: dd/mm/yyyy, thứ Hai đầu tuần, tháng tiếng Việt.

## Làm
- `components/shared/date-picker/`: `date-math.ts` (thuần: lưới tháng thứ Hai đầu tuần, tên tháng, đọc dd/mm/yyyy · d/m/yyyy · ISO, min/max, hôm nay giờ VN) + `DateInput.tsx` (gõ hoặc chọn; hiển thị bằng `viDate` — MỘT bộ định dạng; giá trị vào/ra vẫn ISO; `onChange` nhận `{target:{value}}` như ô gốc).
- Thay mọi `<input type="date">` của app Sổ Hợp Tác (mốc, hạn, sổ nợ, kho, giá NCC, lọc danh sách, bước Form, Community) + ô ngày của form hợp đồng (`FieldsGrid`).

## Không làm / Chạm
Không canvas/esign/partner; không API.

## Test tối thiểu
unit `date-math.test.ts` (10 ca); journey e2e G2 (ô ngày hợp đồng hiện dd/mm/yyyy, mở lịch) một lần + ảnh.

## Quyết định trong lúc làm
- Ô vẫn gõ được ISO (`2027-01-01`) để e2e/dán dữ liệu cũ không vỡ; sai ngày (31/04, 09/30) bị bỏ qua và ô trả về giá trị cũ khi rời ô.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Danh sách hợp đồng
Mọi ô ngày của app Sổ Hợp Tác dùng một bộ chọn ngày tiếng Việt: hiện dd/mm/yyyy qua bộ định dạng chung, tuần bắt đầu thứ Hai, tên tháng tiếng Việt.
- Kịch bản: khi nhập hoặc đọc ngày thì dd/mm/yyyy (kể cả d/m và ISO) đúng, ngày kiểu mm/dd không có thật bị từ chối [test: apps/workspace-web/src/components/shared/date-picker/date-math.test.ts » dd/mm/yyyy (kể cả d/m, dấu - hoặc .) và ISO ⇒ ISO]
- Kịch bản: khi mở lịch tháng 9/2027 thì hàng đầu bắt đầu thứ Hai 30/08 [test: apps/workspace-web/src/components/shared/date-picker/date-math.test.ts » tháng 9/2027 (1/9 là thứ Tư): hàng đầu bắt đầu 30/08 (T2) và có ô thứ Tư = 1]
- Kịch bản: khi nhân viên mở form hợp đồng thì ô ngày hiện dd/mm/yyyy và lịch có tháng tiếng Việt, thứ Hai đầu tuần [test: e2e/journey-approval/cr122-flows.spec.ts » G2 · tenant_admin: Sao chép → 3 lỗi 409 → sửa người duyệt → Xuất bản (gốc tự Tắt) → HĐ B theo bản công ty, HĐ A giữ bản cũ → Quay về bản gốc]

## Việc còn lại