---
id: cr122-p11g-confirm-facts
lát: cr122-p11g-confirm-facts
cr: CR-122
làn: đầy đủ (máy trạng thái run — node Nếu)
migration: không
phụ thuộc: cr122-p11f-library-launch
---
## Plan (ngắn)
e2e G1.2: HĐ 150 tr mà node Nếu "giá trị > 100 tr" ra Sai (thẻ hiện "Duyệt giá trị nhỏ").

## Bằng chứng
- Trace `cr122-q1-e2e/.data/evotest/20261107-004406-2868-e2e` (G1.2, HĐ `01a1b1f8-4b71…`): GET HĐ trước và lúc "Xác nhận và lưu" ⇒
  `fields.total_value = {value: 150000000 (số), verified: true}` ⇒ giá trị ĐÃ ở cột HĐ, đúng khoá, đúng kiểu. Giả thuyết "giá trị
  chưa vào HĐ / lệch khoá / chuỗi" SAI; không cần ghi thêm lúc xác nhận.
- Gốc: `processes/adapters/runs/step.repo.ts:52-57` `packOf` cần `snapshot.trigger.event` để tìm `FactsReader`; snapshot run dựng ở
  `processes/runs/start-inputs.ts:174-183` KHÔNG có `trigger` (mọi lượt, cả flow Thư viện lẫn bản công ty) ⇒ `readFacts` không được gọi
  ⇒ vế `fact` = null ⇒ `compareFact` sai ⇒ luôn rẽ Sai.
- Int mới đỏ trước sửa (evotest e6e5772c0+dirty, bỏ sửa): ca 150 tr mở stage 2 thay vì 1; ca 50 tr xanh (vì luôn Sai).

## Đã làm
- `processes/runs/flow-event-attach.ts`: `FlowEventAttach.event` ⇒ CÙNG câu gắn sự kiện ghi `snapshot.trigger.event`;
  `flow-launch.ts` truyền `e.event`. Node Nếu đọc dữ kiện HIỆN TẠI của HĐ qua `FactsReader` như thiết kế.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Node Nếu của lượt mở từ sự kiện đọc dữ kiện bản ghi
Lượt flow mở từ sự kiện của app ghi lại sự kiện mở lượt, nên node Nếu đọc được dữ kiện hiện tại của bản ghi (vd giá trị HĐ) và rẽ đúng
nhánh.
- Kịch bản: HĐ 150 tr, điều kiện "lớn hơn 100 tr" ⇒ nhánh Đúng, mở "Duyệt giá trị lớn" [test: apps/hub-api/src/modules/processes/triggers/flow-branch-facts.int.test.ts » 150 tr ⇒ Nếu Đúng ⇒ 'Duyệt giá trị lớn' mở (stage 1), facts đọc 150000000]
- Kịch bản: HĐ 50 tr ⇒ nhánh Sai, mở "Duyệt giá trị nhỏ" [test: apps/hub-api/src/modules/processes/triggers/flow-branch-facts.int.test.ts » 50 tr ⇒ Nếu Sai ⇒ 'Duyệt giá trị nhỏ' mở (stage 2)]

## Việc còn lại
- [ ] Soát Opus low (máy trạng thái run).
- [ ] qc chạy lại e2e journey G1.2 sau gộp.
- [ ] (ghi nợ) lượt tạo không qua bộ điều phối (Chạy tay / admin) vẫn không có `snapshot.trigger` — nếu def có node Nếu đọc `fact` cũng rẽ Sai; nên ghi trigger từ def lúc `createRun`.
