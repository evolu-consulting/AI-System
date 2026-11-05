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
Chỉ `e2e/contracts-web/gap-b-list.cw.ts`. Sản phẩm: date-filter.ts, DateFilterControl.tsx, ContractsListPage.tsx.

## Test tối thiểu
evotest contracts-web, ca Gap #10: lượt 1 mã cũ idle ×30 = 30 xanh (không tái hiện được khi máy rảnh); lượt 2 mã sửa ×40 với 6 worker song song = 40 xanh.

## Quyết định trong lúc làm
- Cuộc đua là lỗi sản phẩm (mất lựa chọn đầu khi thao tác nhanh): đã sửa bằng `applyDateAction` (thuần, có unit); e2e vẫn giữ chỗ chờ URL.
- Sản phẩm không lưu "mốc ngày" theo người dùng (không vi phạm Luật GỐC 3 về trạng thái ẩn). Điểm yếu nhỏ của sản phẩm: hai ô ghi đè nhau theo `value` đã vẽ khi thao tác cực nhanh; có thể gộp theo `prev` của URL ở `setDate` nếu muốn bền hơn (chưa làm, ngoài phạm vi).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Lọc ngày trong danh sách hợp đồng không mất lựa chọn khi thao tác nhanh
Mỗi thao tác ở ô lọc ngày (đổi cột, đổi cửa sổ, nhập từ/đến) được gộp lên bộ lọc đang có TRÊN URL tại thời điểm xử lý, không lên bộ lọc đã vẽ ở lần trước; hai lựa chọn liền nhau (kể cả trên máy chậm) giữ cả hai, các khoá URL khác (loại chứng từ…) không đổi.
- Kịch bản: khi chọn cột "Hạn chót" rồi ngay lập tức chọn "Quá hạn" thì URL giữ cả `dfield=action_deadline` và `due=overdue` [test: apps/workspace-web/src/features/contracts-list/lib/date-filter.test.ts » hai thao tác liên tiếp trên CÙNG search cũ: giữ cả hai (không ghi đè theo bộ lọc đã vẽ); khoá khác giữ nguyên]
- Kịch bản: khi chọn cột rồi cửa sổ "Quá hạn" thì truy vấn có `date_field=action_deadline` và `due=overdue`, tải lại giữ nguyên [test: e2e/contracts-web/gap-b-list.cw.ts » Gap #10 · lọc ngày » chọn 'Quá hạn' ⇒ URL có due=overdue và truy vấn có due; tải lại giữ nguyên; chọn khoảng ⇒ date_from/date_to]

## Việc còn lại
- (đã làm sau lượt R7) `setDate` gộp theo `prev` của router; `DateFilterControl.onChange` phát thao tác (`DateAction`).