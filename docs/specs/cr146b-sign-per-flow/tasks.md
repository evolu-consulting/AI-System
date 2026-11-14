# cr146b-sign-per-flow — CR-146 · Ký theo từng quy trình (lát 146b)

Nguồn chốt: `docs/specs/cr146-flow-settings/decisions.md` mục 6, 7, 9.

## Delta

### REMOVED
- (CR-141) Yêu cầu «nhóm Người ký HĐ cấp công ty là người ký mặc định của bước Ký»: bỏ `withDefaultSigners`, `esign.signerGroup()`, `default_signers` của `GET /esign/options`, `hasDefaultSigners`; nhà cung cấp mặc định công ty không còn là fallback của node.

### MODIFIED — esign-node-config
- Node Ký BẮT BUỘC «Ký qua» (`args.provider` = khoá nhà cung cấp đang bật của công ty HOẶC `upload` = «Tải lên bản đã ký (không ký số)») + «Người ký phía công ty» (`company_signers`); thiếu ⇒ lỗi theo trường lúc LƯU (`NO_PROVIDER_SELECTED`, `NO_SIGNER_SELECTED`), nhà cung cấp chưa bật ⇒ `PROVIDER_NOT_ENABLED`.
  - Kịch bản: thiếu «Ký qua»/người ký ⇒ lỗi theo trường dù công ty có nhóm Người ký HĐ [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.validator.test.ts » CR-146b · «Ký qua» + người ký bắt buộc trong node]
  - Kịch bản: mã hoá/giải mã `provider`, luật `esignConfigIssues` [test: packages/contracts/src/pack-contracts/esign-node.test.ts » CR-146b]
  - Kịch bản (int, chéo tenant + người ký ≠ người tạo HĐ): [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » CR-146b · lưu def / «Ký qua» = misa, người ký B ≠ A / người ký thuộc công ty khác]
- Lúc chạy: `upload` ⇒ không tạo phong bì, chờ người được giao tải lên; nhà cung cấp mà công ty đã tắt ký số ⇒ lỗi nghiệp vụ `ESIGN_DISABLED` (không tự chuyển sang chờ tải lên); thiếu «Ký qua» ⇒ `ESIGN_NODE_CONFIG_INVALID:provider`.
  - Kịch bản [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.tools.esign-node.test.ts » CR-146b · «Ký qua» của node]
- Panel node: ô «Ký qua» (nhà cung cấp đang bật + «Tải lên bản đã ký») (chữ `NO_SIGNER_SELECTED` sửa ở lát cr146a) [test: e2e/journey-approval/cr141-sign-or-upload.spec.ts — CHƯA sửa, xem Việc còn lại]

## Việc còn lại (hết ngân sách lượt)
1. **int chưa chạy xanh**: evotest ở Git-bash lỗi dựng kit tar (log `.data/evotest/*-int`, test 0/0 — không phải xanh thật). Chạy lại từ PowerShell thuần: `$env:EVOTEST_KEY=...; powershell -File deploy/evotest/run-tests.ps1 -Step int -Filter "apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts" -Dirty`. Các int khác dùng `signer_group_id`/`provider`: `sign-together`, `sign-session*`, `esign-sweep-node`, `seed.cr125-esign-signer`, `seed.cr127-config`.
2. **Mục 3 (ngưỡng + người phụ trách Nhận HĐ vào cấu hình quy trình): CHƯA làm.** Cần quyết nơi lưu: đề xuất `trigger.params` của flow `contract.received` (`important_min_m`, `critical_min_m`, `owner_user_id`) vì `importance` là dữ kiện chọn flow (`contract-flow.repo.ts:45`) ⇒ phải chọn flow nào đưa ngưỡng; chạm `partner-inbox.repo settings()`, `partner-ui.repo`, `partner-routes.mount`, hub `process-trigger.ts`, panel TriggerCard.
3. **`partner_settings.signer_group_id` còn trong DB/API**: vẫn dùng cho «Ký cùng lúc» bên nhận (`sign-session.routes.ts:64`, `partner-mailbox.mount.ts:128`) và `contract-access.mount.ts` (R#31). Gỡ cần quyết nguồn người ký bên nhận (đề xuất: đặt trong cấu hình quy trình Nhận HĐ cùng mục 3) rồi migration 0111 + gỡ `partner-ui.repo`/`partner-routes.mount`/contract/seed `seed.cr127-config`/`seed-demo-org 3b`/`e2e/cr127/_cr127-stack.ts:208`.
4. Seed: mới sửa `tools/demo/purchase-flow-def.ts` (`provider: upload`). Chưa sửa các mẫu thư viện có bước Ký (`flow-templates.def.ts`, `contracts-intake.def.ts`, `purchase-templates.data.ts`, `seed.cr125-config.ts`) — thêm `provider` + người ký; chú ý test khớp byte với migration hub.
5. e2e `cr141-sign-or-upload.spec.ts`, `cr123-u6-run-card.spec.ts`, `_kit/flows.ts`: thêm `provider` vào args node Ký (không chạy).
6. Đổi nhãn tab «Ký & đối tác» → «Kết nối» ở `{{path:sign}}` thuộc lát cr146a.
