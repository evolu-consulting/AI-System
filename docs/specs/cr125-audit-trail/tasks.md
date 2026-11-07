---
id: cr125-audit-trail
lát: cr125-audit-trail
cr: CR-125
làn: nhanh
migration: 0088 (index một phần stage_decided)
phụ thuộc:
---
## Plan (ngắn)
Câu hỏi: HĐ có đổi trạng thái theo flow? lượt chạy có được ghi? có audit không? Điều tra bằng code + một lượt int thật
(`apps/hub-api/src/modules/processes/triggers/audit-trail.int.test.ts`, evotest XANH 4/4), rồi vá chỗ thiếu bằng bảng/cơ chế sẵn có
(`contracts.contract_events` = lịch sử HĐ, `contracts.approval_settings_audit`, `hub.audit_log`). Không bảng audit mới.

## Câu trả lời (sự kiện × 3 lớp)
Cột 1 = `contracts.contracts.status`; cột 2 = log chạy (hub.process_runs / stage_runs / review_tasks); cột 3 = audit (ai · lúc nào · gì).
"Thấy" = hiện ở "Lịch sử thay đổi" của HĐ (`GET …/history` ← `contract_events`). Trước = trước lát này.

| Sự kiện | 1. Trạng thái HĐ | 2. Log chạy | 3. Audit / lịch sử HĐ |
|---|---|---|---|
| Gửi duyệt (`contract.submitted`) | `needs_review`, lượt `level1` (`approvals.mode='engine'`), `run_id` gắn lượt — ĐÚNG (int: `needs_review/level1`) | `process_runs` (người gửi, lúc) + `stage_runs` từng bước | `approval_started` (actor+at) — CÓ, thấy |
| Duyệt / Đạt một bước (không cuối) | không đổi (`needs_review`) — đúng | `review_tasks` đóng: `decided_by/decided_at/result/feedback`; hiện ở full view run (`loadHistory`) và thẻ "Các bước duyệt" | TRƯỚC: KHÔNG có dòng ở lịch sử HĐ. NAY: `stage_decided` {bước, approve, góp ý} + actor + at — thấy |
| Trả lại một bước / Từ chối một bước | Trả lại ⇒ lùi bước (HĐ vẫn `needs_review`); Từ chối ⇒ `rejected` (`markRejected`) — đúng | như trên (`result=fail/reject`, `feedback`) | TRƯỚC: chỉ có `rejected` khi Từ chối; Trả lại giữa chừng KHÔNG ghi. NAY: `stage_decided` {return/reject, góp ý} — thấy |
| Duyệt thay (Toàn quyền) | không đổi | task như trên | `approval_override` (write-ahead, actor+at) — CÓ, thấy |
| Kết thúc · Đã duyệt | `active` + `confirmed_at/by` + khoá, lượt `done` (`applyContractOutcome`) — đúng | run `done`, `decided_by` | `approved` {run_id, engine_run_id} + actor + at — CÓ, thấy |
| Kết thúc · Từ chối | `rejected`, mở khoá, lượt `rejected` — đúng | run kết thúc | `rejected` — CÓ. Nhãn UI TRƯỚC: "(rejected)" thô ⇒ NAY có nhãn |
| Kết thúc · Trả lại | `needs_review`, `run_id=null` (về Nháp, gửi lại được) — đúng | run kết thúc | `returned` — CÓ. Nhãn UI TRƯỚC thô ⇒ NAY có nhãn |
| Mở lại HĐ (reopen) | `needs_review` + lượt mới | run mới | `reopened` (lý do, trạng thái trước, actor) — CÓ; nhãn NAY thêm |
| Ký số · gửi | HĐ `active` (đã khoá); trạng thái bước ở `approvals.esign_status` (sending→sent) + phong bì `esign_envelopes` (người gửi, lúc, trạng thái, người ký + `signed_at`) | `esign_envelopes` là log chạy | TRƯỚC: KHÔNG có dòng ở lịch sử HĐ. NAY: `esign_sent` {nhà cung cấp, người ký} + actor |
| Ký số · đã ký / từ chối / huỷ | `approvals.esign_status` completed / needs_decision(+lý do); HĐ vẫn `active` | phong bì đổi trạng thái + `completed_at` | TRƯỚC: KHÔNG. NAY: `esign_signed` / `esign_declined` / `esign_voided` {lý do, ai ký lúc nào}; webhook gửi lại không ghi đôi |
| Ký số · đổi nhà cung cấp | không đổi | phong bì cũ `voided`, mới tạo | TRƯỚC: chỉ `approval_settings_audit` (không ở lịch sử HĐ, không gắn HĐ). NAY: thêm `esign_switched` {từ, sang} + actor; audit cũ giữ (một nguồn cấu hình) |
| Gửi đối tác | không đổi | `contracts.partner_sends` (created_by, round, kênh, trạng thái) + `hub.partner_mailbox`; email: `partner_email_events` (sent/error — nhật ký thư, có `at`, KHÔNG có actor: hệ thống gửi) | TRƯỚC: KHÔNG ở lịch sử HĐ. NAY: `partner_sent` {vòng, kênh, tới} + actor |
| Đối tác trả lời (xác nhận/trả lại/từ chối) | không đổi (HĐ gốc); kết quả ở `partner_sends.status/reason/closed_at` | `partner_sends` | TRƯỚC: KHÔNG. NAY: `partner_replied` {vòng, outcome, lý do}; chạy lại không ghi đôi |
| Nhận từ đối tác (bên B) | HĐ nhận `needs_review` (`source='partner_inbox'`) + lượt chờ flow | `partner_inbox` (mailbox_id, người gửi, vòng) | TRƯỚC: KHÔNG. NAY: `partner_received` {từ, vòng} (actor hệ thống = null) |
| Công ty bấm "Lưu và áp dụng" một flow | — | — | `hub.audit_log` (`process_def` update, actor+at, before/after) — CÓ (`defs.service.update`), xem ở Admin/Nhật ký. TRƯỚC: snapshot chỉ `name/enabled/version/stage_count` ⇒ không biết ĐỔI GÌ. NAY: thêm `steps` (khoá · tên · loại node) + `trigger` |
| Gán/bỏ gán flow, Xuất bản, Sao chép, Đặt mặc định | — | — | `hub.audit_log` (`library.service`, `routing.service`) — CÓ |
| Cài đặt duyệt/ký số/neo chữ ký của công ty | — | — | `contracts.approval_settings_audit` (actor, before, after, at) — CÓ (`company.repo`, `approval-settings.repo`, `esign*.repo`) |
| Dừng / chạy lại run, rẽ nhánh, chuyển cấp | — | `hub.audit_log` (`run-control`, `branch`) | CÓ (hub.audit_log) |

Còn thiếu (ghi lại, không làm trong lát): (a) `stage_decided` ghi SAU khi engine nhận quyết nên ở bước CUỐI nó nằm sau dòng `approved`
(cùng mili-giây) — muốn đúng thứ tự cần ghi write-ahead + hàm bù trừ như `void_override` (migration) ⇒ để lát sau; (b) "Lưu và áp dụng"
chưa hiện ở lịch sử từng HĐ (là cấu hình công ty, xem ở Nhật ký Admin); (c) email đối tác: `partner_email_events` không có người bấm gửi (hệ thống
gửi) — người bấm có ở `partner_sent`.

## Làm
- `approval-engine.repo.ts` + `approval-engine.ports.ts` + `approval-engine-card.usecase.ts`: `recordDecision` (MỘT câu) gọi sau khi engine nhận quyết.
- `esign.repo.ts`: `insert` / `update` / `audit` ghi `esign_*` cùng câu (CTE) với phong bì; update idempotent theo trạng thái trước.
- `partner-send.repo.ts` (`record`, `closeReplies`) + `partner-inbox.repo.ts` (`insertBatch`): `partner_*` cùng câu; số câu SQL mỗi lô không đổi.
- `defs.map.ts` `auditSnapshot`: thêm `steps`, `trigger`.
- UI: nhãn lịch sử (`gapa1.vi/en.json`, `contract-review/lib/manage.ts`, `fields.ts` kiểu event).

## Không làm / Chạm
Không bảng mới (chỉ index 0088); không chạm canvas. Perf: không (mỗi sự kiện thêm đúng một INSERT trong câu CTE sẵn có).

## Test tối thiểu
- int `apps/hub-api/src/modules/processes/triggers/audit-trail.int.test.ts` (evotest -Dirty XANH 4/4): Gửi duyệt → Đạt → Đã duyệt (status + lịch sử), Từ chối + lý do, ký số gửi/ký/đổi nhà cung cấp, đối tác gửi/trả lời — assert dòng DB và `getHistory`.
- unit `apps/hub-api/src/modules/processes/defs/audit-snapshot.test.ts`.
- Hồi quy: 7 file int liên quan (owner-override, approval-card, esign-switch, contract-flow, flow-approve-act, mailbox-port, esign-anchor) 27/27 XANH.
- e2e hành trình KHÔNG chạy (Luật 0b/0d.5; điều phối chạy một lần cuối đợt).

## Quyết định trong lúc làm
- Một nguồn: lịch sử HĐ = `contract_events`; không thêm bảng. Audit cấu hình giữ ở `approval_settings_audit` / `hub.audit_log`.
- `stage_decided` ghi ở tx gói RIÊNG sau khi engine nhận quyết (không cùng tx engine): lỗi ghi chỉ cảnh báo (có thể thiếu dòng), nhưng không bao giờ nhân đôi — unique index một phần `contract_events_stage_decided_uq` (migration 0088, when 1807000000000) + `on conflict do nothing` theo task. Các ghi còn lại cùng câu SQL với thay đổi trạng thái nên atomic.
- esign webhook song song: khoá hàng + đọc trạng thái trước ở câu riêng, chỉ ghi `esign_*` khi thật sự chuyển trạng thái; test chạy bằng role hệ thống của gói (cả đường nhận đối tác) ghi được `contract_events` dưới RLS.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Lịch sử HĐ ghi mọi quyết định duyệt, ký số và trao đổi với đối tác
Mỗi quyết định Đạt/Trả lại/Từ chối ở một bước duyệt, mỗi lần gửi ký / ký xong / từ chối / huỷ / đổi nhà cung cấp ký, mỗi lần gửi–nhận–trả lời đối tác đều thêm một dòng "Lịch sử thay đổi" của HĐ (người, thời điểm, nội dung); sự kiện lặp lại không ghi đôi. "Lưu và áp dụng" flow ghi `hub.audit_log` kèm danh sách bước trước/sau.
- Kịch bản: khi người duyệt Đạt bước thì lịch sử HĐ có `stage_decided` với người duyệt [test: apps/hub-api/src/modules/processes/triggers/audit-trail.int.test.ts » gửi duyệt → Đạt ở bước → Kết thúc Đã duyệt: trạng thái đúng + lịch sử có ai/lúc nào/gì]
- Kịch bản: khi người duyệt Từ chối kèm lý do thì HĐ `rejected` và lịch sử ghi lý do [test: apps/hub-api/src/modules/processes/triggers/audit-trail.int.test.ts » Từ chối ở bước (có lý do): HĐ rejected + lịch sử ghi người từ chối, lý do]
- Kịch bản: khi gửi ký, ký xong, đổi nhà cung cấp (webhook gửi lại) thì mỗi việc đúng một dòng [test: apps/hub-api/src/modules/processes/triggers/audit-trail.int.test.ts » ký số: gửi, ký xong, đổi nhà cung cấp ⇒ lịch sử HĐ, gọi lại cùng trạng thái không ghi đôi]
- Kịch bản: khi gửi đối tác và đối tác trả lời thì lịch sử có hai dòng, trả lời chạy lại không ghi đôi [test: apps/hub-api/src/modules/processes/triggers/audit-trail.int.test.ts » đối tác: gửi → trả lời (một lần) ⇒ lịch sử HĐ]
- Kịch bản: khi "Lưu và áp dụng" thêm một bước thì audit before/after khác nhau ở `steps` [test: apps/hub-api/src/modules/processes/defs/audit-snapshot.test.ts » thêm một bước ⇒ steps before/after khác nhau]

## Việc còn lại
- Thứ tự `stage_decided` vs `approved` ở bước cuối (write-ahead, cần migration) — lát sau nếu giám đốc cần.
- Hiện "Lưu và áp dụng" trong lịch sử từng HĐ đang chạy flow đó (nếu cần).
