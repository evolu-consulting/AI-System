# cr146b-sign-per-flow — CR-146 · Ký theo từng quy trình (lát 146b)

Nguồn chốt: `docs/specs/cr146-flow-settings/decisions.md` mục 6, 7, 9.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Bước Ký trong quy trình bắt buộc «Ký qua» và người ký phía công ty
Node Ký BẮT BUỘC «Ký qua» (khoá nhà cung cấp đang bật của công ty hoặc `upload` = «Tải lên bản đã ký (không ký số)») và «Người ký phía công ty»; thiếu ⇒ lỗi theo trường lúc LƯU quy trình (`NO_PROVIDER_SELECTED`, `NO_SIGNER_SELECTED`), nhà cung cấp chưa bật ⇒ `PROVIDER_NOT_ENABLED`. Không còn nhóm «Người ký HĐ» cấp công ty hay nhà cung cấp mặc định công ty làm fallback.
- Kịch bản: khi lưu quy trình thiếu «Ký qua» hoặc người ký dù công ty có nhóm Người ký HĐ thì báo lỗi theo trường [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.validator.test.ts » CR-146b · «Ký qua» + người ký bắt buộc trong node]
- Kịch bản: khi mã hoá/giải mã cấu hình node Ký thì `provider` được giữ và luật `esignConfigIssues` áp dụng [test: packages/contracts/src/pack-contracts/esign-node.test.ts » CR-146b]
- Kịch bản: khi lưu quy trình với người ký khác người tạo HĐ hoặc người ký thuộc công ty khác thì chỉ người đúng công ty được nhận [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » CR-146b · lưu def: thiếu «Ký qua»/người ký ⇒ lỗi theo trường]
- Kịch bản: khi chạy bước Ký với «Ký qua» của node thì dùng đúng nhà cung cấp hoặc chờ tải lên [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.tools.esign-node.test.ts » CR-146b · «Ký qua» của node]

### MODIFIED sht/doi-tac-uy-tin.md
#### Yêu cầu: Cấu hình bên nhận nằm trong quy trình «Nhận HĐ từ đối tác»
Ngưỡng «Quan trọng»/«Rất quan trọng» (triệu đồng) và người phụ trách hợp đồng nhận lưu ở `trigger.params` của quy trình Nhận HĐ đang bật đầu tiên; người ký bên nhận («Ký cùng lúc») là «Người ký phía công ty» của bước Ký trong quy trình đó, chưa có bước Ký ⇒ 422 `NO_SIGN_NODE` «Quy trình Nhận HĐ chưa có bước Ký». Gỡ `contracts.partner_settings` (pack-contracts 0111), thêm hàm hub 0143.
- Kịch bản: khi công ty có quy trình Nhận HĐ thì ngưỡng, người phụ trách, người ký đọc từ quy trình đó; công ty khác không đọc được [test: apps/hub-api/src/modules/packs/contracts/adapters/receive-flow.int.test.ts » CR-146b · receiveFlowOf]

## Quyết định trong lúc làm
- Nơi lưu ngưỡng/người phụ trách = `trigger.params` (important_min_m, critical_min_m, owner_user_id); luật chọn flow = đầu tiên đang bật theo `position` (như `eventFlowOf`), không xét `when`.
- Hub 0143 (0142 đã dùng ở CR-147) + pack-contracts 0111 DROP TABLE `partner_settings` (không backfill).
- Thuật ngữ «Người ký phía công ty»; seed `withEsignSigner` thêm `provider: upload`; demo-org bỏ nhóm mặc định.

## Việc còn lại (hết ngân sách lượt)
1. int ĐỎ 14/43 (run 20261114-114302): `partner-inbox-decision.int.test.ts` (cần người phụ trách OWN ⇒ dựng flow `contract.received` có `owner_user_id`, hoặc đổi kỳ vọng sang quản trị UB); `esign-node.int.test.ts` (đã gỡ insert `partner_settings`, chưa chạy lại). Còn dùng `partner_settings`: `sign-session*.int`, `sign-together.int` ⇒ chuyển sang flow Nhận HĐ có bước Ký.
2. Web: gỡ nhóm «Người ký HĐ» ở `FlowWorkSettings.tsx`/`api-delegation.ts` và `ReceiveSettings.tsx` (endpoint `/partner/settings` ĐÃ GỠ); thêm 3 ô «Quan trọng từ», «Rất quan trọng từ» (triệu đồng), «Người phụ trách hợp đồng nhận» vào panel flow Nhận HĐ (admin-web `TriggerCard`, `flow-form.ts`).
3. Seed: mẫu thư viện có bước Ký (`flow-templates.def.ts`, `contracts-intake.def.ts`, `purchase-templates.data.ts`) thêm `provider` + người ký; flow Nhận HĐ demo có ngưỡng + người phụ trách; `e2e/cr127/_cr127-stack.ts` flow Nhận HĐ cần bước Ký.
4. `check:settings-path` đỏ vì «Cài đặt › Kết nối» (nhãn tab thuộc cr146a), hết khi rebase lên staging-improve. tsc gói đổi chưa chạy.
5. evotest: chạy bằng PowerShell với PATH bỏ thư mục Git usr/bin (tar GNU hiểu `C:` là host nên báo xanh 0/0 giả).
