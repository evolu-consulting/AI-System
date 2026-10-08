## Kết luận: APPROVED · Spec: X2a-rooms · Vòng: 2

Phạm vi: các commit sửa sau `2ae3131` (review-1): `5b1686e` fix(x2a): RV1 sửa review chat-web · `897d778` test(x2a): test khoá cho security review vòng 1 · `58ae67a` fix(x2a): RV1 siết RLS phòng + sửa review BE. Đối chiếu `plan-decisions.md` (dòng RV1), `plan-frontend.md` §14 (dòng RV1), `TECH-DEBT.md` #100–105. RLS/migration 0012 do security reviewer xét lại riêng; ở đây chỉ xét tác động của 0012 lên luồng gửi/đọc/ẩn và thứ tự khoá.

## Lệnh đã chạy
- `bun run typecheck` → 11/11 OK
- `bun test apps/hub-api/src/modules/{rooms,me-stream} apps/hub-api/src/lib/user-stream.test.ts apps/chat-web/src/features/{rooms,realtime,composer} tests/acceptance/X2a/rules` → 158 pass, 0 fail
- `bun --env-file=.env.local --config=bunfig.int.toml test ./tests/acceptance/X2a/` (gồm `concurrency`, `messages`, `members`, `me-stream`, `db-rls`, `rv1-security`) → 167 pass, 0 fail (diff chạm khoá: markRead/hide nay `lockFor`)
- `bun run check:fn --all` → không vi phạm nào trong file X2a (7 vi phạm cũ ngoài phạm vi, TECH-DEBT #99) · `bun run check:size --all` → OK
- `bun run depcruise --all` → không vi phạm (1662 module)
- `bun run test:lock:verify` → OK (474 file; `.lock` cập nhật bởi `qc` ở `897d778`) · `bun run trace --check` → OK (198 mã)

## Trạng thái lỗi vòng 1
| # | Mức | Trạng thái | Bằng chứng |
|---|---|---|---|
| 1 | Major | Đã sửa | `ComposerRow.tsx:82-86` `rowDropProps(null)` ⇒ `{}`; `Composer.tsx` truyền `attach=null` khi `attachments=false` và không gửi `att.ids`; test `ComposerRow.test.tsx` |
| 2 | Major | Đã sửa | `me-stream-driver.ts:153-156` `connecting→open` + `hasRoomsData()` ⇒ `stream.reset`; `runtime.ts` dùng `roomKeys.list`; test "RV1 #2" (có/không dữ liệu) |
| 3 | Minor | Đã sửa | `rooms.repo.ts` `softDeleteRoom` dùng `clock_timestamp()` sau `lockFor` |
| 4 | Minor | Đã sửa | `members.service.ts` `hide` gọi `lockFor(…, "hide")` (giữ 404→409 qua `guard`) + `hideSelf` dùng `clock_timestamp()`; bỏ ẩn DM chuyển vào `room_next_seq` dưới cùng khoá ⇒ tuần tự với gửi |
| 5 | Minor | Đã sửa | `messages.service.ts:81,86` `lockFor(…,"read")` + `next !== null && read === null ⇒ ROOM_NOT_FOUND` |
| 6 | Minor | Đã sửa / chấp nhận phần trùng | `rooms/lib/message-preview.ts` dùng chung cho `event-router` và `applySentMessage`, thuật toán trùng khớp từng dòng với `previewOf` (`rooms.rules.ts:93-96`); để hai bản FE/BE (không đưa vào contracts) — ghi ở plan-frontend §14 RV1 kèm cảnh báo đổi cả hai |
| 7 | Minor | Đã sửa | Outcome `clean` (đã open, không idle, không abort) ⇒ nối lại ngay, không đổi phase; > 3 lần đóng sạch < 1 s liên tiếp ⇒ tính là sự cố. Test "RV1 #7" ×2 (xem N1, N2) |
| 8 | Minor | Đã sửa | `room-events.ts` `memberAddedEvents`: mỗi người mới 1 bản kèm `room`, người cũ 1 bản chung (`user_id` = người mới đầu tiên). Hợp contract: schema không đổi; spec-isolation §1.1 chỉ quy định "người khác chỉ id"; FE `onMemberAdded` với `user_id ≠ me` chỉ invalidate detail+list ⇒ không phụ thuộc `user_id` cụ thể. Người mới không còn nhận sự kiện về người mới khác — đủ vì đã có `room` (summary) và detail tải khi mở. Quyết định ghi `plan-decisions.md` RV1 |
| 9 | Minor | Đã sửa | `mark-read-gate.ts:21-32` lỗi ⇒ hẹn thử lại một lần `max(seq, pending)` sau `intervalMs`; không lặp vô hạn (test). Xem N3 |
| 10 | Minor | Đã sửa | `room-cache.ts` `applySentMessage` trừ `room.unread` cũ khỏi `unread_total` (kẹp ≥ 0); test |
| 11 | Minor | Chấp nhận | Giữ D7 (plan.md D7, plan-frontend §14 RV1) |
| 12 | Minor | Đã sửa | `me-stream.session.ts` chiến lược byte `highWaterMark = ME_STREAM_BUFFER_BYTES` (1 MiB), `desiredSize < 0` ⇒ `warn me-stream-slow-client` + `end()` (đóng sạch, phần đã xếp vẫn giao; client nối lại bằng `Last-Event-ID`, phía client là outcome `clean`). Test `me-stream.backpressure.test.ts`. Xem N4 |
| 13 | Minor | Đã sửa | README `rooms` dòng `manage/*`, `messages/*`, thứ tự khoá cập nhật |
| 14 | Minor | **Chưa sửa** | `docs/specs/X2a-rooms/spec.md:5` vẫn `status: draft` — docs-architect đổi `in-progress` (→ `done` sau I2) |
| 15 | Minor | Đã sửa | Tách `ComposerRow.tsx` (86 dòng) + `composer-types.ts`; `Composer.tsx` = 200 dòng; TECH-DEBT #100 đóng |

Kiểm hồi quy (không thấy lỗi):
- `bumpSeq` (`messages.repo.ts`) gọi `hub.room_next_seq` rồi đọc lại `last_seq/last_activity_at`; vẫn chạy SAU `lockFor` ⇒ `room_next_seq` khoá lại hàng đã giữ, không đổi thứ tự rooms→room_members→room_messages. `advanceRead` chuyển lên trước `insertMessage` không ảnh hưởng (`last_seq` đã tăng; trigger `room_members_guard` kẹp ≤ `room_last_seq`). Policy `room_messages_insert` `seq = room_last_seq` khớp vì seq vừa cấp trong cùng tx. `fanout` xử lý `total` null ⇒ 0 (trên đường gửi luôn có giá trị).
- `markRead`/`hide` nay `rooms`→`room_members` như mọi đường ghi ⇒ không chu trình khoá (int `concurrency` xanh).
- Đóng sạch khi `lastEventId === null` phát `stream.reset` một lần trong `isCleanClose`, phase giữ `open` nên `markOpen` của lần nối kế không phát đôi.
- `applySentMessage` giữ nguyên `data` khi phòng chưa có trong list (hook vẫn `refreshList`).

## Lỗi mới
| # | Mức | Nhóm | file:dòng | Vấn đề | Cách sửa đề xuất | Giao cho |
|---|---|---|---|---|---|---|
| N1 | Minor | 2 Nghiệp vụ (đồng thời) | `apps/chat-web/src/features/realtime/me-stream-driver.ts:139-141` | Đóng sạch khi chưa có `lastEventId`: `stream.reset` phát **trước** khi mở kết nối mới ⇒ refetch `['rooms']` có thể đọc DB trước điểm `tail` của phiên mới; tin rơi vào khe này lại mất (cùng loại #2, cửa sổ nhỏ) | Đặt cờ `resetOnOpen` thay vì phát ngay; phát trong `markOpen`/`onBytes` của lần nối kế (server tính điểm bắt đầu trước khi trả header ⇒ byte đầu là mốc an toàn) | frontend-lead |
| N2 | Minor | 5 Hiệu năng | `me-stream-driver.ts:80,115,136-138` | Chốt vòng nóng không leo thang: `onBytes` đặt `failures = 0` mỗi lần có byte ⇒ server đóng ngay sau byte đầu (vd. `exp` đã qua, `end()` do backpressure lặp) thì backoff luôn `backoffDelay(1)` = 500 ms ⇒ ~2 kết nối/s/tab vô hạn và banner `reconnecting` nháy | Khi `quickClean > CLEAN_MAX_QUICK` dùng `backoffDelay(quickClean - CLEAN_MAX_QUICK)` (hoặc chỉ reset `failures` khi kết nối sống ≥ `CLEAN_MIN_LIFE_MS`) | frontend-lead |
| N3 | Minor | 8 Frontend | `apps/chat-web/src/features/rooms/lib/mark-read-gate.ts:21-32,49-53` | `send` lỗi về SAU `dispose()` (rời phòng/đổi phòng) vẫn hẹn timer thử lại (vì `cancel` đã null) ⇒ `POST /read` chạy sau khi gate đã huỷ, timer không ai huỷ | Thêm cờ `disposed`; `catch` và callback timer thoát sớm khi `disposed` | frontend-lead |
| N4 | Minor | 5 Hiệu năng | `apps/hub-api/src/modules/me-stream/me-stream.session.ts:116,184-187` | Replay `#push` enqueue đồng bộ cả lô XRANGE trước khi client kịp đọc ⇒ client **nhanh** vẫn bị đóng khi lô replay > 1 MiB (tin tới 16 000 ký tự ⇒ ~20 sự kiện/lượt). Hội tụ (mỗi lượt tiến `Last-Event-ID`) nhưng gây nhiều lượt nối lại < 1 s ⇒ kích N2 | Trong replay chỉ xếp tới khi `desiredSize <= 0` rồi chờ `pull` (hoặc chia lô, `await` giữa các lô); giữ ngắt `end()` cho luồng live. Hoặc ghi TECH-DEBT | backend-lead |
| N5 | Minor | 5 Hiệu năng | `apps/hub-api/src/modules/rooms/messages/messages.service.ts:81` | `markRead` nay `FOR UPDATE` hàng `rooms` ⇒ mọi lần đánh dấu đọc trong phòng (≤ 50 người, 1 lần/`intervalMs`/tab) tuần tự với nhau và với gửi tin. Đúng nghiệp vụ (#5), chi phí khoá tăng | Chấp nhận ở quy mô X2a; nếu đo thấy tranh chấp: `FOR SHARE` cho đọc/ẩn (vẫn tuần tự với gửi `FOR UPDATE`, không chặn nhau) — ghi TECH-DEBT | backend-lead |
| N6 | Minor | 9 Truy vết | `docs/specs/X2a-rooms/plan-db.md:70,78` | Bảng §5 hàng "Đánh dấu đọc" còn "(không khoá)" và §6 còn "đánh dấu đọc / ẩn chỉ khoá hàng mình, không xin khoá `rooms`" — mâu thuẫn §4.4b mới và code | Sửa hai dòng theo RV1 (`lockFor` trước) | docs-architect |
| N7 | Minor | 8 Frontend | `apps/chat-web/src/features/composer/components/ComposerRow.tsx:82-86` | `attach = null` ⇒ không còn `preventDefault` khi thả tệp lên composer phòng ⇒ trình duyệt mở tệp, rời SPA (nháp còn trong localStorage). Cùng hành vi với vùng khác của app (không có chặn thả toàn cục) nên không phải hồi quy nghiêm trọng | `rowDropProps(null)` trả `{onDragOver: e => e.preventDefault(), onDrop: e => e.preventDefault()}` (không gọi `add`) | frontend-lead |

## Rubric
1 ✓ · 2 ✓ (Minor N1) · 3 ✓ (phần chung; RLS/0012 do security review vòng 2) · 4 ✓ · 5 ✓ (Minor N2, N4, N5) · 6 ✓ · 7 ✓ · 8 ✓ (Minor N3, N7) · 9 ✓ (Minor #14, N6)
