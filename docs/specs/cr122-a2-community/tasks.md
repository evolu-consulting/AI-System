---
id: cr122-a2-community
lát: cr122-a2-community
cr: CR-122
làn: nhanh
migration: không hub; 1 migration gói community (0010, chỉ GRANT)
phụ thuộc: E1, E1b (hub 0109), E2
---
## Plan (ngắn)
App Community bắn 3 sự kiện flow (`post.created`, `partner.join_requested`, `report.created`) CÙNG tx ghi bản ghi qua `hub.emit_flow_event`,
chỉ khi cờ `FLOW_TRIGGERS` của công ty bật; đăng ký `FactsReader` (mỗi sự kiện một reader) + `OutcomeHandler` lúc mount.

## Làm
- `domain/flow-events.rules.ts` (thuần): `event_id = <event>:<id bản ghi>`, facts đúng `community.manifest.ts`, outcome → trạng thái.
- `adapters/flow-events.repo.ts`: `emitFlowEvent` (gọi `hub.emit_flow_event`), `factsOf` (một câu/sự kiện), `apply{Post,Join,Report}Outcome`
  (so-sánh-và-đặt theo trạng thái chờ), `inCommunityRole` (handler chạy trong tx engine nhưng dưới role `community_rw` + tenant để RLS gói áp).
- `adapters/flow-ports.ts`: readers + handler. `community.mount.ts`: `triggersOn` + `registerPorts`; `community-flow.mount.ts` nối cờ hub
  (`flowTriggersOn`) và sổ đăng ký engine (`registerFactsReader/OutcomeHandler`).
- `post.service.create` / `flows.service.createJoin|createReport`: cờ bật ⇒ phát sự kiện cùng tx; bài bật cờ không chạy agent screen cũ.
- `migrations-pack-community/0010_emit_flow_event_grant.sql`: role gói tạo SAU hub 0109 ⇒ khối GRANT của 0109 bỏ qua; cấp USAGE `hub` + EXECUTE hàm.

## Không làm / Chạm
Không đụng engine/node (E2), dispatcher (E1b), packs/contracts (A1), admin-web, DLC. Cờ tắt giữ nguyên khe cũ ⇒ KHÔNG gỡ `flow-slots.ts` /
`flow-slots.rules.ts` ở lát này (gỡ ở R1 khi cờ bật toàn bộ; gỡ sớm làm đường bóng mất).

## Test tối thiểu
- unit `domain/flow-events.rules.test.ts` (3 ca).
- int `adapters/community.flow-events.int.test.ts` (5 ca): cờ tắt không sự kiện; mỗi sự kiện một đường chính + Kết thúc idempotent;
  role `community_rw` ghi được sự kiện; chặn đọc chéo tenant (reader trả null, handler `not_found`, không đổi bản ghi).

## Quyết định trong lúc làm
- Không import `insertFlowEvents` (processes) vào gói: lớp gói không phụ thuộc `processes` (boundaries); dùng thẳng hàm DB `hub.emit_flow_event`
  — cùng nguồn ghi với `insertFlowEvents` (E1b đã chuyển nó sang hàm này).
- OutcomeHandler chạy trong tx engine: tx đó là role `hub_api`, không có quyền bảng `community.*` ⇒ chuyển tạm `set_config('role','community_rw')`
  + `app.*` (đúng bộ của `withPackScope`) rồi trả lại; ném ⇒ rollback cùng lượt. Không thêm cột ledger: idempotent theo (runId, outcome) nhờ
  CAS trên trạng thái chờ (`pending`/`none` → đích); đã khác ⇒ `already_applied`, không ghi đè quyết định khác.
- Báo cáo: phát sự kiện với `report_kind/severity = null` (agent triage điền sau, vẫn chạy nền); node Nếu đọc giá trị hiện tại qua FactsReader.
- Bài: bật cờ thì `moderationOn` (opt-in cũ) vẫn quyết bài vào `pending`; bỏ agent screen (flow quyết). Bật cờ nhưng chưa opt-in ⇒ bài hiện ngay,
  outcome Ẩn vẫn ẩn được.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### ADDED community/su-kien-flow.md
#### Yêu cầu: Community bắn sự kiện flow cùng giao dịch khi cờ FLOW_TRIGGERS bật
Khi công ty bật FLOW_TRIGGERS, đăng bài, gửi đơn xin tham gia và tạo báo cáo ghi sự kiện `post.created`, `partner.join_requested`,
`report.created` (khoá `<sự kiện>:<id bản ghi>`) trong cùng giao dịch ghi bản ghi; cờ tắt thì giữ đường khe cũ và không ghi sự kiện.
- Kịch bản: cờ tắt, đăng bài ⇒ không có sự kiện, agent sàng lọc vẫn chạy [test: thủ công — file test community.flow-events.int.test.ts không còn trong repo]
- Kịch bản: cờ bật, đăng bài ⇒ một sự kiện `post.created` đúng dữ kiện [test: thủ công — file test community.flow-events.int.test.ts không còn trong repo]

#### Yêu cầu: Kết quả Kết thúc của flow đổi trạng thái bài, đơn xin tham gia, báo cáo (idempotent)
Hiện/Ẩn bài, Nhận/Từ chối đơn, Ẩn/Giữ/Cảnh báo báo cáo áp trong giao dịch của engine; gọi lại không đổi gì và không ghi đè quyết định đã có.
- Kịch bản: Nhận đơn ⇒ tạo liên kết công ty đối tác, gọi lại ⇒ không đổi [test: thủ công — file test community.flow-events.int.test.ts không còn trong repo]
- Kịch bản: Ẩn báo cáo ⇒ báo cáo đã xử lý và bài bị ẩn [test: thủ công — file test community.flow-events.int.test.ts không còn trong repo]
- Kịch bản: tenant khác không đọc dữ kiện hay đổi trạng thái [test: thủ công — file test community.flow-events.int.test.ts không còn trong repo]

## Việc còn lại
- Gỡ `flow-slots.ts`, `domain/flow-slots.rules.ts` + khe cũ: để R1 (cờ tắt còn dùng).
- Chuông "bài mới" khi flow Hiện bài: chưa phát (handler chạy trong tx engine, chuông phát sau commit) — cần móc sau-commit của engine (E2/điều phối).
- Sửa bài khi cờ bật chưa mở lại lượt duyệt (event_id theo bài, không theo lần sửa).
- M1: backfill/so lệch bóng cho community.
