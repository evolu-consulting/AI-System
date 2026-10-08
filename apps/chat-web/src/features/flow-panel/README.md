# flow-panel — khung flow (UC-06 · CHAT-AC-14..17)
`?flow=<id>` (route `/c/:id`) → `components/FlowPane` trong `ConversationPage`: ≥ 640 `FlowPanel` (`aside "Flow đang mở"`, ≤ 480px), < 640 `FlowSheet` (Sheet đáy, tay nắm "Kéo để đóng" > 120px, ✕ / "Thu nhỏ flow"). Tin: E11 `['flow', flowId, 'messages']` (`api.ts`, `hooks/use-flow-messages`, cuộn lên tải cũ hơn). Run của flow (`useRunStream` origin `flow`) vẽ thêm khi E11 chưa có; xong + E11 có câu trả lời → `dismiss` (`lib/flow-panel-logic#shouldDismissInPanel`). Gửi `sendInFlow` (flow nghỉ → `ColdResumeNote`). Đóng → xoá `?flow`, focus lại "Trả lời tiếp" (`hooks/use-open-flow`).

## FlowFrame dùng chung (C1 và phòng X2b)
`components/FlowFrame` = vỏ trình bày duy nhất: `FlowAside` (≥ 640, `aside "Flow đang mở"`) + `FlowBottomSheet` (< 640, tay nắm "Kéo để đóng", ✕ / "Thu nhỏ flow"); `FlowFrame` chọn theo `FLOW_PANEL_MIN_PX`, nhận `children(slot: {mobile, composerRef})`. Không fetch, không biết C1 hay phòng.
- C1: `FlowPane` → `FlowPanel`/`FlowSheet` (+ `FlowContent`) bọc khung, tin E11 qua `use-flow-messages`.
- Phòng: `features/rooms/components/flow/RoomFlowPane` (lazy) cung cấp nội dung riêng (thread chung, mọi thành viên có composer + menu `@`, `answer_run_id`) trong cùng `FlowFrame`; xem README rooms.
- Bẫy: sửa khung (focus, Esc, kéo đóng, nhãn) ảnh hưởng cả hai — chạy `bun test apps/chat-web` và `bun run e2e:chat` (C1/AC-H07) khi chạm; Dừng nằm trên khối run, không ở composer thread nên Esc luôn đóng khung.
