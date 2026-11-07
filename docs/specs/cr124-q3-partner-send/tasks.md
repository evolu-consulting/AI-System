---
id: cr124-q3-partner-send
lát: cr124-q3-partner-send
cr: CR-124
làn: đầy đủ (RLS/tenant, hộp thư liên công ty) — Opus soát diff RLS/grant sau
migration: hub 0119 (when 1806800000000) · contracts pack 0085 (when 1806800100000) + 0086 (when 1806800200000, VALIDATE tách riêng)
phụ thuộc: q1 (hub 0117), q2 (hub 0118), CR-125 m1/m2/m3
---
## Plan (ngắn)
Node «Gửi đối tác xác nhận» xây trên khuôn module CR-125 (`module:new contracts partner-send`): khai báo + cổng zod ở contracts, binding + tool ở hub-api,
cổng `PartnerMailboxPort` ở kit để bộ chuyển hộp thư (hub `partners/`, q1) nhờ gói Hợp đồng tạo HĐ nhận và báo kết quả về node chờ.

## Làm
- contracts: `modules/contracts/partner-send/{node,config}.ts` (4 đầu ra: Đã xác nhận · Trả lại sửa · Từ chối · Hết hạn; stage tool `real_action` + `wait_event partner.confirmed` also `returned|declined`, 168h); manifest thêm sự kiện `contract.received` (bên nhận) + tín hiệu `partner.*`.
- hub 0119: `hub.partner_self()` / `partner_route(mst)` / `partner_inbox_take(n)` (DEFINER, kiểm `app.tenant_id`, REVOKE PUBLIC).
- contracts 0085: `contracts.partner_sends` (bên gửi, tối đa 1 dòng `open` mỗi HĐ ⇒ idempotent) + `contracts.partner_inbox` (HĐ nhận, bản chia sẻ), RLS tenant, cấp EXECUTE hub.partner_* cho `contracts_rw`, nới `contracts_deal_source_ck` thêm `partner_inbox` (NOT VALID; 0086 VALIDATE riêng).
- hub-api: tool `contracts-partner-send` (tự chọn kênh nền tảng/email/thủ công; gửi lại sau Trả lại ⇒ vòng N + `prev_id`), binding `nodes/partner-send/binding.ts`, `partner-mailbox.mount.ts` (đăng ký cổng + tool), OutcomeHandler `contract.received` ⇒ `hub.partner_reply('receiver_flow')`, FactsReader thêm `importance/sender_verified/contract_type`.
- bộ chuyển: có cổng gói ⇒ nhận theo từng tenant nhận (3 câu cố định mỗi lô), trả lời ⇒ gói đóng lần gửi + `signalEvent`; không cổng ⇒ đường q1 giữ nguyên. `HUB_PARTNER_MAILBOX` vẫn tắt mặc định.

## Không làm / Chạm
Không canvas admin-web, không file esign (m4), không process-real-rule (m5), không DLC, không token/trang email (q5), không UI (q4).

## Test tối thiểu
unit: `partner-send.rules.test.ts`, `partner-inbox.repo.test.ts` (3 câu/lô), `partner-mailbox.mount.test.ts` (sổ module), `partner-send/node.test.ts`; int (evotest, một lần): `partner-mailbox.int.test.ts` + `mailbox.int.test.ts` + `contract-flow.int.test.ts`.

## Quyết định trong lúc làm
- 4 đầu ra (có Trả lại sửa) theo spec §3/FR-02, không 3 như brief.
- `requires: { before: "approval" }` khai ở `node.ts` (m5 đã merge): spec FLOW4-FR-01 đặt node SAU Duyệt (gửi ra ngoài công ty chỉ khi HĐ đã duyệt).
- Nhóm node `partner` («Đối tác») thêm vào NODE_GROUPS. Khoá tính năng vẫn `contracts-write`: `contracts-partner-confirm` cần feature mới trong danh mục admin (migration admin + addon + i18n) — chờ điều phối giao số.
- Chưa nối (`link` pending): gửi lời mời nối (idempotent) rồi đi kênh dự phòng email/thủ công; «giữ lần gửi tới khi B chấp nhận» để q4.
- Lý do Trả lại/Từ chối của flow nhận: `OutcomeInput` không mang lý do ⇒ dùng lý do dự phòng (q4: lấy lý do người duyệt).
- Mức quan trọng ngưỡng mặc định 500 triệu / 2 tỷ (hằng); công ty nhận đặt ngưỡng riêng = q4.
- PDF: `file_ref`/`pdf_sha256` ghi vào hộp thư/bản ghi nhận; chép sang FileBox của B + băm SHA-256 chưa làm (cần client FileBox liên org) — việc dở.
- `required: false` cho `contract.received` tới khi có 2 mẫu Thư viện (FLOW4-FR-10) — q4.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/gui-doi-tac-xac-nhan.md
#### Yêu cầu: Node «Gửi đối tác xác nhận» tạo lần gửi và tự chọn kênh
Một node, tool gửi chạy trong tx của tenant gửi, tạo đúng một lần gửi mở cho mỗi HĐ; công ty nhận đã nối ⇒ kênh nền tảng, không thì email (có email) hoặc ghi nhận thủ công.
- Kịch bản: khi đối tác trên nền tảng đã nối thì lần gửi đi kênh nền tảng và gọi lại không gửi đôi [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » đã nối ⇒ kênh nền tảng]
- Kịch bản: khi đối tác chưa trên nền tảng thì có email ⇒ email, không email ⇒ thủ công [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » công ty chưa trên nền tảng + có email ⇒ email]
- Kịch bản: khi chọn kênh theo trạng thái nối thì luật thuần cho đúng kênh và lý do [test: apps/hub-api/src/modules/packs/contracts/domain/partner-send.rules.test.ts » đã nối ⇒ nền tảng]
#### Yêu cầu: Bên nhận có bản ghi riêng và mức quan trọng do bên nhận quyết
Bộ chuyển mở tx trong scope tenant nhận, tạo HĐ nhận `source='partner_inbox'` + `contract.received` cùng tx; mức cuối = max(gợi ý bên gửi, luật theo giá trị); chạy lại không đôi.
- Kịch bản: khi bộ chuyển chạy thì B có HĐ nhận riêng và sự kiện, A không có dòng nào của B, chạy lại không tạo thêm [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » bộ chuyển tạo HĐ nhận riêng của B + contract.received]
- Kịch bản: khi nhận lô bất kỳ cỡ thì đúng 3 câu SQL [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-inbox.repo.test.ts » 1 dòng và 100 dòng đều đúng 3 câu]
#### Yêu cầu: Kết thúc flow nhận tự thành câu trả lời; kết quả quay về node chờ
Kết thúc của flow nhận (Đồng ý / Trả lại / Từ chối) gọi `hub.partner_reply`; bộ chuyển đóng lần gửi và bắn `partner.<kết quả>` cho node chờ đúng một lần.
- Kịch bản: khi flow nhận kết thúc Trả lại thì lần gửi đóng và node chờ nhận `partner.returned` một lần [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » Kết thúc flow nhận = Trả lại ⇒ lần gửi đóng + tín hiệu partner.returned đúng một lần]
- Kịch bản: khi A gửi lại sau Trả lại thì vòng 2 mang lý do lần trước và không tạo lời mời nối mới [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » gửi lại sau Trả lại ⇒ vòng 2]
#### Yêu cầu: Khai báo node và sổ module đủ binding
Node có 4 đầu ra khớp stage chờ; sổ module không báo thiếu binding/tool/cổng/sự kiện.
- Kịch bản: khi đọc khai báo node thì 4 đầu ra khớp stage chờ và cổng cấu hình hợp lệ [test: packages/contracts/src/modules/contracts/partner-send/node.test.ts » đầu ra: mỗi khoá `on` là sự kiện của stage chờ hoặc timeout]
- Kịch bản: khi đủ binding thì sổ module không lỗi, thiếu thì báo đúng mã [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.mount.test.ts » đủ binding (tool + node + facts/outcome) ⇒ 0 lỗi module cho node gửi đối tác]
#### Yêu cầu: Cách ly tenant cho bảng mới
`contracts.partner_sends` và `contracts.partner_inbox` chỉ thấy trong tenant của mình; gói không đọc thẳng hộp thư.
- Kịch bản: khi tenant B đọc `partner_sends` của A thì 0 dòng [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » partner_sends: tenant B không thấy lần gửi của A]
- Kịch bản: khi tenant A đọc `partner_inbox` của B hoặc lấy thư của B thì 0 dòng [test: apps/hub-api/src/modules/packs/contracts/partner-mailbox.int.test.ts » partner_inbox: tenant A không thấy HĐ nhận của B]

## Việc còn lại
- q4: UI panel node + thẻ 3 dòng; nhóm «Đối tác» + khoá `contracts-partner-confirm`; giữ lần gửi tới khi B chấp nhận nối; ngưỡng mức theo công ty nhận; lý do của người duyệt; 2 mẫu Thư viện nhận + `required: true`; nút «Ghi nhận kết quả đối tác» (gọi `hub.partner_reply('manual')`, hàm đã có từ q1).
- q5: kênh email (token, trang xem, rate limit) — dòng `channel='email'` đã được tạo, chưa có người gửi/nhận.
- Chép PDF sang FileBox của B + băm SHA-256; `requires: { before: "approval" }` khi m5 merge; hết hạn (nhánh Hết hạn dùng timeout của wait_event; trạng thái hộp thư `expired` chưa có job).
