# Chuỗi giao diện của app Hợp đồng không mất khi thêm mục «Hợp đồng đối tác gửi»

Cập nhật: 2026-11-08 · Nguồn: CR-124/125.

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Chuỗi giao diện của app Hợp đồng không mất khi thêm mục «Hợp đồng đối tác gửi» (nguồn: cr124-q6-journey)
Tệp bản dịch `partner` gộp sâu vào nhánh `nav` có sẵn, không ghi đè; menu và nút của Sổ Hợp Tác vẫn hiện chữ.
- Kịch bản: khi nạp bản dịch thì `nav.partner-inbox` có và `nav.overview`, `approval.confirmSave` vẫn còn [test: packages/i18n/src/contracts-locales.test.ts » tệp `partner` gộp SÂU]

#### Yêu cầu: Người duyệt bước ĐẦU của flow theo sự kiện có nút Đạt / Trả lại / Từ chối (nguồn: cr124-q6-journey)
Thẻ duyệt dựng từ lượt flow theo sự kiện (`from_run`): bước 0 là stage thật (vd «Giám đốc duyệt»), không phải bước soạn «Gửi duyệt» của máy cũ. Người duyệt thấy Đạt/Trả lại/Từ chối; nhân viên không còn thấy «Bản nháp» sau khi đã gửi; Trả lại được ở bước 0.
- Kịch bản: khi thẻ có from_run và bước 0 đang mở thì người có quyền thấy Đạt + Trả lại + Từ chối, không «Xác nhận và lưu» [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.from-run.test.ts » from_run ⇒ Đạt + Trả lại + Từ chối, không «Xác nhận và lưu»]
- Kịch bản: khi lượt flow có stage Duyệt ở bước 0 thì server đánh dấu from_run, cho người duyệt task và cho Trả lại [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.flow.rules.test.ts » Trả lại được ở bước 0 của lượt flow]

#### Yêu cầu: HĐ nhận từ đối tác có thẻ duyệt để người duyệt của bên nhận quyết (nguồn: cr124-q6-journey)
HĐ nhận có lượt duyệt chờ quy trình nhận; bộ điều phối gắn run vào thẻ; flow nhận kết thúc thì lượt duyệt đóng theo kết quả.
- Kịch bản: khi bộ chuyển tạo HĐ nhận thì có lượt duyệt `level1` chế độ engine chưa gắn run [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » bộ chuyển tạo HĐ nhận riêng của B + contract.received]
- Kịch bản: khi flow nhận được mở thì run gắn vào thẻ và khi kết thúc Trả lại thì lượt duyệt đóng [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » Kết thúc flow nhận = Trả lại ⇒ lần gửi đóng + tín hiệu partner.returned đúng một lần]

#### Yêu cầu: Cột «Bước» của danh sách HĐ nói «Chờ <tên bước>» cho bước duyệt đầu của flow theo sự kiện (nguồn: cr124-q6-journey)
Cột «Bước» dùng cùng luật `from_run` với thẻ duyệt (lượt không có bước mẫu máy cũ): bước duyệt đầu đang mở ⇒ «Chờ <tên bước>», không phải «Chờ gửi duyệt».
- Kịch bản: khi lượt là from_run và bước 0 đang mở thì nhãn là «Chờ <tên bước>» [test: apps/hub-api/src/modules/packs/contracts/domain/approval-step-label.rules.test.ts » CR-124 · run của event flow (from_run)]
- Kịch bản: khi người duyệt của bên nhận mở HĐ nhận thì thẻ from_run + quyết được và danh sách nhãn «Chờ Giám đốc duyệt» [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » Kết thúc flow nhận = Trả lại ⇒ lần gửi đóng + tín hiệu partner.returned đúng một lần]

#### Yêu cầu: Trang «Hợp đồng đối tác gửi» mở được bằng đường dẫn trực tiếp (nguồn: cr124-q6-journey)
`/contracts/partner-inbox` là trang gốc của app, không bị đổi thành `/contracts/c/partner-inbox` (id HĐ cũ).
- Kịch bản: khi mở /contracts/partner-inbox thì không bị chuyển hướng [test: apps/workspace-web/src/shared/kernel/legacy-routes.test.ts » URL chuẩn mới / ngoài SHT ⇒ null (không dội vòng)]

#### Yêu cầu: Sự kiện «HĐ nhận» luôn có người gây sự kiện để flow nhận chạy được (nguồn: cr124-q6-journey)
Bên nhận chưa đặt người phụ trách ⇒ lấy quản trị công ty (hoạt động, sớm nhất); thiếu người gây sự kiện thì bộ điều phối từ chối (FLOW_REFUSED) và HĐ nhận kẹt «Quy trình đang dừng».
- Kịch bản: khi bộ chuyển tạo HĐ nhận thì sự kiện contract.received có actor là người dùng của công ty nhận [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » bộ chuyển tạo HĐ nhận riêng của B + contract.received]

#### Yêu cầu: Mẫu «Nhận HĐ …» không loại người gây sự kiện khỏi bước Duyệt (nguồn: cr124-q6-journey)
HĐ nhận không có người gửi thật bên trong công ty nhận; người gây sự kiện (người phụ trách / quản trị) vẫn duyệt được. Hub 0124 đổi `exclude_starter` = false ở 2 mẫu (chỉ bản còn nguyên seed 0121).
- Kịch bản: khi xem nguồn TS của mẫu nhận thì bước Duyệt có exclude_starter=false và seed 0124 khớp từng byte [test: apps/hub-api/src/modules/processes/library/flow-templates-receive.def.test.ts » seed hub 0121 (id, trigger) + 0124]

#### Yêu cầu: Bước «Gửi đối tác xác nhận» nói chữ đối tác, không nói «ký» (nguồn: cr124-q6-journey)
Thẻ duyệt dùng khoá node của bước module (`module_node`) để hiện «Đang chờ đối tác trả lời / Đối tác đã xác nhận / Đối tác từ chối / hết hạn» thay vì «Đang chờ ký / Đã ký».
- Kịch bản: khi bước module có node contracts.partner-send thì thẻ dùng chữ đối tác [test: e2e/journey-approval/cr124-q6-partner-journey.spec.ts » 1 · gửi lần đầu]
