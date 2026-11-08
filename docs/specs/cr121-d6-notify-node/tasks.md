---
id: cr121-d6-notify-node
lát: cr121-d6-notify-node
cr: CR-121
làn: đầy đủ (máy trạng thái run + idempotency)
migration: hub 0101 (chỉ thêm hàm `notify.enqueue_run_notices`)
phụ thuộc: cr121-d0..d2
---
## Plan (ngắn)
Phần CHẠY của D-6 (spec `docs/specs/cr121-d/spec.md` R1): node engine `notify` + mở `notify`/`wait_until` cho khe `contracts.approval`.

## Làm
- Contract: `NotifyExecutorSchema` (`hub-admin/process-notify.ts`), `EXECUTOR_KINDS += notify`, `NODE_FAMILY_OF/NODE_PRODUCES`, luật `NOTIFY_INVALID`.
- Hub node `notify` (`processes/nodes/notify/*`): chạy đồng bộ trong tx khoá run như `set`; `queued→running` có điều kiện; MỘT câu
  `enqueueRunNotice` (tìm người nhận trong công ty của run + ghi `hub.notifications` qua `notify.enqueue_run_notices`), rồi `effects` (xong bước, kick bước kế).
- Khe duyệt HĐ: loại bước `notify` ("Thông báo": người gửi duyệt / người phụ trách / phòng ban theo mã; chuông ± mail; mẫu `{ma_hd}` `{ten_hd}` `{gia_tri}`)
  và `wait_until` ("Chờ tới": ngày hết hạn / hạn xử lý HĐ ± ngày, giờ) ⇒ stage engine `notify`/`wait_until` (`after: auto`); `fromStages` dựng lại;
  `openRun` điền input HĐ (`contract-number/owner/end-date/deadline`) khi có bước này; câu sửa lỗi publish `NOTIFY_*`, `WAIT_OFFSET_RANGE`.
- Vòng chia kênh (`notify/adapters/dispatch.repo.ts`): kind `process.notify` (chỉ chuông) không tạo bản gửi mail.

## Không làm / Chạm
Editor/canvas UI, icon, i18n UI, e2e (Sonnet làm tiếp). admin-web `FE_NODES.notify` chỉ là mục tối thiểu cho typecheck (chưa hiện trong danh sách chọn).

## Test tối thiểu
- unit: `nodes/notify/notify.rules.test.ts`, `packs/contracts/domain/approval-flow-notify.rules.test.ts` (+ sửa kỳ vọng catalog/NODE_UNSUPPORTED).
- int: `tests/acceptance/CR-121/notify-node.int.test.ts` (4 ca).

## Quyết định trong lúc làm
- Outbox = `hub.notifications` (đã có vòng gửi + backoff 1′/5′/30′/2h, tối đa 5 lần) ⇒ gửi lỗi không làm kẹt run; settle không gọi mạng.
- Idempotent: `dedup_key = pn:<run>:<stage run>:<attempt>` + UNIQUE `(tenant,user,source,dedup_key)`; thêm chặn `status='queued'` khi chuyển `running`.
- Migration hub 0101 BẮT BUỘC: `notify.enqueue` cần `app.tenant_id` (kick lô/vòng hẹn chạy scope system) còn `enqueue_pack_runs` ép body rỗng + chỉ run gắn gói.
- Chuông luôn có (hàng thông báo = chuông); "email" = thêm mail theo tùy chọn người nhận.
- Chéo công ty: người nhận lọc theo `tenant_id` của RUN (SQL + hàm DEFINER), mã Group tra trong công ty của run.
- Người phụ trách = input run `contract-owner` (gói điền `owner_user_id`); Chờ tới thiếu ngày ⇒ `timer_invalid` (cần quyết) như `wait_until` cũ.
- SQL mỗi lần settle node notify = như node `set` + 1 câu (`enqueueRunNotice`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Node Thông báo (notify)
Bước `notify` gửi thông báo (chuông, tuỳ chọn mail) tới người bắt đầu lượt / user ở input / thành viên Group theo mã của CÔNG TY CỦA RUN, tiêu đề + nội dung là mẫu thay biến input; ghi hàng gửi cùng giao dịch với bước rồi xong bước ngay. Gửi trùng bị chặn theo (run, stage run, lần thử); không có người nhận ⇒ bước vẫn xong, kết quả ghi cảnh báo vì sao.
- Kịch bản: khi bước duyệt Đạt và bước sau là Thông báo thì người bắt đầu + thành viên phòng ban nhận đúng một thông báo đã thay biến, run chạy tới xong [test: tests/acceptance/CR-121/notify-node.int.test.ts » notify sau bước duyệt: Đạt ⇒ người bắt đầu + Group 'giam-doc' nhận đúng 1 lần, mẫu đã thay biến, run done]
- Kịch bản: khi ghi thông báo hai lần song song cùng khoá thì không thêm thông báo nào [test: tests/acceptance/CR-121/notify-node.int.test.ts » notify sau bước duyệt: Đạt ⇒ người bắt đầu + Group 'giam-doc' nhận đúng 1 lần, mẫu đã thay biến, run done]
- Kịch bản: khi không có người nhận thì bước vẫn xong và kết quả ghi "Cảnh báo: không có người nhận" [test: tests/acceptance/CR-121/notify-node.int.test.ts » người nhận rỗng ⇒ bước vẫn xong, .md ghi cảnh báo, 0 thông báo, kênh chỉ chuông]
- Kịch bản: khi người nhận ở input là user công ty khác thì người đó không nhận [test: tests/acceptance/CR-121/notify-node.int.test.ts » chặn chéo công ty: người phụ trách là user công ty khác ⇒ không nhận, chỉ người bắt đầu nhận]
- Kịch bản: khi lưu def có bước Thông báo thiếu người nhận/kênh/tiêu đề thì 422 `NOTIFY_INVALID` đúng trường [test: apps/hub-api/src/modules/processes/nodes/notify/notify.rules.test.ts » NOTIFY_INVALID: thiếu người nhận / kênh / tiêu đề / input người nhận chưa khai]

#### Yêu cầu: Khe duyệt HĐ hỗ trợ Thông báo và Chờ tới
Danh mục node của khe `contracts.approval` thêm "Thông báo" (`notify`) và "Chờ tới" (`wait_until`); bước tự sang bước kế (bước sau không được có điều kiện); thiếu tham số ⇒ lỗi xuất bản nói cách sửa.
- Kịch bản: khi xem danh mục node của khe thì có Thông báo và Chờ tới [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-notify.rules.test.ts » danh mục node của khe có Thông báo + Chờ tới]
- Kịch bản: khi bước Thông báo thiếu người nhận/kênh/tiêu đề hoặc Chờ tới lệch ngày ngoài ±365 thì lỗi mã `NOTIFY_*`/`WAIT_OFFSET_RANGE` [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-notify.rules.test.ts » thiếu tham số ⇒ lỗi nói cách sửa (mã), bước sau Thông báo không được có điều kiện]
- Kịch bản: khi dịch quy trình thì bước thành stage engine `notify`/`wait_until` và dựng lại đúng từ stages [test: apps/hub-api/src/modules/packs/contracts/domain/approval-flow-notify.rules.test.ts » khe: body có Thông báo/Chờ tới hợp lệ, compile rồi fromStages dựng lại đúng bước]
- Kịch bản: khi bước Chờ tới theo ngày hết hạn HĐ chưa tới hạn thì giữ chờ, tới hạn (vòng hẹn) thì chạy tiếp tới bước Thông báo [test: tests/acceptance/CR-121/notify-node.int.test.ts » bước Chờ tới của khe duyệt HĐ: hẹn theo ngày hết hạn HĐ, tới hạn (sweep) ⇒ Thông báo chạy, run done]

## Việc còn lại
Sonnet làm tiếp: editor/catalog UI (khối sửa Thông báo/Chờ tới trong trình sửa quy trình + canvas, `FE_NODES.notify` đầy đủ, icon `bell`/`clock`, i18n vi+en, nhãn `kind` notify/wait_until ở thẻ duyệt + "quy trình đang dùng" workspace-web), e2e hành trình thật (gán quy trình có Thông báo sau bước duyệt ⇒ người nhận thấy chuông).
