---
id: fix-e2e-cw-1116
lát: fix-e2e-cw-1116
cr: CR-177
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa 4 ca e2e đỏ chức năng (contracts-web, flows3) sau đợt CR-177 và loại bộ prod-journey khỏi việc của `test:e2e:par`.

## Làm
- [x] cr177-w1-overlays «khoang trợ lý ở màn hẹp»: CODE — Radix chỉ trả focus về `Trigger`; DockSheet mở từ nút ngoài nên Esc xong focus rơi mất. `DockSheet` nhớ nút đã mở và trả focus (`returnFocus`, unit trong `shell-ui.test.tsx`).
- [x] cr177-w1-overlays «nhóm nút chọn một»: TEST — `/contracts/new` chỉ có ô tải lên; nhóm chọn loại HĐ nằm ở `?type=deal`.
- [x] doc-frame «hộp thêm mốc»: TEST — «Loại mốc» là ô chọn Radix (W2), không còn `<option>`; mở ô rồi đếm mục.
- [x] flows3 FL3-5a: TEST — chờ thẻ tệp thật (danh sách hiện khung chờ lúc đang tải lên ⇒ bấm «Trả lại» sớm thì ô còn thiếu tệp, không gửi; trace: không có POST nào). `declineStep` + `giveEvidence` chờ tên tệp.
- [x] prod-journey: `findE2eConfigs` loại `e2e/prod-journey/` (chỉ chạy qua `deploy/smoke/prod-journey.ps1`); thêm ca vào `test-all.discover.test.ts`.

## Không làm / Chạm
Không đụng ca so ảnh (`scenes.cw.ts`, `hd78-partners.cw.ts`). `tests/.lock` chưa ghi lại (chỉ qc; lock vốn đã lệch nhiều file).

## Test tối thiểu
unit `shell-ui.test.tsx`, `test-all.discover.test.ts`; e2e contracts-web + flows3 trên evotest.

## Quyết định trong lúc làm
- Trả focus làm ở `DockSheet` (một chỗ), không đổi kit `SheetContent`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: W1 đã chốt «ngăn trả focus về nút mở»; lát này sửa cho đúng ý đó, còn lại là sửa test và danh sách việc e2e).

## Việc còn lại
