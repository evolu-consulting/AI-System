---
id: cr121-r7-gapb-isolation
lát: cr121-r7-gapb-isolation
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
`gap-b-list.cw.ts` "Gap #10 · lọc ngày" đỏ chập chờn (`date_field` = end_date thay vì action_deadline). Tìm nguồn trạng thái dùng chung.

## Làm
Không có trạng thái dùng chung: lọc ngày chỉ nằm trên URL (`dfield/due/df/dt`), không lưu localStorage/prefs/server theo người dùng; mỗi ca có context trình duyệt mới. Nguyên nhân là ĐUA trong ca: `DateFilterControl` ghi `{...value, field}` rồi ô cửa sổ ghi `{field: value.field, due}` theo `value` của lần vẽ trước; nếu chọn "Quá hạn" trước khi URL nhận `dfield` (máy tải nặng) thì `dfield` bị ghi đè về mặc định. Sửa test: sau khi chọn cột, chờ URL có `dfield=action_deadline` rồi mới chọn cửa sổ (không nới assert).

## Không làm / Chạm
Chỉ `e2e/contracts-web/gap-b-list.cw.ts`. Không đổi sản phẩm.

## Test tối thiểu
evotest contracts-web, ca Gap #10: lượt 1 mã cũ idle ×30 = 30 xanh (không tái hiện được khi máy rảnh); lượt 2 mã sửa ×40 với 6 worker song song = 40 xanh.

## Quyết định trong lúc làm
- Sản phẩm không lưu "mốc ngày" theo người dùng (không vi phạm Luật GỐC 3 về trạng thái ẩn). Điểm yếu nhỏ của sản phẩm: hai ô ghi đè nhau theo `value` đã vẽ khi thao tác cực nhanh; có thể gộp theo `prev` của URL ở `setDate` nếu muốn bền hơn (chưa làm, ngoài phạm vi).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đồng bộ hoá bước chờ của một ca e2e; sản phẩm không đổi)

## Việc còn lại
- (tuỳ chọn) `ContractsListPage.setDate`: gộp theo search hiện hành thay vì theo `value` đã vẽ.