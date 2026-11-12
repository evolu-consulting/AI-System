---
id: cr132-m1
lát: cr132-m1 (M1 + M2 của CR-132)
cr: CR-132
làn: nhanh (phần RLS/tenant soát Opus low)
migration: 0107_cr132_messages (migrations-pack-contracts, journal idx 103, when 1807000217000)
phụ thuộc:
---
## Plan (ngắn)
Nền dữ liệu + contract cho tin nhắn Sổ Hợp Tác (spec `docs/specs/CR-132/spec.md` §3–5, chép vào lát này): M1 = 4 bảng `contracts.msg_*` + RLS tenant + thành viên;
M2 = contract zod `pack-contracts/messages.ts` + luật thuần `messages/domain/messages.rules.ts`. Không route/API (M3), không realtime (M4), không tệp (M5), không UI.

## Làm
- `0107_cr132_messages.sql`: `msg_conversations`, `msg_members`, `msg_messages`, `msg_files` (FK kép `(tenant_id, …)`; `msg_files` → `files(id, tenant_id)` RESTRICT); policy RESTRICTIVE
  sel/ins/upd/del mỗi bảng (chỉ nội bộ + thành viên; DELETE `USING (false)` cho hội thoại/tin/tệp); hàm definer `msg_my_conversations()`, `msg_created_by_me(cid)`, `msg_drop_if_empty(cid)`.
- `packages/contracts/src/pack-contracts/messages.ts` (+ export ở `index.ts`): hằng, `MSG_ERRORS` → HTTP, request/response, DTO, sự kiện `msg.*` (`ME_STREAM_MSG_EVENTS`, `MeStreamMsgEventSchema`).
- `messages/domain/messages.rules.ts`: `dmKey`, `canEditGroup`, `canRemoveMember`, `nextOwner`, `groupSizeOk`, `clampRead`, `seenBy`, `messageEmpty` (+ `capUnread`).

## Perf (ngưỡng spec §6, đo ở M3)
Chưa đọc = MỘT câu cho mọi hội thoại của user (spec §6): `msg_members (tenant_id,user_id,conversation_id)` → bỏ hội thoại `last_seq <= last_read_seq` → quét khoảng PK `msg_messages (tenant_id,conversation_id,seq)` trần 100/hội thoại.
Ngưỡng p95 (1 user / 200 hội thoại / 100.000 tin): `GET /messages/unread` ≤ 20 ms · danh sách 30 dòng ≤ 50 ms · gửi tin ≤ 40 ms · đọc ≤ 20 ms · 50 tin ≤ 30 ms. Index đã có ở 0107. Đo + `messages.perf.int.test.ts` ở M3.

## Test tối thiểu
unit: `messages/domain/messages.rules.test.ts`, `packages/contracts/src/pack-contracts/messages.test.ts` · int (MỘT file): `messages/messages-rls.int.test.ts` (chéo công ty · ngoài hội thoại · user ngoài · khuôn tạo/xoá hội thoại).

## Quyết định trong lúc làm
- `msg_created_by_me(cid)` chặt hơn spec: «created_by = tôi **và hội thoại chưa có thành viên nào**» ⇒ chỉ cho chèn lô thành viên đầu; người tạo đã rời/bị bớt không tự chèn lại mình (lỗ hổng nếu chỉ kiểm created_by).
- Chèn hội thoại mới: id sinh phía app và **không RETURNING** (người tạo chưa là thành viên nên SELECT policy chặn RETURNING); chèn lô thành viên đầu (gồm chính mình) rồi mới đọc lại. M3 theo khuôn này (có trong int).
- `msg_drop_if_empty(cid)` (definer) cũng đánh dấu `files.deleted_at` cho tệp của hội thoại trước khi xoá (một câu, nguyên tử); byte ở FileBox do use case gỡ. Chỉ chạy khi hội thoại KHÔNG còn thành viên, người gọi là nhân viên nội bộ.
- `msg_messages` thêm `UNIQUE (tenant_id, id)` (tra tin theo id không cần seq) và policy UPDATE yêu cầu cả thành viên + người gửi; `msg_files` thêm FK `(tenant_id, conversation_id, seq)` → `msg_messages` (seq NULL = chưa gửi ⇒ FK không kiểm) để tệp đã gửi luôn trỏ đúng tin.
- Thu hồi tin không xoá `msg_files` (không cấp DELETE): giữ liên kết để policy `contracts.files` (0108/M5) còn chặn người ngoài hội thoại.
- Sự kiện realtime đặt trong `pack-contracts/messages.ts` (brief M2) thay vì `chat/me-stream-msg.ts` của spec §5; M4 có thể re-export ở đó khi nối `meStreamEventAllowed`.
- Hàm definer dựa vào chủ migration không chịu FORCE RLS (cùng khuôn `community_partners` 0103) và lọc tường minh theo GUC tenant.
- `capUnread(n, scope)` (kẹp 99/999) thêm vào luật thuần cho M3 dùng.
- Soát Opus (0107): thêm `msg_is_owner(cid)`. `msg_members` UPDATE/DELETE: chủ nhóm sửa/xoá bất kỳ hàng; thành viên thường chỉ sửa hàng của mình với `role='member'` (không tự nâng chủ) và chỉ xoá (rời) chính mình. INSERT thành viên: lô đầu của người tạo (`msg_created_by_me`) hoặc chủ nhóm hiện tại (chặt hơn spec «thành viên hoặc created_by_me»; quyền nhóm vẫn kiểm ở use case). `msg_files` INSERT yêu cầu `contracts.files.created_by` = người gọi (không gắn tệp của người khác).
- **Cho M3:** tạo hội thoại + lô thành viên đầu (gồm người tạo vai `owner`) trong CÙNG transaction, id sinh phía app, không RETURNING khi chèn hội thoại; chuyển chủ = chủ hiện tại UPDATE vai người kế rồi mới DELETE hàng của mình.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)
### ADDED pack-contracts/tin-nhan.md
#### Yêu cầu: Tin nhắn trong Sổ Hợp Tác chỉ thuộc công ty và các thành viên của cuộc trò chuyện (nguồn: CR-132)
Hội thoại, danh sách thành viên, tin và tệp đính kèm chỉ đọc/ghi được bởi nhân viên nội bộ của đúng công ty và đúng thành viên của hội thoại đó. Công ty khác, đồng nghiệp ngoài hội thoại và người dùng bên ngoài (đối tác) không thấy gì, kể cả khi có hàng thành viên. Quản trị công ty không có quyền đặc biệt đọc tin của người khác.
- Kịch bản: công ty khác không thấy và không ghi được vào hội thoại của công ty này [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » chặn đọc/ghi chéo công ty]
- Kịch bản: đồng nghiệp cùng công ty nhưng ngoài hội thoại không thấy, không tự thêm mình, không thu hồi hay xoá tin của người khác [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » NGOÀI hội thoại]
- Kịch bản: người dùng bên ngoài không thấy tin nhắn và không gửi được [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » user ngoài (external)]
#### Yêu cầu: Tạo, rời và xoá cuộc trò chuyện theo luật thành viên (nguồn: CR-132)
Mỗi cặp nhân viên có một hội thoại 1-1 duy nhất; nhóm có tên 1–80 ký tự và tối đa 50 người; tin tối đa 4000 ký tự. Người tạo thêm được lô thành viên đầu tiên; sau khi đã rời hoặc bị bớt thì không tự vào lại. Người cuối cùng rời nhóm thì cuộc trò chuyện và tệp của nó bị xoá.
- Kịch bản: tạo hội thoại, chèn lô thành viên đầu, gửi tin; người tạo đã rời không tự chèn lại [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » tạo hội thoại]
- Kịch bản: người cuối rời thì hội thoại bị xoá và tệp được đánh dấu xoá [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » người cuối rời]
- Kịch bản: 1-1 phải có khoá cặp, nhóm phải có tên, trùng cặp bị chặn, tin quá 4000 ký tự bị chặn [test: apps/hub-api/src/modules/packs/contracts/messages/messages-rls.int.test.ts » ràng buộc dạng]
#### Yêu cầu: Quy tắc nhóm: chủ nhóm, rời nhóm, đã đọc, đã xem (nguồn: CR-132)
Chỉ chủ nhóm đổi tên, thêm và bớt người; ai cũng tự rời được; 1-1 cố định. Chủ rời thì người vào sớm nhất thành chủ. Mốc đã đọc chỉ tiến và không vượt tin cuối; «Đã xem» tính theo mốc đọc của các thành viên khác.
- Kịch bản: quyền chủ nhóm, tự rời, chuyển chủ, trần 50 người, kẹp mốc đã đọc, người đã xem, tin rỗng [test: apps/hub-api/src/modules/packs/contracts/messages/domain/messages.rules.test.ts » nextOwner; apps/hub-api/src/modules/packs/contracts/messages/domain/messages.rules.test.ts » quyền nhóm; apps/hub-api/src/modules/packs/contracts/messages/domain/messages.rules.test.ts » clampRead]
- Kịch bản: yêu cầu tạo hội thoại, gửi tin và sự kiện realtime được kiểm chặt ở biên [test: packages/contracts/src/pack-contracts/messages.test.ts » CreateConversationRequest; packages/contracts/src/pack-contracts/messages.test.ts » MeStreamMsgEvent]

## Việc còn lại
M3 (API + `activeInternalAmong` + đo perf), M4 (sự kiện), M5 (tệp + 0108 policy `contracts.files`). Điều phối: `slice:merge` cr132-m1 tuần tự với lát khác chạm `migrations-pack-contracts` (idx 103 / when 1807000217000); Opus low soát RLS (0107).
