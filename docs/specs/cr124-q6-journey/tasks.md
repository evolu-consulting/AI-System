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
Trạng thái gộp: chưa gộp

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
## Việc còn lại
- Hành trình đã tiến tới «B nhận → mở HĐ nhận»: lượt 1 (sau u6c) qua node Gửi đối tác; lỗi thật 1 = `/contracts/partner-inbox` bị đổi thành id HĐ (đã sửa, legacy-routes); lượt 2 = HĐ nhận «Quy trình đang dừng» vì sự kiện `contract.received` không có actor (đã sửa, người phụ trách ?? quản trị). CHƯA chạy lại e2e sau hai sửa này (hết 2 lượt) — cần 1 lượt xác nhận: bước kế dự kiến là Đạt của kế toán B (e2e đã đổi người duyệt B sang kế toán vì người gây sự kiện = Giám đốc bị loại khỏi duyệt, `exclude_starter` của mẫu nhận).
- Cần quyết (sản phẩm): người phụ trách nhận HĐ (partner_settings.owner) chính là người gây sự kiện ⇒ bị loại khỏi duyệt bởi `exclude_starter: true` của mẫu «Nhận HĐ …» — nên đặt `exclude_starter: false` cho bước duyệt ở 2 mẫu nhận (hub 0121 đã seed, cần migration mới).
- Ảnh chụp: mới có a-held, b-invite, b-inbox (lượt 2); chưa có a-confirmed/a-returned/b-settings/node panel. Ảnh a-held + b-inbox đã soát: ổn (thẻ A nêu rõ chờ kết nối; thẻ B 3 dòng đủ ý).