---
id: cr125-ux-s7-partner-enable
lát: cr125-ux-s7-partner-enable
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: UX-S2 (phần Cài đặt công ty gắn vào `ReceiveSettings`, không chạm AppsPane/SlotCard/FlowCurrentPane)
---
## Plan (ngắn)
H7 (`docs/specs/CR-125/ux-review-ceo.md`): «Đối tác xác nhận hợp đồng» không bật được từ giao diện, 5 điều kiện ẩn. Một luật thuần `partnerChecklist`
(contracts) gộp hai nguồn: admin-api (hồ sơ, danh bạ, entitlement) + Hub (kênh, flow nhận/gửi, nhóm xác nhận). Platform: thẻ ở Công ty › Ứng dụng
(công tắc + từng điều kiện + «Làm bước này»). Công ty: khối trạng thái ở Cài đặt (chỉ xem, nói ai phải làm).

## Làm
- `packages/contracts/src/modules/partner-confirm.ts`: luật thuần (điều kiện, trạng thái, ai làm, fix) + unit.
- Hub `GET /tenants/:tid/partner-confirm/readiness` (`partner-confirm.service.ts`): tái dùng `listCompanyFlows` + `readinessOf` (nhóm mẫu thiếu), 3 câu SQL cố định.
- admin-api `GET|PUT /admin/tenants/:id/partner-confirm`: GET platform + quản trị CHÍNH công ty; PUT {on} chỉ platform, gọi đúng `grantEntitlement`/`revokeEntitlement`.
- admin-web: thẻ `PartnerConfirmCard` ở tab Ứng dụng; bỏ công tắc add-on trùng khỏi bảng (một khái niệm = một control). Nút làm hộ = đường có sẵn:
  cấp tính năng, Gán mẫu (company-flows), Tạo nhóm (template-fixes); «Mở Hồ sơ/Quy trình» chuyển tab.
- workspace-web: `PartnerConfirmStatus` gắn trong `ReceiveSettings` (hiện cả khi tắt).
- e2e hành trình: `e2e/journey-approval/cr125-ux-s7-partner-enable.spec.ts` (+ 2 công ty `s7a`/`s7b` ở `_ja-stack.ts`).

## Không làm / Chạm
- Không chạm engine, DLC, card danh sách HĐ, AppsPane/SlotCard/FlowCurrentPane. Quyền cấp tính năng vẫn chỉ platform.
- Không tự bật «cho phép tìm thấy» / tạo thành viên nhóm hộ công ty (việc của quản trị công ty); hồ sơ pháp lý: nút «Mở Hồ sơ».

## Test tối thiểu
- unit `partner-confirm.test.ts`; int admin-api `partner-confirm.int.test.ts` (gồm: quản trị công ty không cấp được); int Hub `partner-confirm.int.test.ts`; một e2e hành trình thật.

## Quyết định trong lúc làm
- Hub không đọc được hồ sơ công ty (PII, 0036) ⇒ admin-api là chỗ gộp; Hub không trả lời ⇒ mục Hub «chưa rõ», không lỗi cả màn.
- «Sẵn sàng» = đủ điều kiện cả gửi lẫn nhận; công ty chỉ nhận vẫn thấy «còn 1 điều kiện» (quy trình gửi) — nói rõ, không giấu.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### ADDED sht/gui-doi-tac-dieu-kien-bat.md
#### Yêu cầu: Platform bật/tắt Đối tác xác nhận hợp đồng từ giao diện, kèm danh sách điều kiện
Công ty › Ứng dụng có thẻ «Đối tác xác nhận hợp đồng»: công tắc + mỗi điều kiện (Sổ Hợp Tác, tính năng, kênh hệ thống, hồ sơ pháp lý, cho phép tìm thấy, quy trình nhận, nhóm xác nhận, quy trình gửi) có trạng thái, lý do, ai làm; nền tảng làm hộ được thì có nút «Làm bước này».
- Kịch bản: khi nền tảng bật/tắt thì tính năng được cấp/thu hồi đúng công ty, có audit, danh sách đổi theo [test: apps/admin-api/src/modules/partner-confirm/partner-confirm.int.test.ts » platform bật/tắt qua đúng service entitlement: danh sách đổi theo, audit grant/revoke đúng công ty, công ty khác nguyên trạng]
- Kịch bản: khi thiếu điều kiện thì mỗi dòng nêu ai làm và nút làm hộ nếu có [test: packages/contracts/src/modules/partner-confirm.test.ts » chưa cấp tính năng ⇒ tắt, nêu nút bật và AI làm (nền tảng)]
- Kịch bản: khi Hub không trả lời thì các mục của Hub «chưa rõ», không coi là sẵn sàng [test: packages/contracts/src/modules/partner-confirm.test.ts » Hub không trả lời ⇒ mục của Hub 'chưa rõ', chưa coi là sẵn sàng]
- Kịch bản: khi platform bật qua giao diện thì công ty gửi được và đối tác thấy, xác nhận được [test: e2e/journey-approval/cr125-ux-s7-partner-enable.spec.ts » 1 · platform admin bật Đối tác xác nhận bằng giao diện: điều kiện hiện đúng trạng thái, bấm Làm bước này]

#### Yêu cầu: Quyền cấp tính năng Đối tác xác nhận chỉ thuộc quản trị nền tảng
Quản trị công ty xem được điều kiện của công ty mình (công ty khác 404) nhưng không cấp/thu hồi được.
- Kịch bản: khi quản trị công ty gọi PUT thì 403 và không có entitlement hay audit mới [test: apps/admin-api/src/modules/partner-confirm/partner-confirm.int.test.ts » quản trị công ty KHÔNG cấp được: PUT ⇒ 403 (kể cả công ty của mình), không entitlement, không audit, công ty khác cũng không]
- Kịch bản: khi quản trị công ty xem thì chỉ công ty mình [test: apps/admin-api/src/modules/partner-confirm/partner-confirm.int.test.ts » quản trị công ty XEM được công ty mình (GET 200), công ty khác ⇒ 404]

#### Yêu cầu: Hub báo kênh, quy trình nhận/gửi và nhóm xác nhận của công ty
- Kịch bản: khi công ty chưa có gì thì Hub trả mẫu nhận để gán và nhóm thiếu [test: apps/hub-api/src/modules/processes/library/partner-confirm.int.test.ts » công ty trắng: có mẫu nhận để gán, chưa có flow, nhóm phong-kinh-doanh chưa có]
- Kịch bản: khi quản trị công ty khác hỏi thì 404 [test: apps/hub-api/src/modules/processes/library/partner-confirm.int.test.ts » quyền: quản trị công ty khác hỏi công ty X ⇒ 404 (không lộ), quản trị chính công ty ⇒ 200]

#### Yêu cầu: Cài đặt của công ty cho thấy Đối tác xác nhận đang bật hay tắt và điều kiện còn thiếu
Cài đặt (Sổ Hợp Tác) hiện trạng thái thật, điều kiện, ai phải làm; không có công tắc ẩn.
- Kịch bản: khi quản trị công ty mở Cài đặt thì thấy trạng thái và ai làm, không có công tắc [test: e2e/journey-approval/cr125-ux-s7-partner-enable.spec.ts » 2 · quản trị công ty chỉ xem: thấy trạng thái thật, không có công tắc bật/tắt hay nút làm hộ]

## Việc còn lại
- Chạy int + e2e trên evotest (-Dirty); relock `tests/.lock` đã chạy; không `slice:merge` (điều phối làm).
