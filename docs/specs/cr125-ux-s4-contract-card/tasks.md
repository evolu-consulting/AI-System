---
id: cr125-ux-s4-contract-card
lát: cr125-ux-s4-contract-card
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
UX-S4 + UX-S8 (docs/specs/CR-125/ux-review-ceo.md: H4 H5 H6 M2 M4 M6 L1 L2 M3) + phần SA H4 cùng file: hub trả MÃ bước (không trả chữ tiếng Việt), web dịch qua i18n.

## Làm
- SA H4: `stepLabelOf` trả `{code, who?, name?}`; schema `ContractStepSchema` (khoá `step_label` giữ tên vì ListRow 23 khoá đã khoá); web `stepKey`/`approvedLabel` so theo mã, dịch `contracts.list.step.*`.
- H4: người duyệt (có nút Duyệt/Đạt, không phải bước xác nhận) thấy thẻ Tóm tắt + 3 nút; form Quản lý/Thông tin/Sản phẩm gập trong `<details>` "Xem và sửa chi tiết hợp đồng".
- H5: sau gửi duyệt "Đã gửi <bước> · hạn N giờ" (khi bước có hạn); dòng chờ "Đã gửi duyệt. Đang giao cho người duyệt kế tiếp…"; bước hệ thống (Thông báo người tạo) chỉ chủ HĐ/quản trị thấy.
- H6: công ty bật ký số ⇒ tệp không phải PDF bị giữ lại lúc chọn/thả tệp kèm câu cách khắc phục; câu "chưa gửi ký được" nói rõ cần PDF + nhờ người tạo tải PDF.
- M2: tiêu đề chuông/thư bước duyệt của run gắn HĐ có nhãn HĐ ("Cần duyệt: HĐ <số> · <tên> · <bước>") — nhãn lấy theo tập qua `recordLabelRegistry` trong `batch.repo`.
- M4: cột Bước nói bước/người đang chờ bằng mã dịch ("Chờ <bước>", "Chờ <người> ký", "Cần xử lý — mở hợp đồng xem lý do").
- M6: dòng "Đang dùng ký thử…" cạnh nhãn ký thử; Lịch sử thay đổi chuyển lên ngay dưới các bước duyệt.
- L1: nút chính/viền ≥ 44 px ở ≤ 639 px; ẩn nút trợ lý nổi trên thẻ HĐ ở điện thoại.
- L2: thẻ "Bắt đầu nhanh" khi công ty chưa có số liệu ("Chờ bạn" vốn đã ở đầu Tổng quan).
- M3: nhãn ô đăng nhập "Tên đăng nhập (email)"; ảnh xem trước đăng nhập ghi "Hình minh hoạ — không phải dữ liệu thật".

## Không làm / Chạm
Không: workspace-web Cài đặt, admin-web, community, DLC, engine. Chưa làm: cảnh báo trùng HĐ khi tải cùng PDF hai lần (M4 phần 2 — cần kiểm ở máy chủ), liên kết email điền sẵn mã công ty (M3 phần 2 — cần mã công ty trong liên kết thư), "Đối tác mới · sẽ tạo khi lưu" chỉ gập cùng form. `step_label` đổi kiểu (chuỗi → đối tượng mã) — chỉ web trong repo đọc.

## Test tối thiểu
unit: `approval-step-label.rules.test.ts`, `list-contracts-step.usecase.test.ts`, `pack-bell.rules.test.ts`, `approved-label.test.ts`, `pdf-gate.test.ts`; e2e job contracts-web (evotest, -Dirty) + spec mới `e2e/contracts-web/cr125-s4-card.cw.ts`.

## Quyết định trong lúc làm
- Giữ khoá `step_label` (khoá ListRow đã khoá trong tests/acceptance/HD1) nhưng giá trị là mã có cấu trúc; không đổi tên để khỏi mở lại test khoá.
- Nhãn HĐ cho thư duyệt lấy bằng `recordLabelRegistry` (đã có cho trang chạy), không đọc bảng gói từ engine; lỗi ⇒ bỏ nhãn.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Danh sách hợp đồng
Máy chủ trả mã bước của lượt duyệt (`step_label.code` + tên người ký / tên bước), không trả chữ tiếng Việt; trang web dịch bằng i18n và so sánh theo mã.
- Kịch bản: khi bước duyệt đang mở thì hub trả mã waiting_step kèm tên bước [test: apps/hub-api/src/modules/packs/contracts/domain/approval-step-label.rules.test.ts » bước duyệt đang mở ⇒ waiting_step + tên bước]
- Kịch bản: khi lượt duyệt kết thúc Đã duyệt thì dòng danh sách ghép Đã duyệt với trạng thái HĐ theo mã approved [test: apps/workspace-web/src/features/contracts-list/lib/approved-label.test.ts » mã approved ⇒ ghép với trạng thái HĐ]

#### Yêu cầu: Tải hợp đồng lên khi đã bật ký số
Công ty đã bật ký số chỉ nhận tệp PDF lúc tải lên; tệp khác bị giữ lại kèm câu cách khắc phục.
- Kịch bản: khi ký số bật và chọn tệp .md thì tệp không đi tiếp và hiện câu cần PDF [test: apps/workspace-web/src/features/contracts-list/lib/pdf-gate.test.ts » ký số bật ⇒ tệp không phải PDF bị giữ lại, PDF đi tiếp]

#### Yêu cầu: Thẻ hợp đồng theo vai
Người duyệt thấy thẻ tóm tắt cùng ba nút, form sửa gập lại; sau gửi duyệt thẻ nói gửi cho ai và hạn bao lâu; bước hệ thống chỉ chủ HĐ thấy; Lịch sử thay đổi nằm ngay dưới các bước duyệt; ký thử có dòng giải thích.
- Kịch bản: khi người duyệt mở thẻ thì chỉ thấy tóm tắt và nút Duyệt, form sửa gập trong khối Xem và sửa chi tiết [test: e2e/contracts-web/cr125-s4-card.cw.ts » người duyệt thấy thẻ tóm tắt, form sửa gập lại]
- Kịch bản: khi bước kế có hạn thì sau gửi duyệt hiện Đã gửi <bước> · hạn N giờ [test: apps/workspace-web/src/features/contract-approval/lib/moved-to.test.ts » hạn của bước vừa mở]

#### Yêu cầu: Tiêu đề thông báo duyệt có tên hợp đồng
Chuông/thư "Cần duyệt" của run gắn hợp đồng nêu hợp đồng nào, để hai thư cùng bước không trùng tiêu đề.
- Kịch bản: khi run gắn HĐ có nhãn thì tiêu đề là Cần duyệt: <nhãn> · <bước> [test: apps/hub-api/src/modules/processes/domain/notify/pack-bell.rules.test.ts » có record_label ⇒ Cần duyệt: <nhãn> · <bước>]

#### Yêu cầu: Điện thoại và Tổng quan
Nút chính cao ≥ 44 px ở điện thoại, nút trợ lý nổi ẩn trên thẻ hợp đồng; công ty chưa có số liệu thấy thẻ Bắt đầu nhanh; nhãn đăng nhập là Tên đăng nhập.
- Kịch bản: khi công ty chưa có số liệu thì Tổng quan hiện thẻ Bắt đầu nhanh [test: apps/workspace-web/src/features/overview/components/QuickStartCard.test.ts » công ty chưa có số liệu ⇒ rỗng]

## Việc còn lại
Cảnh báo trùng khi tải cùng PDF hai lần; mã công ty điền sẵn trong liên kết thư (xem "Không làm").
