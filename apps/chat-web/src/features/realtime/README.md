# realtime — client `/me/stream` (HUB-FR-99, HUB-FR-100, CHAT-AC-37…40, X2a-AC08, X2a-AC12)
Một kết nối SSE/tab, mở khi `AppShell` mount (`hooks/use-me-stream`), đóng khi đăng xuất/hết phiên (`session` cleared/expired).
- `api.ts` — `openMeStream(lastEventId, signal)`: fetch + Bearer (401 → refresh 1 lần qua `apiResponse`), header `Last-Event-ID`.
- `me-stream-driver.ts` — vòng nối lại (0,5→8 s, không bỏ cuộc; `down` từ lần thất bại thứ 5), ping-timeout 45 s, `stream.reset` xoá `lastEventId`, 401 sau refresh → dừng. Thuần (deps tiêm).
- `realtime-store.ts` — `phase` (`idle|connecting|open|reconnecting|down`) + `lastEventId` (chỉ bộ nhớ); `useRealtimePhase()` cho `shell/hooks/use-connection` (banner).
- `event-router.ts` — sự kiện → cache TanStack Query (bảng plan-frontend §3), dùng hàm thuần `rooms/lib/room-cache`.
- `runtime.ts` — singleton `meStreamDriver`; `onRoomLost(listener)` để trang phòng (F6) điều hướng `/c/new` + toast khi mất phòng đang mở.
- `lib/read-raw-sse.ts` — ReadableStream → `RawSseEvent`, `onBytes` cho cả `: ping`.
