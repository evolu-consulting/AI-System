# rooms — DM / nhóm (HUB-FR-96…101, X2a)
`api.ts`: mọi gọi `/rooms*` (zod của `@ai/contracts/chat`). `hooks/`: `useRoomList` (infinite) · `useUnreadTotal` · `useRoom` · `useRoomMessages` (trang lùi `before_seq`) · mutation trong `use-room-actions` (tạo, đổi tên, thêm/bớt/chuyển, xoá/rời/ẩn, gửi tin, đánh dấu đã đọc).
`lib/`: `room-cache` (query key + vá cache thuần, dùng cho event-router F2) · `room-errors` (`roomErrorKey` mã→`rtErr.*`) · `room-logic` (tên, xem trước, "Đã xem", nhóm theo ngày). 
UI (F3–F6): `pages/RoomPage` → `components/RoomView` (header + `timeline/` + `RoomComposer`) · `header/{RoomHeader,RoomActions}` (Thành viên (n), Thêm người — chỉ chủ, Tuỳ chọn phòng) · `dialogs/` quản lý, nạp lazy theo loại: `RoomDialogs` (điều phối) → `MembersDialog`+`MemberRow` (chuyển chủ / bớt), `AddMembersDialog` (`PersonPicker` `already` = thành viên, không chặn quá 50: server trả `ROOM_FULL`), `RenameRoomDialog`, `ExitRoomDialog` (xoá / rời; chủ còn người → "Chuyển quyền chủ nhóm trước khi rời"; một mình → "Rời và xoá nhóm"), `ConfirmDialog` (alertdialog chung), `NewGroupDialog` (mở từ `AppShell`).
`lib/self-exit` đánh dấu hành động xoá/rời của chính mình để `useRoomLost` không báo "đã bị xoá / không còn trong nhóm" thừa khi sự kiện dội lại; `lib/room-toast` toast có `role="status"`. Hộp xác nhận chuyển chủ / bớt đóng ngay khi bấm (kết quả qua toast + danh sách).

## X2b — agent trong phòng (HUB-FR-101, 103 · `docs/specs/X2b-room-agents/`)
- **FR/luồng**: `@key` trong ô nhập phòng (`menus="agents"`) → `use-send-room-text` đọc `SubmitResult` + header run → khối chạy `components/agent/PendingAgentBlock` (Dừng chỉ người gửi lượt) → tin agent `AgentBlock` (một `caller` mỗi lượt) → "Trả lời tiếp" mở thread chung `?flow=`.
- **Vào**: `lib/room-agent` (vá `active_runs`) · `hooks/use-room-runs` (pill + run đang chạy) · `hooks/use-answer-run` + `use-room-flow` (gửi trả lời) · `components/agent/{AgentWait,WaitingNote}` (chờ) · `components/flow/{RoomFlowPane,RoomFlowContent,RoomFlowMessages}` (thread) · sự kiện run: `realtime/event-router`, `me-stream-driver` (thử `parseMeStreamRunEvent` khi `parseMeStreamEvent` null, vẫn ghi `lastEventId`).
- **Phụ thuộc**: `features/flow-panel/components/FlowFrame` (khung dùng chung C1 và phòng, xem README flow-panel) · `features/answer` (`AskCard`, `AnswerBody`) · `features/composer` (menu `@`).
- **Bẫy**:
  - Thread chung: mọi thành viên có composer + menu `@` trong thread; chỉ người gửi lượt (`caller`) được chip/Đồng ý/Huỷ. Người khác: `WaitingNote` (chỉ tên người hỏi, không lộ hành động `side_effect`, Q5); sai người → 403 `NOT_RUN_CALLER` (toast + làm tươi).
  - `answer_run_id` chỉ gửi kèm khi có `flow_id` + run đang chờ; thiếu `answer_run_id` server coi là tin thường (không trả lời run).
  - `applyAgentMessage` (tin agent tới): có `ask` ⇒ thêm/vá lượt chờ; không ⇒ gọi `removeActiveRun`. `removeActiveRun(d, runId)` chỉ xoá lượt khỏi `active_runs`; gửi trả lời gọi nó ngay (lạc quan) rồi `room.run_finished` → `finishActiveRun` KHÔNG xoá lượt đang `waiting` khi status `finished`. Đừng gộp hai đường.
  - `AGENT_NOT_FOUND` giữ nguyên nội dung trong ô; `@orchestrator` bị che trong phòng (D8).
  - Khối agent trong thread (`inThread`) không có footer Copy/Trả lời tiếp; Dừng nằm trên khối run, thread composer không có nút Dừng (TECH-DEBT #110).
  - Đính kèm trong phòng (F5) đã chuyển X2b-2 — không làm ở đây.
