# Engine · FlowRuntime của kit (contract + endpoint chung)

Cập nhật: 2026-11-04 · Nguồn: CR-118 (cr118-flow-contract). Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Contract view model flow tại khe (UW-FR-10, UW-FR-12) (nguồn: cr118-flow-contract)
`@ai/contracts/flow` mô tả FlowView (khe, ref, lượt + snapshot_version, trạng thái chung, bước theo loại review|dify|esign|form|wait|system, task đang mở + hành động có đầu vào định kiểu), FlowForm (tập con cố định ≤ 20 trường, nhãn text thuần, không HTML/biểu thức), FlowActionRequest/Result, FlowSummary (lô ≤ 100). Map renderer thiếu một loại bước là lỗi typecheck.
- Kịch bản: khi FlowView có đủ mọi loại bước và mọi kiểu đầu vào hành động đi qua JSON thì parse lại ra y hệt [test: packages/contracts/src/flow/flow.test.ts » FlowView round-trip]
- Kịch bản: khi form có nhãn HTML, trường lạ, khoá trùng hoặc > 20 trường thì bị từ chối [test: packages/contracts/src/flow/flow.test.ts » form: nhãn HTML]
- Kịch bản: khi giá trị gửi lên có trường ngoài form snapshot, vượt giới hạn hoặc thiếu bắt buộc thì validator từ form từ chối [test: packages/contracts/src/flow/flow.test.ts » validator từ form snapshot]
- Kịch bản: khi map renderer thiếu một loại bước thì typecheck báo lỗi [test: packages/contracts/src/flow/flow.test.ts » renderer map exhaustive]
#### Yêu cầu: Endpoint flow chung của kit (UW-FR-11, UW-FR-14) (nguồn: cr118-flow-contract)
`GET /pack/:k/flow/:slot/:ref`, `POST /pack/:k/flow/:slot/:ref/tasks/:id/actions/:action`, `POST /pack/:k/flow/:slot/summary` sau packGuard (read/write), bật bằng `HUB_FLOW_RUNTIME=on` (mặc định tắt ⇒ 404). Gói cung cấp FlowSlotAdapter; ref tra trong tx tenant của gói (không thấy ⇒ vắng/404). Đối tác bị chặn (403). Summary: số câu SQL cố định mỗi lô, p95 ≤ 50 ms lô 100.
- Kịch bản: khi cờ không bật thì runtime tắt [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » cờ: mặc định TẮT]
- Kịch bản: khi đối tác gọi view/act/summary thì bị chặn trước khi gói được gọi [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » runtime: đối tác ⇒ forbidden; tests/acceptance/CR118/approval-flow-runtime.int.test.ts » đối tác (user ngoài acme)]
- Kịch bản: khi người tenant khác gọi view/act/summary HĐ acme thì 403/404, không lộ dữ liệu [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » tenant khác (Db, beta)]
- Kịch bản: khi summary lô 100 có ref tenant khác/không tồn tại thì chỉ trả HĐ thấy được; lô 101 ⇒ 400 [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » summary lô 100]
- Kịch bản: khi summary lô 1 hay 100 thì đúng một câu SQL [test: apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » repo summary: số câu SQL cố định]
- Kịch bản: khi summary lô 100 HĐ có lượt duyệt qua HTTP thì p95 ≤ 50 ms [test: tests/acceptance/CR118/approval-flow-summary.perf.int.test.ts » summary lô 100 HĐ có lượt duyệt]
#### Yêu cầu: Khe contracts.approval qua FlowRuntime (UW-FR-13) (nguồn: cr118-flow-contract)
Adapter bọc thẻ duyệt hiện có: FlowView = chiếu của thẻ (`GET …/approval`) cho cùng người xem; hành động qua flow = hành động thẻ (quyền bước do engine/máy trạng thái); task id không khớp task đang mở ⇒ 409.
- Kịch bản: khi chiếu các thẻ mẫu CF (engine 2 bước, Dify, Ký số, duyệt cuối, kẹt, máy cũ) thì mọi trường thẻ có mặt ở FlowView [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-view.rules.test.ts » tương đương]
- Kịch bản: khi A/B/H xem HĐ đang duyệt trên engine thì GET flow == chiếu thẻ duyệt của chính họ [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » GET FlowView == chiếu thẻ]
- Kịch bản: khi bấm với task cũ thì 409; Duyệt đúng task thì bước kế mở [test: tests/acceptance/CR118/approval-flow-runtime.int.test.ts » act qua flow; apps/hub-api/src/modules/packs/contracts/application/approval-flow-slot.usecase.test.ts » act: task cũ]

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Hộp thư liên công ty (CR-124 FLOW4-NFR-01/02/03) (nguồn: cr124-q1-mailbox)
Lần gửi HĐ giữa hai công ty là một dòng `hub.partner_mailbox` chỉ chứa bản chia sẻ; role gói và request người dùng không đọc/ghi thẳng bảng, chỉ qua `hub.partner_send` (bên gửi = tenant hiện tại), `hub.partner_reply` (bên nhận qua quy trình nhận, hoặc bên gửi ghi nhận thủ công) và `hub.partner_mailbox_mine` (chỉ cột trạng thái của dòng mình). Bộ chuyển theo lô (scope system, SKIP LOCKED, 3 câu SQL mỗi lô) phát `contract.received` vào tenant nhận và `partner.confirmed|returned|declined` vào tenant gửi, mỗi lần gửi đúng một sự kiện mỗi chiều.
- Kịch bản: khi role gói hoặc scope user đọc/ghi bảng hộp thư thì bị chặn [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » role gói và scope user không đọc/ghi thẳng bảng]
- Kịch bản: khi gửi với from_tenant khác tenant hiện tại thì lỗi 42501 [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » partner_send giả from_tenant / chưa đặt tenant ⇒ 42501]
- Kịch bản: khi trả lời từ tenant không phải bên nhận thì lỗi 42501, mỗi bên chỉ thấy dòng của mình [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » partner_reply sai tenant ⇒ 42501, mine chỉ thấy dòng của mình, không lộ from_ref cho bên nhận]
- Kịch bản: khi gửi qua nền tảng tới công ty chưa chấp nhận nối hoặc đã chặn thì lỗi 42501 [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » kênh nền tảng chỉ khi bên nhận đã chấp nhận nối (chưa nối / đã chặn ⇒ 42501)]
- Kịch bản: khi bên gửi ghi nhận thủ công kèm bằng chứng thì lần gửi thành đã trả lời, người ghi lấy từ phiên đăng nhập, bên nhận không ghi được [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » ghi nhận thủ công chỉ bởi bên gửi có người ghi, kênh manual cần 1–20 tệp bằng chứng, gọi lại cùng kết quả ⇒ false]
- Kịch bản: khi hai Hub cùng chạy bộ chuyển hoặc chạy lại thì chỉ một sự kiện nhận và một sự kiện kết quả [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » hai worker + chạy lại ⇒ đúng một contract.received (bên nhận) và một partner.returned (bên gửi)]
- Kịch bản: khi lô 5 hay 100 dòng thì số câu SQL như nhau [test: apps/hub-api/src/modules/partners/mailbox-mover.perf.int.test.ts » số câu SQL mỗi lô không phụ thuộc số dòng]

#### Yêu cầu: Khởi động dừng khi node khai đầu ra mà máy chủ không ghi (nguồn: cr125-m8-io-ports)
Binding khai các khoá đầu ra máy chủ thật sự ghi; khai báo và binding lệch (thiếu, thừa, hoặc còn đánh dấu chờ) ⇒ MOD_OUTPUT_UNBOUND, hub không lên, câu tiếng Việt nói node, cổng và file cần sửa. Bước Duyệt ghi thêm góp ý của người duyệt vào dữ liệu của bước.
- Kịch bản: binding không ghi đầu ra đã khai ⇒ «Khởi động dừng» kèm câu MOD_OUTPUT_UNBOUND [test: apps/hub-api/src/modules/packs/kit/adapters/module-registry.test.ts » MOD_OUTPUT_UNBOUND (CR-125 m8)]
- Kịch bản: sổ thật (core + Ký số + Gửi đối tác + Hiện bài) × binding thật ⇒ không lỗi đầu ra [test: apps/hub-api/src/modules/packs/packs.modules-outputs.test.ts » đầu ra khai báo × binding thật]
- Kịch bản: Duyệt ghi quyết định + người duyệt + góp ý (trống ⇒ không có khoá) [test: apps/hub-api/src/modules/processes/gates/approve-out.test.ts » approveFields (CR-125 m8 · đầu ra Duyệt)]
- Kịch bản: hub mount thật ⇒ verify 0 lỗi, binding Duyệt/Ký số/Gửi đối tác khai đúng đầu ra [test: apps/hub-api/src/modules/packs/packs.module-registry.int.test.ts » sổ module · mount thật]

#### Yêu cầu: Bước chờ sự kiện ghi dữ liệu kèm sự kiện vào đầu ra của bước (nguồn: cr125-m9-outputs-runstate)
Gói bắn sự kiện kèm dữ liệu (khoá snake_case, giá trị vô hướng); khi sự kiện đó thả bước chờ, dữ liệu vào đầu ra của bước trong cùng giao dịch, không ghi đè kết quả sự kiện, bắn lại không đổi gì; sự kiện khác thắng ⇒ không lẫn dữ liệu.
- Kịch bản: Ký số xong ⇒ bước chờ có thời điểm ký, người ký, mã phong bì; bắn lại không đổi; Thông báo sau đó hiện «Đã ký ngày {signed_at}» và ghi người nhận [test: tests/acceptance/CR-125/outputs-runstate.int.test.ts » Ký số xong ⇒ bước chờ có signed_at/signer/envelope_id · bắn lại không đổi · Thông báo sau đó dựng {signed_at} + ghi sent_to]
- Kịch bản: đối tác trả lại sửa ⇒ bước chờ có lần gửi + lý do; công ty khác bắn cùng bản ghi không thả [test: tests/acceptance/CR-125/outputs-runstate.int.test.ts » Gửi đối tác: trả lại sửa ⇒ bước chờ có round + partner_reason · dữ liệu của sự kiện khác không lẫn vào]
- Kịch bản: lọc dữ liệu kèm, chỉ áp cho sự kiện thắng [test: apps/hub-api/src/modules/processes/domain/timers/wait-event-data.rules.test.ts » đúng sự kiện thắng ⇒ gộp dữ liệu kèm, `event` không bị ghi đè]
- Kịch bản: phong bì trạng thái cuối ⇒ đầu ra Ký số [test: apps/hub-api/src/modules/packs/contracts/domain/esign-outputs.rules.test.ts » ký xong ⇒ envelope_id + signed_at (ngày) + người ký theo thứ tự ký]

#### Yêu cầu: Thông báo đọc đầu ra các bước trước (nguồn: cr125-m9-outputs-runstate)
Mẫu `{khoá}` của Thông báo lấy giá trị từ đầu ra các bước đứng trước và dữ liệu của lượt; Thông báo ghi người nhận (`sent_to`) vào đầu ra của bước.
- Kịch bản: `{signed_at}` lấy từ đầu ra Ký số, input thắng khi trùng khoá [test: apps/hub-api/src/modules/processes/nodes/notify/notify-vars.test.ts » `{signed_at}` lấy từ đầu ra bước Ký số · bước sau đè bước trước · input thắng khi trùng]
