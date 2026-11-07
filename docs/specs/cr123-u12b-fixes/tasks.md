---
id: cr123-u12b-fixes
lát: cr123-u12b-fixes
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: u12 (đã gộp)
---
## Plan (ngắn)
Demo (tools/demo/cr122-steps-canvas.ts) gặp 3 lỗi sau u12: (1) Thông báo → Kết thúc bị báo "vòng lặp"; (2) Bắt đầu khi → Ký số không thấy toast; (3) Lưu và áp dụng trả 422 PROCESS_DEF_INVALID / APPROVE_INVALID.

## Làm
1. Nguyên nhân chung của (1) và (3): Duyệt vừa thả rơi vào CỘT của bước khác (Thông báo). Nối "Ký xong → Duyệt" không làm Duyệt tách cột (đích đã ở sau nguồn) ⇒ Duyệt chung cột với Thông báo: nối Duyệt → Thông báo bị coi là "cùng ô" (vòng lặp sai), và Hub bắt buộc bước Duyệt đứng MỘT MÌNH trong bước (APPROVE_INVALID) nhưng canvas không kiểm.
2. `lib/arrow-rules.ts`: `applyConnect` là MỘT hàm cho mọi mũi tên (kéo, nối lại): node vừa thả luôn thành bước MỚI ngay sau nguồn; hai bước cùng cột song song không còn bị coi là vòng lặp (đích được tách ra bước sau nguồn); sau mỗi mũi tên `isolateApprovals` tách mọi bước Duyệt chung cột; thả lên chính node nguồn ⇒ bỏ qua (không toast vòng lặp). Hook `connect` chỉ gọi hàm này.
3. Luật lưu: `approveAloneErrors` (free-nodes) chặn Lưu kèm lý do "Bước Duyệt phải đứng một mình trong bước" tại bước đó (không đợi Hub trả 422) cho cả đường dời bước thủ công.
4. (2): cổng ra của Bắt đầu khi hoạt động và toast hiện (đã kiểm trên stack và e2e); trong demo cổng nằm NGOÀI khung (kịch bản tự kéo canvas qua trái, cổng ở x < 0) nên chuột nhấn trượt. Không đổi sản phẩm; e2e đưa cổng vào khung bằng "Vừa khung" như người dùng.
5. e2e `cr123-arrow-drag.spec.ts` ca U12b theo ĐÚNG thứ tự demo trên nền Trưởng phòng duyệt → Ký số → Thông báo chuông → Kết thúc; Lưu và áp dụng không có 422.

## Không làm / Chạm
- Không engine / hub-api / migration; không bố cục ELK (u13, tạm dừng).

## Test tối thiểu
Unit `lib/u12b-demo-sequence.test.ts` (8) + processes 486 pass; tsc admin-web sạch; e2e `cr123-arrow-drag.spec.ts` 4 pass trên evotest.

## Quyết định trong lúc làm
- Ký số cần Duyệt ngay trước nên nền e2e không chèn Nếu giữa Duyệt và Ký số; người ký (Hub bắt buộc khi lưu) gán sẵn là người dùng giám đốc của công ty e2e.
- Minimap (góc dưới phải) che node thả ở góc đó: ghi nhận, chưa sửa (u13 gập hàng sẽ đỡ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Mũi tên chỉ bị từ chối khi tạo vòng lặp thật; bước Duyệt luôn đứng một mình (nguồn: CR-123 u12b)
Hai bước cùng cột không phải vòng lặp: nối giữa chúng đặt đích ở bước ngay sau nguồn. Node vừa thả luôn thành bước mới ngay sau nguồn khi nối. Bước Duyệt phải đứng một mình trong bước: canvas tách sau mỗi mũi tên và chặn Lưu kèm lý do nếu còn chung cột.
- Kịch bản: khi thả Duyệt vào cột của Thông báo rồi nối Ký xong → Duyệt → Thông báo → Kết thúc thì mọi mũi tên nối được và Duyệt đứng một mình [test: apps/admin-web/src/features/processes/lib/u12b-demo-sequence.test.ts » Duyệt → Thông báo và Thông báo → Kết thúc đều nối được (không báo vòng lặp sai)]
- Kịch bản: khi bước Duyệt chung cột với bước khác thì Lưu bị chặn kèm lý do [test: apps/admin-web/src/features/processes/lib/u12b-demo-sequence.test.ts » approveAloneErrors chặn Lưu kèm lý do tại stages.i.step]
- Kịch bản: khi chạy đúng trình tự demo thì Bắt đầu khi → Ký số báo lý do và Lưu và áp dụng không trả 422 [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12b · trình tự demo: thả Duyệt (chung cột), Ký xong → Duyệt → Thông báo → Kết thúc, Bắt đầu khi → Ký số báo lý do, Lưu và áp dụng không 422]

## Việc còn lại
- Cổng "Bắt đầu khi" ra ngoài khung khi người dùng kéo canvas: cân nhắc ghim hoặc nút "Về đầu" (u13 gập hàng sẽ giảm).