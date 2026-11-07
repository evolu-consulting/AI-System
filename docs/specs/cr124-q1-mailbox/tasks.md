---
id: cr124-q1-mailbox
lát: cr124-q1-mailbox
cr: CR-124
làn: đầy đủ (RLS/cách ly tenant)
migration: hub 0117_partner_mailbox (when 1806600000000)
phụ thuộc:
---
## Plan (ngắn)
Lõi liên công ty của CR-124 (spec §7, §8b, NFR-01/02/03, §13): bảng `hub.partner_mailbox` không policy cho gói/user, 3 hàm
SECURITY DEFINER, bộ chuyển theo lô trong module mới `apps/hub-api/src/modules/partners/`, test cách ly + idempotent + perf.

## Làm
- [x] hub 0117: bảng + CHECK + index (`(status, created_at)`, `(from_tenant, created_at)`, `(to_tenant, created_at)`, token_hash unique), RLS chỉ policy `hub_rw` scope system; `hub_rw` chỉ SELECT/UPDATE (không INSERT).
- [x] `hub.partner_send` / `hub.partner_reply` / `hub.partner_mailbox_mine`: search_path cố định, REVOKE PUBLIC, EXECUTE cho `hub_rw` (+ `contracts_rw` nếu role đã có).
- [x] Bộ chuyển `partners/mailbox-mover.ts` (`partnerMoveOnce`, `startPartnerMover`) + SQL `partners/adapters/mailbox-mover.repo.ts`; nối ở `processes.mount.ts` sau `startFlowDispatcher`, cờ `HUB_PARTNER_MAILBOX=on` (mặc định tắt).
- [x] Test: `partners/mailbox.int.test.ts`, `partners/mailbox-mover.perf.int.test.ts`, `partners/domain/mailbox-events.rules.test.ts`.

## Không làm / Chạm
Không UI, trang email, danh bạ, node manifest, HĐ nhận (q2–q5). Không sửa admin-web/workspace-web, migration gói contracts, DLC, canvas.

## Test tối thiểu
`bun run test:int:par apps/hub-api/src/modules/partners/mailbox.int.test.ts` · perf: `PERF=1 bun --env-file=.env.local --config=bunfig.perf.toml test apps/hub-api/src/modules/partners/mailbox-mover.perf.int.test.ts` · unit `bun test apps/hub-api/src/modules/partners/domain`.

## Quyết định trong lúc làm
- Bộ chuyển ghi `hub.flow_events` THẲNG ở scope system (policy system có sẵn của 0105), cùng khoá `(tenant_id, event_id)` + `ON CONFLICT DO NOTHING` như `hub.emit_flow_event` — gọi `emit_flow_event` cần đặt `app.tenant_id` từng dòng ⇒ phá "số câu cố định mỗi lô" (Luật 4c).
- event_id: `partner:<mailbox.id>` (contract.received, tenant B, ref = mailbox.id) và `partner:<mailbox.id>:reply` (partner.<outcome>, tenant A, ref = `from_ref`).
- Thêm cột `from_ref` (ref bản ghi phía A, chỉ trả cho A qua `mine`), `replied_at`, `reply_emitted_at` (chốt đã phát kết quả; giữ `status = replied` cho thẻ).
- `partner_reply` gọi lại cùng kết quả + nguồn ⇒ FALSE (idempotent cho OutcomeHandler chạy lại); kết quả khác / hết hạn / đóng ⇒ 55000; không thấy hoặc sai tenant ⇒ 42501 (không lộ dòng tồn tại); nguồn `email` ⇒ 0A000 (TODO q5 đường token).
- Kênh `manual` cần `evidence.files` ≥ 1; `evidence.recorded_by` = `app.user_id`.
- Soát bảo mật (Opus, 5bd851090) — sửa: (a) `hub.partner_links {from_tenant, to_tenant, accepted_at, blocked_at}` (RLS chỉ system, chưa có hàm ghi) — `partner_send` kênh nền tảng cần nối đã chấp nhận, chưa nối/chặn ⇒ 42501; nhỏ nhất đủ chặn spam, q2/q3 thêm lời mời nối + chấp nhận/chặn (§5); (b) manual cần `app.user_id`, `evidence.recorded_by` luôn ghi đè; (c) bằng chứng ≤ 64 KB, ≤ 20 tệp (CHECK + 22023); (d) CHECK `channel = 'platform' OR to_tenant IS NULL`, receiver_flow chỉ kênh platform.
- **prod: giữ `HUB_PARTNER_MAILBOX=off` tới khi q2/q3 xong.**
- "Chỉ người phụ trách HĐ / quản trị gói" được ghi nhận thủ công (§8b) là kiểm ở tầng app (q3); hàm chỉ khoá theo tenant gửi + có người ghi.
- `actor_id` của sự kiện = null (q3 quyết người chạy flow nhận; dispatcher hiện ghi `no_actor` nếu có flow khớp).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/flow-runtime.md
#### Yêu cầu: Hộp thư liên công ty (CR-124 FLOW4-NFR-01/02/03)
Lần gửi HĐ giữa hai công ty là một dòng `hub.partner_mailbox` chỉ chứa bản chia sẻ; role gói và request người dùng không đọc/ghi thẳng bảng, chỉ qua `hub.partner_send` (bên gửi = tenant hiện tại), `hub.partner_reply` (bên nhận qua quy trình nhận, hoặc bên gửi ghi nhận thủ công) và `hub.partner_mailbox_mine` (chỉ cột trạng thái của dòng mình). Bộ chuyển theo lô (scope system, SKIP LOCKED, 3 câu SQL mỗi lô) phát `contract.received` vào tenant nhận và `partner.confirmed|returned|declined` vào tenant gửi, mỗi lần gửi đúng một sự kiện mỗi chiều.
- Kịch bản: khi role gói hoặc scope user đọc/ghi bảng hộp thư thì bị chặn [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » role gói và scope user không đọc/ghi thẳng bảng]
- Kịch bản: khi gửi với from_tenant khác tenant hiện tại thì lỗi 42501 [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » partner_send giả from_tenant / chưa đặt tenant ⇒ 42501]
- Kịch bản: khi trả lời từ tenant không phải bên nhận thì lỗi 42501, mỗi bên chỉ thấy dòng của mình [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » partner_reply sai tenant ⇒ 42501, mine chỉ thấy dòng của mình, không lộ from_ref cho bên nhận]
- Kịch bản: khi gửi qua nền tảng tới công ty chưa chấp nhận nối hoặc đã chặn thì lỗi 42501 [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » kênh nền tảng chỉ khi bên nhận đã chấp nhận nối (chưa nối / đã chặn ⇒ 42501)]
- Kịch bản: khi bên gửi ghi nhận thủ công kèm bằng chứng thì lần gửi thành đã trả lời, người ghi lấy từ phiên đăng nhập, bên nhận không ghi được [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » ghi nhận thủ công chỉ bởi bên gửi có người ghi, kênh manual cần 1–20 tệp bằng chứng, gọi lại cùng kết quả ⇒ false]
- Kịch bản: khi hai Hub cùng chạy bộ chuyển hoặc chạy lại thì chỉ một sự kiện nhận và một sự kiện kết quả [test: apps/hub-api/src/modules/partners/mailbox.int.test.ts » hai worker + chạy lại ⇒ đúng một contract.received (bên nhận) và một partner.returned (bên gửi)]
- Kịch bản: khi lô 5 hay 100 dòng thì số câu SQL như nhau [test: apps/hub-api/src/modules/partners/mailbox-mover.perf.int.test.ts » số câu SQL mỗi lô không phụ thuộc số dòng]

## Việc còn lại
- q2: kiểm "cho phép tìm thấy" + nối (§4/§5) + hạn mức trong `partner_send` (TODO trong hàm).
- q3: migration gói contracts cấp `EXECUTE` 3 hàm cho `contracts_rw` (gói migrate sau hub ⇒ khối GRANT 0117 bỏ qua trên DB mới); khai `contract.received`/`partner.*` trong manifest (dispatcher hiện chốt `unknown_event`); tạo HĐ nhận + actor cho flow nhận; nối `partner.*` vào `wait_event` của run A.
- q5: đường token email (`partner_reply` nguồn `email` đang 0A000).
- Hết hạn (`expired`) chưa có vòng chuyển trạng thái — nhánh Hết hạn dùng `timeout_h` của node chờ.
- Đo perf (local, lô 100): câu SQL/lô = 3 (5 dòng = 100 dòng); 2000 dòng / 22 lô p50 10.2 ms, p95 17.4 ms, max 17.6 ms.
