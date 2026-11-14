# cr146b-sign-per-flow — CR-146 · Ký theo từng quy trình (lát 146b)

Nguồn chốt: `docs/specs/cr146-flow-settings/decisions.md` mục 6, 7, 9.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Bước Ký trong quy trình bắt buộc «Ký qua» và người ký phía công ty
Node Ký BẮT BUỘC «Ký qua» (khoá nhà cung cấp đang bật của công ty hoặc `upload` = «Tải lên bản đã ký (không ký số)») và «Người ký phía công ty»; thiếu ⇒ lỗi theo trường lúc LƯU quy trình (`NO_PROVIDER_SELECTED`, `NO_SIGNER_SELECTED`), nhà cung cấp chưa bật ⇒ `PROVIDER_NOT_ENABLED`. Không còn nhóm «Người ký HĐ» cấp công ty hay nhà cung cấp mặc định công ty làm fallback.
- Kịch bản: khi lưu quy trình thiếu «Ký qua» hoặc người ký dù công ty có nhóm Người ký HĐ thì báo lỗi theo trường [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.validator.test.ts » CR-146b · «Ký qua» + người ký bắt buộc trong node]
- Kịch bản: khi mã hoá/giải mã cấu hình node Ký thì `provider` được giữ và luật `esignConfigIssues` áp dụng [test: packages/contracts/src/pack-contracts/esign-node.test.ts » CR-146b]
- Kịch bản: khi lưu quy trình với người ký khác người tạo HĐ hoặc người ký thuộc công ty khác thì chỉ người đúng công ty được nhận [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » CR-146b · lưu def / «Ký qua» = misa, người ký B ≠ A / người ký thuộc công ty khác]
- Kịch bản: khi chạy bước Ký với «Ký qua» của node thì dùng đúng nhà cung cấp hoặc chờ tải lên [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.tools.esign-node.test.ts » CR-146b · «Ký qua» của node]

### MODIFIED sht/doi-tac-uy-tin.md
#### Yêu cầu: Cấu hình bên nhận nằm trong quy trình «Nhận HĐ từ đối tác»
Ngưỡng «Quan trọng»/«Rất quan trọng» (triệu đồng) và người phụ trách hợp đồng nhận lưu ở `trigger.params` của quy trình Nhận HĐ đang bật đầu tiên; người ký bên nhận («Ký cùng lúc») là «Người ký phía công ty» của bước Ký trong quy trình đó, chưa có bước Ký ⇒ 422 `NO_SIGN_NODE` «Quy trình Nhận HĐ chưa có bước Ký». Gỡ `contracts.partner_settings` (pack-contracts 0111), thêm hàm hub 0143.
- Kịch bản: khi công ty có quy trình Nhận HĐ thì ngưỡng, người phụ trách, người ký đọc từ quy trình đó; công ty khác không đọc được [test: apps/hub-api/src/modules/packs/contracts/adapters/receive-flow.int.test.ts » CR-146b · receiveFlowOf]
