---
id: fnr-fix-if2
lát: fnr-fix-if2
cr: CR-103
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Showcase 150 triệu + "mua sắm" rẽ nhầm sang else. Nguyên nhân gốc: route admin `POST /process-defs/:id/run` (nút "Chạy thử" của trang showcase) bỏ qua `inputs[]` của body ⇒ run không có input ⇒ node `set` ghi rỗng, node If không có dữ kiện ⇒ Sai.

## Làm
- Chuyển `inputs` qua `defs.routes` → `DefsService.run` → `StartPort.fromAdmin` → `StartService.fromAdmin` → `#insert` (cùng validate `validateRunInputs` như đường `/process-runs`).
- `compare` (dùng chung rẽ nhánh + node If): chuỗi chuẩn hoá NFC + trim hai vế (trình duyệt có thể gửi NFD).
- Test: int `tests/acceptance/fnr-showcase/showcase-http.int.test.ts` (đúng payload trang, qua hai cổng duyệt song song: 150tr ⇒ Giám đốc chờ kiểm; NFD; 50tr ⇒ bỏ qua); unit NFD ở `if.rules.test.ts`; e2e `showcase.fnr.ts` khẳng định "Giám đốc duyệt" = Chờ kiểm / Bỏ qua và run chưa Hoàn tất ở 150tr.

## Không làm / Chạm
Không đổi contract; không đổi luật If.

## Test tối thiểu
Như trên + `test:int:par` processes, P-d/d2, fnr-showcase; e2e showcase cô lập.

## Quyết định trong lúc làm
- Sửa ở nguồn (route bỏ input) thay vì để If đọc từ chỗ khác. NFC/trim áp cho eq/ne và cả so thứ tự chuỗi (cùng hàm).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa lỗi node If đọc input — route chạy thử admin nay nhận `inputs[]` như đặc tả đã nêu)

## Việc còn lại
Không.