---
id: cr132-m4
lát: cr132-m4 (M4 của CR-132 · realtime tin nhắn)
cr: CR-132
làn: nhanh
migration: không
phụ thuộc: cr132-m3 (use case + `memberIds`), W1 (client `meStream.subscribe`)
---
## Plan (ngắn)
Phát `msg.new|deleted|read|conversation` qua `ustream:<user>` (kênh `/me/stream` có sẵn) SAU commit, một pipeline Redis cho cả lô khung của một thao tác (spec `docs/specs/CR-132/spec.md` §5). Không UI (W1/W2 đã có bộ phát chung), không tệp (M5).

## Làm
- `packages/contracts`: `parseMeStreamMsgEvent` (`pack-contracts/messages.ts`), kiểu `MsgConversationChange`, re-export `chat/me-stream-msg.ts` (+ `chat/index.ts`) để hub-core lấy cùng chỗ với `process.*`/`esign.updated`.
- Hub: `lib/user-stream.ts` (`UserEvent` + `MeStreamMsgEvent`), `me-stream/user-stream-reader.ts` (`parseFields` nhận `msg.*`, `UserEntry`), `chat-gate/chat-gate.rules.ts` (`meStreamEventAllowed` cho `msg.*` kể cả công ty tắt Chat AI).
- Kit: `packStreamPublishMany(redis, log)(frames)` — MỘT `pipeline()` cho cả lô khung (`PackStreamEvent` thêm `MeStreamMsgEvent`); `packs.mount.ts` nối khi có Redis (vắng ⇒ không phát).
- `messages/domain/messages.events.ts` (luật thuần chọn người nhận + khung): `newFrames`, `deletedFrames`, `readFrames`, `conversationFrames`.
- Use case (`publish` tuỳ chọn, gọi SAU khi `uow.tenant` trả về, lỗi Redis chỉ log): `send` (chỉ khi `created`, tới mọi thành viên gồm người gửi) · `revoke` (khi `done`) · `markRead` (chỉ khi mốc TIẾN) · `rename`/`addMembers`/`removeMember`/`create` ⇒ `msg.conversation` (người vào `added`, người ra `removed`, người còn lại `updated`; một người một khung). Repo: `revoke` và `markRead` trả thêm `member_ids` (cùng câu, không thêm câu SQL); `markRead` trả `prev` để biết mốc có tiến.

## Perf
Số câu SQL mỗi request giữ nguyên (member_ids/prev nằm trong RETURNING/CTE sẵn có). Redis: 1 `pipeline` mỗi thao tác (XADD + EXPIRE mỗi người nhận, ≤ 50 người ⇒ ≤ 100 lệnh, ngân sách plan §10); không vòng gọi mạng theo người; không có người nhận ⇒ không gọi Redis.

## Test
unit: `domain/messages.events.test.ts`, `chat-gate.rules.test.ts` (msg.* qua cổng), `pack-contracts/messages.test.ts` (parser) · int (MỘT file, Redis thật, không sleep — `publish` được await trước khi use case trả về): `messages-stream.int.test.ts` (A gửi ⇒ B và A nhận `msg.new`, C/D không; gửi lặp không phát lại; read/deleted/conversation đúng người).

## Quyết định trong lúc làm
- Người gửi cũng nhận `msg.new`/`msg.read` (tab khác của họ) — đúng spec §5.
- Tạo hội thoại ⇒ mọi thành viên (cả người tạo) nhận `msg.conversation added` để client tải hội thoại mới.
- Thêm người: người mới `added`, thành viên cũ `updated`; thêm người đã có ⇒ không phát. Bớt/rời: người ra `removed`, người còn lại `updated`; chủ đổi do rời không có khung riêng (client tải lại hội thoại khi `updated`).
- Kiểu sự kiện ở `pack-contracts/messages.ts` (M1), `chat/me-stream-msg.ts` chỉ re-export (không nhân đôi schema).

## Việc còn lại
M5 (tệp). Client: chưa nối kho chưa đọc với `msg.*` (W1/W2/W3).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)
### ADDED pack-contracts/tin-nhan-realtime.md
#### Yêu cầu: Tin nhắn tới tức thì cho đúng thành viên, không lộ cho người ngoài (nguồn: CR-132)
Khi có tin mới, thu hồi, đã đọc hoặc đổi thành viên/tên nhóm, hệ thống đẩy sự kiện tới các thành viên của hội thoại (kể cả tab khác của người gửi) qua kênh sự kiện người dùng; đồng nghiệp ngoài hội thoại không nhận gì; công ty tắt Chat AI vẫn nhận tin nhắn; gửi lặp cùng mã không phát lại; đánh dấu đã đọc không tiến thì không phát.
- Kịch bản: khi A gửi tin trong nhóm thì B và tab khác của A nhận tin mới, người ngoài nhóm không nhận [test: apps/hub-api/src/modules/packs/contracts/messages/messages-stream.int.test.ts » A gửi]
- Kịch bản: khi B đọc, A thu hồi, A thêm rồi bớt C thì đúng người nhận đúng sự kiện [test: apps/hub-api/src/modules/packs/contracts/messages/messages-stream.int.test.ts » đọc ⇒ msg.read]
- Kịch bản: khi chọn người nhận thì khử trùng, mỗi người một khung đúng contract, không người nhận thì không phát [test: apps/hub-api/src/modules/packs/contracts/messages/domain/messages.events.test.ts » mọi thành viên]
- Kịch bản: khi công ty tắt Chat AI thì vẫn nhận sự kiện tin nhắn [test: apps/hub-api/src/modules/chat-gate/chat-gate.rules.test.ts » stream]
