---
id: flow-ui-clarity
lát: flow-ui-clarity
cr: CR-108
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Cài đặt › Quy trình duyệt (chỉ đọc) khó hiểu: thiếu hạn/nhắc/số người duyệt mỗi bước, bước có điều kiện không thấy đường bỏ qua, ô giá trị mẫu khó đọc, không rõ vì sao "mặc định" và vì sao chỉ xem, thanh Lưu vẫn hiện. Làm: (1) `GET /approval-flow` thêm trường tuỳ chọn mỗi bước; (2) canvas có nhánh bỏ qua + nhãn điều kiện + chú giải; (3) ô giá trị mẫu có ngăn nghìn + nút nhanh + dòng kết quả; (4) giải thích mặc định/chỉ xem; (5) ẩn thanh Lưu ở mục này.

## Làm
- Contract `ApprovalFlowCurrentStepSchema`: thêm `due_h`, `remind_every_h`, `escalate_group_name`, `approver_count` (đều optional ⇒ client cũ chạy được).
- hub-api `readCurrentFlow`: lấy từ `slot_body` (bước review/esign); `approver_count` = số thành viên `active`, không bị khoá, `internal` của nhóm duyệt qua cổng mới `FlowGroups.memberCounts` (`packGroups`): MỘT câu SQL cho cả lô nhóm; bước chọn người cụ thể ⇒ 1; Dify/không biết ⇒ vắng.
- contracts-web: `lib/flow-canvas.ts` (nhánh bỏ qua `skip-<bước>` nét đứt đi vòng bên phải qua tay nắm `skip-out/skip-in`, nhãn điều kiện trên cạnh vào bước, `info` mỗi bước + chiều cao), `lib/preview-value.ts` (gõ/đọc số, chip, tóm tắt), `StepInfoLines`, `FlowList`, `FlowPreview`, `FlowLegend`, `FlowCurrentPane`, `SettingsHeader/Dialog` (`noSave`).
- i18n vi/en (`v2l.*.json`): `flow.current.{lead,defaultBadge,defaultHelp,saveNote,info.*,legend.*,canvas.skip}`, `flow.{previewResult,quick.*}`.

## Không làm / Chạm
Không đổi engine, không migration, không sửa auth/login/session. Công tắc ký số (`EsignSetting`) tự lưu khi bấm (mutation riêng), không dùng thanh Lưu của hộp thoại ⇒ ẩn thanh ở mục này là an toàn. Mục Điểm uy tín / Dò giá cũng lưu riêng nhưng không đổi ở lát này.

## Test tối thiểu
unit `flow-canvas.test.ts`, `preview-value.test.ts`; int `approval-flow-current.int.test.ts` (đường chính: có trường mới + đếm người còn dùng); e2e `approval-current.cw.ts` (chạy một lần `test:e2e:par --only=contracts-web`); typecheck hub-api + contracts-web; biome; build + check:bundle (chunk canvas giữ lazy).

## Quyết định trong lúc làm
- Đếm người duyệt chỉ tính user `active`, không `locked_by_tenant`, `kind='internal'` (cùng luật danh bạ `manage.members`); không phân biệt trưởng phòng (`head_only`).
- Dòng điều kiện bỏ khỏi node (đã nằm trên cạnh vào bước) để node gọn; khoảng cách dọc `GAP_Y` 36 → 52 chừa chỗ cho nhãn; canvas cao 420 → 520 px.
- Nhánh bỏ qua sáng lên (đường thật) khi xem trước cho thấy bước bị bỏ qua, mờ nửa khi bước chạy.
- Số nhiều: vi/en thiếu `_one` ở vi nên dùng hai khoá `info.approver` / `info.approvers` (giữ test cùng tập key vi/en).
- Thanh Lưu chỉ ẩn khi mục `flow` và bản nháp (Công ty / Điểm kinh doanh) không có thay đổi chưa lưu; có nháp ⇒ thanh hiện như cũ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Cài đặt › Quy trình duyệt cho thấy hạn, nhắc, số người duyệt, chuyển cấp của từng bước
`GET /approval-flow` trả thêm, nếu quy trình có: `due_h`, `remind_every_h`, `escalate_group_name`, `approver_count` (số thành viên còn dùng được của nhóm duyệt, tính MỘT câu cho cả quy trình). Màn hiện "Hạn 24 giờ · nhắc mỗi 8 giờ", "3 người duyệt", "Quá hạn ⇒ chuyển <nhóm>" trên node canvas và dòng danh sách; thiếu ⇒ ẩn.
- Kịch bản: khi quy trình có hạn 24 giờ, nhắc 8 giờ, chuyển cấp sang nhóm khác và nhóm duyệt có người ngừng hoạt động thì API trả đủ bốn trường với số người chỉ tính người còn dùng được [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » GET chỉ đọc quy trình đang dùng, PUT không còn]
- Kịch bản: khi bước có hạn, người duyệt và nhóm chuyển cấp thì node canvas cao thêm từng dòng, bước thiếu thông tin thì ẩn dòng [test: apps/contracts-web/src/features/settings/lib/flow-canvas.test.ts » CR-108 thông tin bước]

#### Yêu cầu: Canvas vẽ nhánh bỏ qua và nhãn điều kiện
Bước có điều kiện (không phải bước đầu): cạnh vào bước ghi điều kiện ("Giá trị ≥ 500.000.000"); thêm cạnh nét đứt từ node liền trước sang node liền sau, nhãn "Không thoả ⇒ bỏ qua"; nhánh sáng lên khi xem trước bỏ qua bước đó. Chú giải dưới canvas: bước, bước hệ thống (khoá), nhánh bỏ qua, mờ = bị bỏ qua theo xem trước.
- Kịch bản: khi có bước điều kiện thì canvas có cạnh bỏ qua nét đứt nối node trước với node sau và cạnh chính mang nhãn điều kiện [test: apps/contracts-web/src/features/settings/lib/flow-canvas.test.ts » CR-108 nhánh bỏ qua]
- Kịch bản: khi mở mục thì canvas hiện nhãn điều kiện, nhãn nhánh bỏ qua và chú giải [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]

#### Yêu cầu: Xem trước đường đi nhập giá trị có ngăn nghìn
Ô "Giá trị mẫu" định dạng vi-VN khi gõ (1.500.000), đọc ngược về số; nút nhanh "100 triệu", "500 triệu", "1 tỷ", "Để trống"; trên cùng ghi "Hợp đồng này đi qua N/M bước: …".
- Kịch bản: khi gõ 500000000 thì ô hiện 500.000.000 và đọc lại ra 500000000; chip điền đúng giá trị [test: apps/contracts-web/src/features/settings/lib/preview-value.test.ts » preview-value · gõ/đọc số]
- Kịch bản: khi bấm chip "500 triệu" thì ô hiện 500.000.000 và dòng kết quả báo đi qua 2/2 bước [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]

#### Yêu cầu: Giải thích mặc định và chỉ xem; ẩn thanh Lưu ở mục chỉ xem
Huy hiệu "Đang dùng mặc định" kèm lời giải thích "Công ty bạn chưa được gán quy trình riêng, đang dùng quy trình mặc định của hệ thống."; lời dẫn "Mục này chỉ để xem. Muốn đổi quy trình, liên hệ quản trị nền tảng." (platform admin vẫn thấy lối vào editor). Ở mục Quy trình duyệt, khi không có nháp chưa lưu, đầu hộp thoại thay "Khôi phục tất cả / Bỏ thay đổi / Lưu cài đặt" bằng ghi chú; sang mục khác thanh hiện lại.
- Kịch bản: khi mở Quy trình duyệt thì có lời giải thích mặc định, lời dẫn chỉ xem và không có nút Lưu cài đặt; sang Công ty thì nút Lưu hiện lại [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]

## Việc còn lại
Gộp Delta vào `docs/current/sht/cai-dat-va-quyen.md` cuối đợt (theo `openspec:archive`). Merge do điều phối.