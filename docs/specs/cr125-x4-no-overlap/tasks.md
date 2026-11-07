---
id: cr125-x4-no-overlap
lát: cr125-x4-no-overlap
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: u13 (đã gộp)
---
## Plan (ngắn)
Lỗi thấy ở shot demo (c1, c2, g0, e-dieu-kien-hoac): "Kế toán duyệt chi" đè lên "Kết thúc · Đã duyệt", Ký số bị chen phía sau; ngăn chi tiết che nửa phải canvas và cắt node ở mép trái; câu của bước Nếu đọc "đi tới Bước 2 · Trưởng phòng duyệt".

## Làm
1. `flow-canvas/layout/settle.ts` (thuần): `settlePositions` — vị trí tay (`ui.x` + `ui.y`) chỉ được giữ khi hộp không đè node nào (cách ≥ `SETTLE_GAP` 24px), đè ⇒ node quay về toạ độ ELK; còn đè (ELK dự phòng) ⇒ đẩy node sau xuống dưới. Host `ProcessCanvas` dùng cho MỌI vị trí (`settleItems`); thả/kéo đè lên node khác ⇒ không lưu vị trí (`collidesWith`).
2. ELK giãn hơn: giữa các tầng 60 → 90, giữa node cùng tầng 40 → 56, node nhiều cổng ra (Ký số 3 đầu ra) chừa thêm `PORT_LABEL_W` 48px bên phải cho nhãn "Ký xong / Từ chối / Hết hạn".
3. Ngăn chi tiết mở: `view-fit` kéo/thu khung nhìn để node chọn + node kề (cạnh vào/ra) nằm TRỌN bên trái ngăn (dùng `focusViewport`, thay cách chỉ pan ngang `revealDx`). Zoom thu nhỏ tới sàn `REVEAL_MIN` 0.55 (thấp hơn mức fit đọc được 0.75), nhóm không vừa thì `fitGroup` bỏ dần node kề xa nhất, node chọn luôn thấy trọn.
4. Câu bước Nếu: đích chỉ là TÊN bước ("đi tới Trưởng phòng duyệt", nhiều giai đoạn nối " / "), bước chưa đặt tên mới hiện "Bước N" (`StageIf` prop `stepName`). Ô chọn đích vẫn "Bước N · tên".

## Không làm / Chạm
- Không engine / hub-api / migration; vị trí tay đã lưu trong def không bị xoá (chỉ không áp khi đè).

## Test tối thiểu
Unit `flow-canvas/layout/settle.test.ts` (ELK thật: flow demo + một bước thêm không giao nhau, thả đè quay về ELK), `elk.test.ts`, `x4-if-sentence.test.ts`; e2e `cr123-arrow-drag.spec.ts` (không chồng nhau sau nối, node chọn + kề thấy trọn bên trái ngăn) chạy MỘT lần trên evotest; tsc flow-canvas + admin-web.

## Quyết định trong lúc làm
- Độ giãn đổi zoom vừa-khung của flow demo 8 bước từ ≥ 0.75 xuống ≥ 0.65 (ngưỡng test elk cập nhật theo).
- Kéo thả đè lên node khác thì node quay về chỗ cũ (không lưu), thay vì đẩy node khác đi.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-web.md
#### Yêu cầu: Sơ đồ không bao giờ có hai node chồng nhau, ngăn chi tiết không che node đang sửa (nguồn: CR-125 x4)
Sau mọi thao tác sửa / bố cục lại không có hai hộp node nào giao nhau: vị trí kéo tay chỉ được giữ khi không đè node nào, đè ⇒ bố cục lại theo ELK. Khoảng cách tầng đủ rộng cho node Ký số với ba đầu ra. Khi ngăn chi tiết mở, node đang chọn và node kề nằm trọn trong phần canvas còn thấy. Câu của bước Nếu chỉ nêu tên bước đích.
- Kịch bản: khi bố cục lại flow demo thì không có hai node nào giao nhau [test: packages/flow-canvas/src/layout/settle.test.ts » flow demo (có Ký số 3 đầu ra)]
- Kịch bản: khi thêm Kế toán duyệt chi sau Ký xong thì không có hai node nào giao nhau [test: packages/flow-canvas/src/layout/settle.test.ts » flow demo + một bước thêm sau Ký xong (Kế toán duyệt chi)]
- Kịch bản: khi thả tay một bước đè lên node khác thì bước đó quay về toạ độ ELK [test: packages/flow-canvas/src/layout/settle.test.ts » bước thả tay đè lên node khác ⇒ quay về toạ độ ELK, thả chỗ trống thì giữ]
- Kịch bản: khi thêm bước trên flow thật và mở ngăn chi tiết thì không node nào chồng nhau và node chọn cùng node kề thấy trọn bên trái ngăn [test: e2e/journey-approval/cr123-arrow-drag.spec.ts » U12b · trình tự demo: thả Duyệt (chung cột), Ký xong → Duyệt → Thông báo → Kết thúc, Bắt đầu khi → Ký số báo lý do, Lưu và áp dụng không 422]
- Kịch bản: khi nhóm node chọn cùng node kề không vừa vùng thấy bên trái ngăn thì bỏ dần node kề xa nhất và vẫn giữ node chọn [test: packages/flow-canvas/src/view-focus.test.ts » không vừa ⇒ bỏ dần node xa nhất, luôn giữ node chính (đầu danh sách)]
- Kịch bản: khi bước Nếu đi tới một bước thì câu chỉ nêu tên bước, không kèm Bước N [test: apps/admin-web/src/features/processes/lib/x4-if-sentence.test.ts » đích = tên bước (nhiều giai đoạn nối ' / '), không có 'Bước N ·']

## Việc còn lại
- Không.
