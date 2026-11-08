---
id: cr121-d6b-notify-editor
lát: cr121-d6b-notify-editor
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-d6-notify-node
---
## Plan (ngắn)
Phần giao diện của D-6: thêm/sửa bước "Thông báo" và "Chờ tới" của khe `contracts.approval` ở trình sửa quy trình thư viện (Form + Canvas), hiện ở trang lượt chạy
và ở "quy trình đang dùng"/thẻ duyệt của workspace-web. Không đụng phần chạy (hub-api), không migration.

## Làm
- Form (`lib/flow-form.ts`): bước `notify` (người nhận: người gửi duyệt / người phụ trách / phòng theo mã; chuông luôn có + tuỳ chọn email; tiêu đề + nội dung,
  nút chèn `{ma_hd}` `{ten_hd}` `{gia_tri}`) và `wait_until` (ngày hết hạn / hạn xử lý HĐ ± ngày, giờ). Validate cùng mã với hub: `NOTIFY_TO_REQUIRED`,
  `NOTIFY_CHANNEL_REQUIRED`, `NOTIFY_TITLE_REQUIRED`, `WAIT_OFFSET_RANGE` (+ `WAIT_TIME_INVALID` phía client); bước duyệt sau bước tự chạy không có điều kiện.
- Nút thêm bước icon bộ chung (chuông/đồng hồ), nhãn ở tooltip; chỉ hiện khi khe khai node (`slot.nodes`).
- Canvas: menu "Thêm bước" có Thông báo / Chờ tới; panel bước dùng cùng trường như Form; `normalizeSlotStages` giữ slot, bước tự sang bước kế (`after: auto`).
- Lượt chạy (admin): node có biểu tượng chuông/đồng hồ (nhãn khi rê chuột) + câu giải thích trong nhật ký bước (không người nhận ⇒ vẫn xong, ghi cảnh báo).
- "Quy trình đang dùng" (workspace-web) + thẻ duyệt: nhãn "Thông báo"/"Chờ tới"; sơ đồ xem ở admin: người nhận / "tự chạy tiếp khi tới giờ hẹn".
- e2e hành trình thật (viết, chưa chạy): `e2e/journey-approval/cr121-d6b-notify.spec.ts` + công ty mới `e2e-d6-<hậu tố>` ở `_ja-stack.ts`.

## Không làm / Chạm
Không sửa hub-api (phần chạy), không migration, không DLC. `FE_NODES.notify` vẫn không có nhãn trong trình sửa quy trình thường (chỉ khe thư viện sửa được).

## Test tối thiểu
- unit: `lib/flow-form.test.ts` (validate/mapper), `lib/slot-canvas.test.ts`, `nodes/registry.test.ts` (sửa `defaults` của notify).
- e2e (viết, điều phối chạy cuối đợt): `cr121-d6b-notify.spec.ts` 3 ca.

## Quyết định trong lúc làm
- Một nguồn: bước lưu trong `slot_body`/`stage.slot` như review/dify; Canvas thêm bước = stage trống mang `slot.kind` (khung route do `normalizeSlotStages` dựng, Hub dựng lại stage engine).
- Chuông luôn bật (khớp hub `notifyExecutorOf`), UI chỉ cho thêm email.
- Admin lượt chạy: chưa có cờ riêng "không có người nhận" trong `RunDetailStep`; câu giải thích cố định + xem kết quả bước (.md có cảnh báo). Hiển thị cờ riêng cần hub trả `note` — để lát sau nếu cần.
- Hub chiếu thẻ duyệt `approval-flow-view` chưa gửi bước notify/wait ở FlowView; workspace-web đã map (notify ⇒ system, wait_until ⇒ wait) khi dữ liệu có.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Trình sửa quy trình thêm và sửa bước Thông báo / Chờ tới
Ở khe có khai node, người quản trị nền tảng thêm bước "Thông báo" hoặc "Chờ tới" bằng nút icon (nhãn ở tooltip) ở Form và Canvas; bước Thông báo chọn người nhận
(người gửi duyệt / người phụ trách / phòng theo mã), kênh (chuông luôn có, thêm email), tiêu đề và nội dung chèn được biến mã/tên/giá trị HĐ; bước Chờ tới chọn ngày hết hạn
hoặc hạn xử lý của HĐ, số ngày lệch và giờ. Lỗi hiện tại ô và ở thanh trạng thái, cùng mã với lỗi xuất bản của hub, nói cách sửa.
- Kịch bản: khi thêm bước Thông báo và Chờ tới thì chúng nằm trước bước Ký số và có khoá riêng [test: apps/admin-web/src/features/processes/lib/flow-form.test.ts » thêm Thông báo và Chờ tới chèn trước Ký số, khoá không trùng]
- Kịch bản: khi bước Thông báo thiếu tiêu đề thì báo NOTIFY_TITLE_REQUIRED [test: apps/admin-web/src/features/processes/lib/flow-form.test.ts » thiếu tiêu đề thông báo báo NOTIFY_TITLE_REQUIRED, mặc định là người gửi duyệt và chuông]
- Kịch bản: khi thiếu người nhận hoặc kênh thì báo đúng mã, chọn phòng theo mã là đủ [test: apps/admin-web/src/features/processes/lib/flow-form.test.ts » thiếu người nhận hoặc kênh báo đúng mã, chọn phòng theo mã là đủ]
- Kịch bản: khi Chờ tới lệch ngoài ±365 ngày hoặc giờ sai thì báo WAIT_OFFSET_RANGE / giờ không hợp lệ [test: apps/admin-web/src/features/processes/lib/flow-form.test.ts » Chờ tới lệch ngoài 365 ngày báo WAIT_OFFSET_RANGE, giờ sai báo WAIT_TIME_INVALID]
- Kịch bản: khi bước duyệt đứng sau Thông báo hoặc Chờ tới có điều kiện thì báo lỗi như sau bước Dify [test: apps/admin-web/src/features/processes/lib/flow-form.test.ts » bước duyệt sau Thông báo hoặc Chờ tới không được có điều kiện]
- Kịch bản: khi sửa ở Canvas thì bước Thông báo/Chờ tới giữ nguyên cấu hình, tự sang bước kế, route/finalize đúng chỗ [test: apps/admin-web/src/features/processes/lib/slot-canvas.test.ts » giữ nguyên slot, tự sang bước kế không cổng duyệt, route và finalize đúng chỗ]

#### Yêu cầu: Người dùng thấy thông báo của bước Thông báo ở chuông
Sau khi bước duyệt trước bước Thông báo đạt, người nhận (người gửi duyệt) thấy thông báo ở chuông với tiêu đề đã thay mã/tên HĐ; quy trình đang dùng và thẻ duyệt gọi hai bước
bằng nhãn nghiệp vụ "Thông báo" / "Chờ tới".
- Kịch bản: khi Giám đốc duyệt xong HĐ thì người tạo HĐ thấy thông báo đúng HĐ ở chuông [test: e2e/journey-approval/cr121-d6b-notify.spec.ts » 3 · người gửi duyệt thấy thông báo ở chuông sau khi Giám đốc duyệt, đúng mã/tên HĐ]

#### Yêu cầu: Thẻ duyệt và chi tiết lượt chạy hiện đủ bước Thông báo / Chờ tới
FlowView của thẻ duyệt chiếu cả bước Thông báo (bước hệ thống) và Chờ tới (chờ tới giờ hẹn); chi tiết lượt chạy đánh dấu cảnh báo `NOTIFY_NO_RECIPIENT` khi kết quả bước ghi không có người nhận.
- Kịch bản: khi thẻ có bước Thông báo và Chờ tới thì FlowView có đủ hai bước với đúng loại và giờ hẹn [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.rules.test.ts » notify là bước hệ thống, wait_until là bước chờ tới giờ hẹn, đủ bước như quy trình]
- Kịch bản: khi bước Thông báo không có người nhận thì bước chi tiết lượt chạy mang cảnh báo [test: apps/hub-api/src/modules/processes/runs/run-detail.map.test.ts » không có người nhận thì step.warning là NOTIFY_NO_RECIPIENT, có người nhận thì không có cờ]

## Việc còn lại
Điều phối chạy e2e `journey-approval` (job cuối đợt). Hub `approval-flow-view` chiếu bước notify/wait vào FlowView thẻ duyệt nếu cần hiện ở dòng thời gian thẻ (hiện workspace-web chỉ map khi có).
