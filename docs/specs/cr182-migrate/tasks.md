---
id: cr182-migrate
lát: cr182-migrate
cr: CR-182
làn: nhanh
migration: hub 0160
phụ thuộc: cr182-roles
---
## Plan (ngắn)
Chuyển quy trình HIỆN TẠI sang giao việc theo vai (R4): migration CHỈ THÊM điền `role` / `signer_role` + hàng giao việc từ nhóm/người đang dùng; bước Ký có vai chạy ký trên tài liệu khi công ty BẬT `on_doc_enabled` (R3), TẮT thì chạy y như cũ; vai chưa giao ⇒ chuông cho quản trị công ty.

## Làm
- [x] Migration hub 0160 `0160_cr182_roles_backfill.sql` (journal `when` 1806903400000): def + bản xuất bản; giao việc theo (công ty × vai); chạy lại an toàn; không đụng `process_runs`, `dlc.*`.
- [x] `withRoles` thêm `{ ondoc }`; `roles.repo` đọc công tắc (`onDocOf`, 1 câu, chỉ khi có bước Ký có vai) ở `applyRoles` / `applyRolesMany` / `refreshStageRoles`.
- [x] Tool `contracts-esign-send`: `effectiveCfg` (BẬT ⇒ ondoc, bỏ provider cũ; TẮT ⇒ như cũ; vai chưa giao ⇒ `ESIGN_NODE_NO_SIGNER`); khai `signer_role` / `need_digital` trong tham số tool; validator `checkNode` không kiểm provider cũ khi có vai và công ty BẬT.
- [x] Chuông «Chưa giao người» (`role-unassigned-bell.ts`, gắn vào `notLaunched` của `contract.submitted` / `contract.received`).
- [x] Script chỉ đọc `tools/scripts/src/cr182-migrate-preview.ts` (+ `.rules.ts` thuần).

## Không làm / Chạm
Không làm: trình soạn admin (cr182-admin), màn giao việc (cr182-assign), thêm bước «Đối tác ký» (partner), sửa mẫu Thư viện (nền tảng soạn).
Chạm: db (0160, journal), contracts (`flow/with-roles`), hub-api (processes/roles, packs/contracts/adapters: intake.tools, esign-node.usecase, role-unassigned-bell, flow-events.mount), tools/scripts.

## Test tối thiểu
unit: `with-roles.test.ts`, `intake.tools.esign-node.test.ts`, `role-unassigned-bell.test.ts`, `cr182-migrate-preview.rules.test.ts`. int evotest: `roles-migrate.int.test.ts` (4) + `roles.int.test.ts` (10) xanh.

## Quyết định trong lúc làm
- Khoá vai migration = `nhom-<10 hex md5(loại:giá trị)>` / `nguoi-…` (cùng nhóm ⇒ cùng vai ở mọi stage, mọi bản xuất bản; không đụng độ khi chạy lại); nhãn = tên nhóm (def công ty) hoặc «Người duyệt cấp n» (def Thư viện, người cố định). Vai Ký cố định `nguoi-ky-hop-dong` / «Người ký hợp đồng».
- Hàng giao việc chỉ sinh từ stage CHƯA có vai ở lần chạy đó (không đè lựa chọn quản trị, không hồi sinh hàng đã bỏ); `ON CONFLICT DO NOTHING`.
- Def Thư viện (nhóm theo MÃ): giao cho mỗi công ty được gán (`company_flows`) nhóm cùng mã; công ty thiếu nhóm ⇒ vai không có hàng giao ⇒ «Chưa giao người» (như trước: thiếu nhóm thì không mở được lượt). Người duyệt cố định ở mẫu Thư viện không có (id người là của công ty).
- Ký NHIỀU người/nhóm (`company_signers` > 1 mục) hoặc Ký ở mẫu Thư viện: KHÔNG thêm vai, giữ cấu hình cũ, preview liệt kê. Lý do: vai nhận một nhóm HOẶC một người; «lấy người đầu» giảm số người phải ký (rủi ro pháp lý), «tạo nhóm» ghi dữ liệu công ty trong migration. Quản trị tự gom nhóm rồi đặt vai ở trình soạn.
- Nhóm không còn / người đã khoá ⇒ có vai, không hàng giao (không tự đoán).
- Công tắc đọc qua `hub.sig_settings_of` (hub_rw không SELECT bảng `signature_settings`); hàm đó kiểm tenant khớp ngữ cảnh.
- Vai Ký chưa có người (`company_signers` rỗng) ⇒ tool ném `ESIGN_NODE_NO_SIGNER` ở cả hai chế độ (không lùi về người bắt đầu lượt).
- Chuông: người nhận = `tenant_admin` còn dùng được (trần 50) — chưa gồm quản trị gói Sổ Hợp Tác (Q15) vì lõi quy trình không có `PackAccessView`; dedup theo (HĐ × vai). Chỉ gửi khi mã trong lý do là khoá vai (tra nhãn từ def); thiếu nhóm theo MÃ của mẫu Thư viện không có chuông (như cũ). Gửi ở hook `notLaunched` (đường sự kiện); mở tay thì người bấm thấy 422 `ROLE_UNASSIGNED`.
- Mẫu Thư viện còn `group_key` nên `libraryDefFor` (`bindGroupKeys`) vẫn từ chối nếu công ty thiếu nhóm cùng MÃ dù đã giao vai khác nhóm — để cr182-qc/nền tảng xử lý khi sửa mẫu sang vai.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/quy-trinh-cr127.md
#### Yêu cầu: Chuyển quy trình hiện tại sang giao việc theo vai
Khi triển khai, quy trình đang dùng được thêm vai theo nhóm/người đang chọn và quản trị giao sẵn đúng nhóm/người đó; mọi cấu hình cũ giữ nguyên, hợp đồng đang duyệt dở chạy tiếp theo ảnh chụp cũ, chạy lại không nhân đôi. Bước Ký nhiều người/nhóm không tự chuyển được nên giữ cấu hình cũ.
- Kịch bản: khi chuyển quy trình cũ thì có vai và giao việc đúng, giữ trường cũ, không đổi mẫu của Rowan, bước Ký nhiều người và lượt đang chạy [test: apps/hub-api/src/modules/processes/roles/roles-migrate.int.test.ts » def cũ (nhóm, nhóm cùng duyệt, chuyển cấp, người duyệt, Ký 1 nhóm) ⇒ có vai + giao việc đúng, trường cũ GIỮ, mẫu dlc, Ký nhiều người, lượt đang chạy không đổi]
- Kịch bản: khi mẫu Thư viện dùng mã nhóm thì công ty có nhóm cùng mã được giao còn công ty thiếu nhóm thì chưa giao [test: apps/hub-api/src/modules/processes/roles/roles-migrate.int.test.ts » def Thư viện theo MÃ nhóm: công ty có nhóm cùng mã ⇒ giao, công ty không có ⇒ chưa giao, bản xuất bản nhận cùng vai]
- Kịch bản: khi chạy chuyển lần hai thì không nhân đôi và hàng quản trị đã bỏ giao không hồi sinh [test: apps/hub-api/src/modules/processes/roles/roles-migrate.int.test.ts » chạy migration LẦN HAI ⇒ không nhân đôi, không đổi gì, hàng quản trị đã bỏ giao không hồi sinh]

#### Yêu cầu: Bước Ký có vai chạy theo công tắc ký trên tài liệu
Công ty bật «ký trên tài liệu»: bước Ký có vai ký trên tài liệu với người ký lấy từ vai, bỏ «Ký qua» cũ. Công ty tắt: chạy như cũ («Ký qua» và người ký phía công ty). Vai chưa có người thì không gửi ký.
- Kịch bản: khi công ty tắt thì giữ cách ký cũ còn khi bật thì ký trên tài liệu theo vai [test: apps/hub-api/src/modules/processes/roles/roles-migrate.int.test.ts » công ty TẮT ⇒ giữ provider cũ + người ký như cũ, BẬT ⇒ provider = ondoc, người ký từ vai (bỏ provider cũ)]
- Kịch bản: khi bước Ký có vai thì tool gửi ký chạy theo công tắc và không lùi về người bắt đầu lượt [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.tools.esign-node.test.ts » công ty BẬT ⇒ ký trên tài liệu với người ký giải từ vai, BỎ provider cũ (kể cả docusign / trống)]
- Kịch bản: khi công ty tắt thì chạy như cũ và thiếu «Ký qua» thì báo lỗi rõ [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.tools.esign-node.test.ts » công ty TẮT ⇒ chạy như cũ: gửi qua provider cũ, bước kiểu mới không có provider ⇒ ONDOC_NOT_ENABLED, provider ondoc ⇒ ONDOC_NOT_ENABLED]
- Kịch bản: khi vai ký chưa giao người thì báo thiếu người ký ở cả hai chế độ [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.tools.esign-node.test.ts » vai chưa giao (không có company_signers) ⇒ ESIGN_NODE_NO_SIGNER ở cả hai chế độ, không lùi về người bắt đầu lượt]

#### Yêu cầu: Chuông «Chưa giao người» cho quản trị công ty
Hợp đồng mở lượt không được vì vai chưa giao người thì quản trị công ty nhận chuông «Hợp đồng <tên> đang chờ: vai <nhãn> chưa giao người» kèm đường dẫn tới Cài đặt › Quy trình duyệt; gửi lại không nhân đôi.
- Kịch bản: khi vai chưa giao thì quản trị nhận chuông đúng nội dung và đường dẫn, người thường không nhận, không nhân đôi [test: apps/hub-api/src/modules/processes/roles/roles-migrate.int.test.ts » vai chưa giao ⇒ chuông tới quản trị công ty (không tới người thường), nội dung + link đúng, gửi lại không nhân đôi, mã không phải vai ⇒ không chuông]

#### Yêu cầu: Vai chưa giao mà còn cấu hình cũ thì chạy như trước
Quy trình có vai mà vai chưa giao người, nhưng chỗ đó còn nhóm/người cũ (mẫu Thư viện dùng qua khe, công ty gán mẫu sau ngày chuyển, quy trình đã chuyển nhưng bỏ giao), thì chạy theo cấu hình cũ, không chặn, không chuông. Chỉ quy trình kiểu mới (không còn gì cũ) mới bị chặn khi vai chưa giao. Nhóm cùng lúc có người duyệt cụ thể thì giữ người cụ thể và không tự chuyển thành vai.
- Kịch bản: khi công ty dùng mẫu qua khe không có dòng gán thì việc vẫn tạo đúng nhóm như trước [test: apps/hub-api/src/modules/processes/roles/roles-migrate.int.test.ts » (a) công ty dùng mẫu Thư viện qua khe (không có company_flows, không hàng giao) ⇒ việc đúng nhóm như trước]
- Kịch bản: khi công ty được gán mẫu sau ngày chuyển thì việc vẫn tạo đúng nhóm như trước [test: apps/hub-api/src/modules/processes/roles/roles-migrate.int.test.ts » (b) công ty được gán mẫu SAU ngày migrate (có company_flows, chưa có hàng giao) ⇒ việc đúng nhóm như trước]
- Kịch bản: khi quy trình kiểu mới chưa giao vai thì vẫn bị chặn [test: apps/hub-api/src/modules/processes/roles/roles-migrate.int.test.ts » quy trình kiểu MỚI (vai, không còn cấu hình cũ) chưa giao ⇒ vẫn chặn ROLE_UNASSIGNED]
- Kịch bản: khi vai chưa giao mà còn cấu hình cũ thì giữ cũ và không chặn [test: packages/contracts/src/flow/with-roles.test.ts » Duyệt / cùng duyệt / Ký còn cấu hình cũ ⇒ giữ nguyên, báo không chặn, không còn gì cũ ⇒ chặn]
- Kịch bản: khi giao nhóm mà bước còn người duyệt cụ thể thì giữ người cụ thể [test: packages/contracts/src/flow/with-roles.test.ts » giao NHÓM mà bước còn người duyệt cụ thể ⇒ giữ người cụ thể (người thắng như engine cũ)]
- Kịch bản: khi bước có cả nhóm lẫn người duyệt cụ thể thì migration bỏ qua, không thêm vai [test: apps/hub-api/src/modules/processes/roles/roles-migrate.int.test.ts » def cũ (nhóm, nhóm cùng duyệt, chuyển cấp, người duyệt, Ký 1 nhóm) ⇒ có vai + giao việc đúng, trường cũ GIỮ, mẫu dlc, Ký nhiều người, lượt đang chạy không đổi]

## Việc còn lại
- (Soát Opus vòng 1, đã sửa) #1 vai chưa giao + còn cấu hình cũ ⇒ dùng cũ (`withRoles`: `hasOld`, báo `blocking:false`); #2 migration bỏ qua chỗ nhiều đích cũ + `mainRole` giữ `approver_user_id`; #3 nhãn «Người ký hợp đồng» cố định cho chuông; #4 `lock_timeout 5s` / `statement_timeout 120s`; #6 chuyển cấp còn đích cũ ⇒ giữ như trước (không về Toàn quyền); #7 preview đếm công ty qua khe (`process_routing_rules`) + khe mặc định. Migration giao việc cho cả công ty có luật khe (`process_routing_rules`).
- Bước kiểu mới (không còn «Ký qua» cũ) mà công ty TẮT ký trên tài liệu ⇒ tool ném `ONDOC_NOT_ENABLED` (staging đã cho `esignConfigIssues` bỏ đòi provider khi có vai).
- Chạy `cr182-migrate-preview --i-know-prod` trên prod do điều phối/người dùng quyết (chưa tự chạy); xem danh sách «Mơ hồ» để quản trị gom nhóm người ký.
- Soát Opus: migration 0160 + lõi bước Ký (`effectiveCfg`, `withRoles({ondoc})`).
- Chưa có e2e chạy engine đầy đủ (HĐ mở lượt bị chặn ⇒ chuông; công ty bật ⇒ ký ondoc theo vai): cr182-qc.
- Màn xem quy trình (`readCurrentFlows`) vẫn giải vai KHÔNG kèm công tắc `ondoc` ⇒ nhãn «Ký qua» hiển thị theo cấu hình cũ (chỉ hiển thị, lúc chạy đúng).
- Lỗi có sẵn ngoài phạm vi: `pmsg-db.int.test.ts:412` tsc.
