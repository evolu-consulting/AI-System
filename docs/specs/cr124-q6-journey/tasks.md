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
## Việc còn lại
- Hành trình vẫn đỏ, nay ở bước THẬT SỰ KẾ TIẾP (đã tiến 1 bước): sau khi sửa thẻ duyệt (`from_run`) Giám đốc A bấm Đạt được («Đã duyệt bởi E2E Giám đốc»), rồi stage tool `contracts-partner-send` của node «Gửi đối tác xác nhận» dừng NGAY (1 giây) ⇒ run `needs_decision`, thẻ «Gửi ký chưa được — cần xử lý». Nghi: tool `real_action` dừng ở `launchTool` (`realActionPre` null hoặc `toolDriver`/`mcpToolInvoker` từ chối tool gói). Chưa có log lý do (hub không in stage lỗi ra log e2e). Spec đã in `DIAG-STAGES`/`DIAG-AUDIT` (stage + `decision` + audit) khi thẻ vòng gửi không hiện — chạy lại 1 lượt sẽ ra nguyên nhân. Dừng theo giới hạn 2 lượt e2e.
- Chưa có ảnh chụp các màn đối tác (spec ghi vào `test.info().outputPath`).
- «Chờ gửi duyệt» ở cột Bước của danh sách HĐ (`approval-step-label.rules.ts`) vẫn coi stage idx 0 là bước soạn cho lượt flow theo sự kiện — cần cùng `from_run`.