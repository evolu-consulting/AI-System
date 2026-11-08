---
id: cr124-q6-journey
lát: cr124-q6-journey
cr: CR-124
làn: qc (e2e + sửa lỗi sản phẩm tìm được)
migration: không
phụ thuộc: q1–q5
---
## Plan (ngắn)
Hành trình e2e gửi hợp đồng cho đối tác trên stack thật (`journey-approval`): hai công ty mới A (gửi) và B (nhận), chuẩn bị đi đường thật (D5) — hồ sơ công ty, danh bạ, tính năng `contracts-partner-confirm` qua entitlement, nhóm duyệt của B, flow mẫu «Nhận HĐ thường» gán cho B.

## Làm
- `_ja-stack.ts`: dựng hai công ty `e2e-q6a-<hậu tố>` / `e2e-q6b-<hậu tố>` (hub đã chạy `HUB_PARTNER_MAILBOX=on` từ q5). Config: `cr124-q6*.spec.ts`.
- `_kit`: `featureIdByKey`, `setCompanyProfile`, `setDirectoryListed`, `createGroupWith`, `partnerSendNode`, `createLibraryFlow(inputs)`.
- Spec `cr124-q6-partner-journey.spec.ts`: (1) gửi lần đầu → giữ chờ kết nối → B nhận lời mời → thả → B duyệt → A «Đã xác nhận»; (2) «Trả lại sửa» có lý do; (3) màn Cài đặt nhận.
- LỖI SẢN PHẨM TÌM ĐƯỢC + SỬA: `packages/i18n/src/contracts-locales.ts` gộp tệp `partner.*.json` NÔNG ⇒ ghi đè cả nhánh `contracts.nav` và làm lệch thứ tự `esignflow` ⇒ toàn menu / nút của Sổ Hợp Tác hiện khoá thô (`contracts.nav.overview`, `contracts.approval.confirmSave`…). Nay gộp SÂU cùng `rep3`; test chặn hồi quy.

## Không làm / Chạm
Không đổi engine, không migration.

## Test tối thiểu
unit: `contracts-locales.test.ts` (gộp sâu). e2e: `cr124-q6-partner-journey.spec.ts` (đã chạy 3 lượt trên evotest — XEM «Việc còn lại»).

## Quyết định trong lúc làm
- Flow phía A dựng bằng API Thư viện (UI thêm node đã có spec editor riêng); phần còn lại đi đường thật (profile/entitlement/directory/nhóm/gán flow).
- Ảnh chụp ghi vào thư mục kết quả của ca (`test.info().outputPath`) để evotest kéo về.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)

### ADDED sht/gui-doi-tac-giao-dien.md
#### Yêu cầu: Chuỗi giao diện của app Hợp đồng không mất khi thêm mục «Hợp đồng đối tác gửi»
Tệp bản dịch `partner` gộp sâu vào nhánh `nav` có sẵn, không ghi đè; menu và nút của Sổ Hợp Tác vẫn hiện chữ.
- Kịch bản: khi nạp bản dịch thì `nav.partner-inbox` có và `nav.overview`, `approval.confirmSave` vẫn còn [test: packages/i18n/src/contracts-locales.test.ts » tệp `partner` gộp SÂU]
#### Yêu cầu: Người duyệt bước ĐẦU của flow theo sự kiện có nút Đạt / Trả lại / Từ chối
Thẻ duyệt dựng từ lượt flow theo sự kiện (`from_run`): bước 0 là stage thật (vd «Giám đốc duyệt»), không phải bước soạn «Gửi duyệt» của máy cũ. Người duyệt thấy Đạt/Trả lại/Từ chối; nhân viên không còn thấy «Bản nháp» sau khi đã gửi; Trả lại được ở bước 0.
- Kịch bản: khi thẻ có from_run và bước 0 đang mở thì người có quyền thấy Đạt + Trả lại + Từ chối, không «Xác nhận và lưu» [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.from-run.test.ts » from_run ⇒ Đạt + Trả lại + Từ chối, không «Xác nhận và lưu»]
- Kịch bản: khi lượt flow có stage Duyệt ở bước 0 thì server đánh dấu from_run, cho người duyệt task và cho Trả lại [test: apps/hub-api/src/modules/packs/contracts/domain/approval-engine-card.flow.rules.test.ts » Trả lại được ở bước 0 của lượt flow]
#### Yêu cầu: HĐ nhận từ đối tác có thẻ duyệt để người duyệt của bên nhận quyết
HĐ nhận có lượt duyệt chờ quy trình nhận; bộ điều phối gắn run vào thẻ; flow nhận kết thúc thì lượt duyệt đóng theo kết quả.
- Kịch bản: khi bộ chuyển tạo HĐ nhận thì có lượt duyệt `level1` chế độ engine chưa gắn run [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » bộ chuyển tạo HĐ nhận riêng của B + contract.received]
- Kịch bản: khi flow nhận được mở thì run gắn vào thẻ và khi kết thúc Trả lại thì lượt duyệt đóng [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » Kết thúc flow nhận = Trả lại ⇒ lần gửi đóng + tín hiệu partner.returned đúng một lần]
#### Yêu cầu: Cột «Bước» của danh sách HĐ nói «Chờ <tên bước>» cho bước duyệt đầu của flow theo sự kiện
Cột «Bước» dùng cùng luật `from_run` với thẻ duyệt (lượt không có bước mẫu máy cũ): bước duyệt đầu đang mở ⇒ «Chờ <tên bước>», không phải «Chờ gửi duyệt».
- Kịch bản: khi lượt là from_run và bước 0 đang mở thì nhãn là «Chờ <tên bước>» [test: apps/hub-api/src/modules/packs/contracts/domain/approval-step-label.rules.test.ts » CR-124 · run của event flow (from_run)]
- Kịch bản: khi người duyệt của bên nhận mở HĐ nhận thì thẻ from_run + quyết được và danh sách nhãn «Chờ Giám đốc duyệt» [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » Kết thúc flow nhận = Trả lại ⇒ lần gửi đóng + tín hiệu partner.returned đúng một lần]
#### Yêu cầu: Trang «Hợp đồng đối tác gửi» mở được bằng đường dẫn trực tiếp
`/contracts/partner-inbox` là trang gốc của app, không bị đổi thành `/contracts/c/partner-inbox` (id HĐ cũ).
- Kịch bản: khi mở /contracts/partner-inbox thì không bị chuyển hướng [test: apps/workspace-web/src/shared/kernel/legacy-routes.test.ts » URL chuẩn mới / ngoài SHT ⇒ null (không dội vòng)]
#### Yêu cầu: Sự kiện «HĐ nhận» luôn có người gây sự kiện để flow nhận chạy được
Bên nhận chưa đặt người phụ trách ⇒ lấy quản trị công ty (hoạt động, sớm nhất); thiếu người gây sự kiện thì bộ điều phối từ chối (FLOW_REFUSED) và HĐ nhận kẹt «Quy trình đang dừng».
- Kịch bản: khi bộ chuyển tạo HĐ nhận thì sự kiện contract.received có actor là người dùng của công ty nhận [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » bộ chuyển tạo HĐ nhận riêng của B + contract.received]
#### Yêu cầu: Mẫu «Nhận HĐ …» không loại người gây sự kiện khỏi bước Duyệt
HĐ nhận không có người gửi thật bên trong công ty nhận; người gây sự kiện (người phụ trách / quản trị) vẫn duyệt được. Hub 0124 đổi `exclude_starter` = false ở 2 mẫu (chỉ bản còn nguyên seed 0121).
- Kịch bản: khi xem nguồn TS của mẫu nhận thì bước Duyệt có exclude_starter=false và seed 0124 khớp từng byte [test: apps/hub-api/src/modules/processes/library/flow-templates-receive.def.test.ts » seed hub 0121 (id, trigger) + 0124]
#### Yêu cầu: Bước «Gửi đối tác xác nhận» nói chữ đối tác, không nói «ký»
Thẻ duyệt dùng khoá node của bước module (`module_node`) để hiện «Đang chờ đối tác trả lời / Đối tác đã xác nhận / Đối tác từ chối / hết hạn» thay vì «Đang chờ ký / Đã ký».
- Kịch bản: khi bước module có node contracts.partner-send thì thẻ dùng chữ đối tác [test: e2e/journey-approval/cr124-q6-partner-journey.spec.ts » 1 · gửi lần đầu]
## Việc còn lại
- Hành trình `cr124-q6-partner-journey.spec.ts` XANH (3/3, evotest 20261107-180027). Lỗi thật đã sửa trên đường đi: nhãn «Bước» from_run; route `/contracts/partner-inbox` bị legacy-routes đổi thành id HĐ; `contract.received` thiếu actor (FLOW_REFUSED); mẫu nhận `exclude_starter` (hub 0124, journal thêm cả 0123 còn thiếu); Trả lại ở bước 0 của flow theo sự kiện (BACK_TARGET_INVALID ⇒ `fail_flow`); `after.branch` rỗng làm node Duyệt không rẽ Trả lại/Từ chối (step.repo); lý do Trả lại nằm ở review_tasks.feedback (reviewerReason); bước «Gửi đối tác» nói «Đã ký» (module_node).
- Chưa chụp panel node «Gửi đối tác» ở editor admin (A). Ảnh khác đã soát: thẻ A chờ kết nối/đã xác nhận/đã trả lại + lý do, lời mời + hộp thư B, cài đặt nhận HĐ của B — ổn. Nợ giao diện nhỏ ngoài lát: tiêu đề HĐ bị bóp hẹp khi nhiều nút ở trạng thái bản nháp (a-returned); thẻ «Ký số: Công ty chưa bật ký số» hiện cho flow chỉ có Gửi đối tác.
- Nợ có sẵn (không do lát): `packages/db/src/migrate-hub.int.test.ts` đỏ vì HUB_TABLES chưa có 3 bảng hộp thư q1; `tool-stage-load.repo.ts` lệch format (biome).
- Sau soát Opus (đã sửa): #2 Trả lại của from_run lùi theo `back_to_steps` của stage (fail_back) hoặc nhánh Trả lại (fail_flow) — unit cả hai; S1 lượt duyệt HĐ nhận chỉ tạo khi flow nhận sẵn sàng (cờ bật + có flow gán), Mở lại HĐ nhận phát `contract.received`; S2 người gây sự kiện: người phụ trách hợp lệ ?? quản trị hoạt động/không khoá ?? null (lý do RECEIVE_NO_OWNER, không phát sự kiện); #6 coalesce(nullif(btrim)). Int: partner-receive-arm.int.test.ts.
- TODO (#3, ngoài lát, >20 dòng): đánh dấu `from_run` rõ từ `snapshot.trigger.event` của run thay vì suy từ `flow_steps` rỗng — cần thêm trường vào PackStepsView + cột ở truy vấn danh sách HĐ (contracts.repo) + engineCardView.
