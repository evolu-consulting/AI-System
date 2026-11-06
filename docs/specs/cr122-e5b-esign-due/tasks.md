---
id: cr122-e5b-esign-due
lát: cr122-e5b-esign-due
cr: CR-122
làn: nhanh (migration chỉ thêm cột; đường ghi phong bì + vòng quét ⇒ Opus low soát)
migration: gói contracts 0078 (idx 74, when 1806200000000)
phụ thuộc: E5 (e54910129)
---
## Plan (ngắn)
Áp `due_days`/`remind_every_hours` của node Ký số lúc chạy; server tự kiểm cấu hình node khi lưu def; int cho nhánh Group của danh bạ người ký.

## Làm
- Migration `0078_esign_envelope_due.sql`: `esign_envelopes.due_h`, `remind_every_h` (nullable, CHECK dải, không backfill). Tool ghi khi gửi (`due_days × 24`, `remind_every_hours`) qua `SendNodeOpts` → `ESignRepo.insert`.
- `esign-sweep.repo.ts`: hạn/nhắc = `coalesce(phong bì mở, bước Ký số cũ)` (một `left join lateral`, số câu SQL không đổi).
- Kit `node-config-registry.ts` (`nodeConfigRegistry.register/check`, `constToolArgs`) + gói contracts đăng ký `contracts.esign` (`esign-node.validator.ts`, ở `esign.mount.ts`).
- **Processes (đúng 8 dòng thật, ngoài import):** `defs/defs.service.ts` hàm `nodeCheck` (đã được create/update def gọi) thêm `nodeConfigRegistry.check(tenantId, stages)` ⇒ `defError("FLOW_NODE_CONFIG_INVALID", { issues })`; `defs/defs.map.ts` thêm câu lỗi; contract `HUB_ADMIN_PROCESS_ERRORS.FLOW_NODE_CONFIG_INVALID = 422`. Def Thư viện (tenant null) không xét (cấu hình theo công ty).
- Int nhánh Group: người cụ thể + Group (bỏ thành viên bị khoá, thứ tự khai, bỏ trùng), Group công ty khác bị chặn, gửi ký với Group ⇒ mỗi thành viên là một người ký.

## Không làm / Chạm
- Không đổi luật thuần `esign-sweep.rules.ts` (hàng quét vẫn mang `due_h`/`remind_every_h`). Không đụng engine/settle/node, triggers, A1/A2, UI, DLC.
- **Giới hạn đã biết:** vòng quét hiện duyệt theo `approvals` có bước Ký số (đường cũ); phong bì của node Ký số mà HĐ KHÔNG có lượt duyệt kiểu cũ chưa được quét nhắc/chuyển cấp — hạn chờ của node vẫn chạy bằng `timeout_h` của stage chờ. Nhánh quét theo phong bì (cần mốc nhắc/chuyển cấp riêng trên phong bì) ⇒ lát sau.
- `FLOW_NODE_CONFIG_INVALID` chưa có chuỗi i18n ở admin-web (UI hiện `details.issues[].path` + `code`).

## Test tối thiểu
- unit: `esign-node.validator.test.ts` (validator + sổ kit). int: `esign-node.int.test.ts` (Group + hạn/nhắc ghi trên phong bì), `esign-sweep-envelope.int.test.ts` (sweep đọc phong bì trước), `processes/defs/defs-node-config.int.test.ts` (422 khi lưu def).

## Quyết định trong lúc làm
- Validator đăng ký theo khoá node (không theo tool) và nhận stage có `node` — an toàn cho node nhiều stage (chỉ stage tool gửi ký có `args`).
- Chỉ kiểm args HẰNG (`from: "const"`); nguồn `input`/`field` không kiểm tĩnh được, bỏ qua (runtime vẫn kiểm lại thành viên công ty).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED current/pack-contracts/esign-node-due.md
#### Yêu cầu: Hạn ký và nhắc của node áp lúc chạy
Hạn ký và chu kỳ nhắc đặt ở node được lưu theo phong bì; vòng quét ký số đọc phong bì trước, trống thì dùng bước Ký số cũ.
- Kịch bản: khi phong bì có hạn và chu kỳ nhắc ngắn hơn bước Ký số cũ thì vòng quét nhắc và chuyển cấp theo phong bì, phong bì trống thì theo bước cũ [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-sweep-envelope.int.test.ts » phong bì có hạn/nhắc ⇒ nhắc + quá hạn, phong bì trống ⇒ theo bước Ký số cũ (chưa tới hạn)]
- Kịch bản: khi gửi ký với hạn 3 ngày và nhắc mỗi 12 giờ thì phong bì lưu 72 và 12, không cấu hình node thì để trống [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » gửi ký với Group ⇒ mỗi thành viên còn dùng được là một người ký công ty, hạn/nhắc ghi trên phong bì]
#### Yêu cầu: Lưu def kiểm cấu hình node Ký số
Lưu quy trình có node Ký số cấu hình sai thì báo lỗi FLOW_NODE_CONFIG_INVALID kèm đường dẫn trường sai.
- Kịch bản: khi nhà cung cấp chưa bật thì lưu def bị từ chối và không ghi [test: apps/hub-api/src/modules/processes/defs/defs-node-config.int.test.ts » nhà cung cấp chưa bật ⇒ 422 FLOW_NODE_CONFIG_INVALID + path, không lưu]
- Kịch bản: khi cấu hình sai dạng thì báo đúng khoá [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.validator.test.ts » sai dạng ⇒ path theo khoá, sai theo công ty ⇒ path + mã của gói]
#### Yêu cầu: Người ký công ty chọn theo Group
- Kịch bản: khi chọn Group thì mọi thành viên còn dùng được ký, thành viên bị khoá bị bỏ, Group công ty khác bị chặn [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » Group ⇒ mọi thành viên còn dùng được (bỏ người bị khoá), theo thứ tự khai, bỏ trùng]
- Kịch bản: khi Group thuộc công ty khác thì kiểm lúc lưu báo lỗi và gửi ký bị từ chối [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » Group của công ty khác ⇒ không thuộc công ty (kiểm lúc lưu + từ chối lúc gửi)]

## Việc còn lại
- Nhánh quét theo phong bì cho node không có lượt duyệt cũ; chuỗi i18n cho `FLOW_NODE_CONFIG_INVALID` ở admin-web.
