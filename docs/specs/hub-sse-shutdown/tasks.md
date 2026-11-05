---
id: hub-sse-shutdown
lát: hub-sse-shutdown
cr: CR-118
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Gốc của treo `hub.stop()` ở `chat-gate.int.test.ts` (đã che bằng trần 5 s, kr-int-py 9b7148f7): luồng SSE run
(`POST /conversations/:id/messages`, `GET /runs/:id/events` — `EventStreamSession` trong `runs/sse/sse-reader.ts`) đóng
**đồng bộ** trong listener `abort`. Bun 1.3.14 (Linux) treo `server.stop(true)` mãi khi ≥ 2 response stream bị
`controller.close()` cùng tick ngay trước nó. `/me/stream` đã hoãn đóng (B7) nhưng luồng run thì không. Client test
(`call()` → `res.body.cancel()`) không làm server thấy ngắt ⇒ các luồng run còn mở tới lúc tắt.

Tái hiện tối giản trên evotest (`oven/bun:1.3.14`): đóng đồng bộ n=1 ok; n≥2 ⇒ HANG (cả khi client huỷ thân, `cancels=0`);
hoãn đóng (macrotask) ⇒ ok ≤ 3 ms với `stop(true)` và `stop()` êm; không đóng + `stop()` êm ⇒ HANG. Bun 1.4.3 Windows không treo.

## Làm
- `apps/hub-api/src/lib/sse-shutdown.ts` · `deferredAbortClose(close)`: listener abort đóng ở macrotask sau (một chỗ, có ghi đo).
- `runs/sse/sse-reader.ts` · `EventStreamSession.#onAbort` dùng nó; `end()` bỏ qua lỗi `close()` khi stream đã bị huỷ.
- `me-stream/me-stream.session.ts` · thay `setTimeout` tại chỗ bằng helper chung.
- `server.ts` · ghi chú thứ tự tắt (abort → `server.stop()` êm chờ các lệnh đóng hoãn; timer ping dọn trong `end()`/`cancel()`).
- `chat-gate.int.test.ts` · bỏ trần 5 s, `await hub.stop()` thẳng.

## Không làm / Chạm
Không đổi contract SSE, không đổi `tests/acceptance/**` (harness `startHubX`: `ac.abort(); server.stop(true)` giữ nguyên).

## Test tối thiểu
- int mới `apps/hub-api/src/modules/runs/sse/sse-shutdown.int.test.ts`: 2 luồng run + `/me/stream` mở ⇒ `stop` < 1 s.
- `chat-gate.int.test.ts` xanh không trần.

## Quyết định trong lúc làm
- Hoãn đóng thay vì đổi thứ tự trong harness: sửa ở phiên SSE thì đúng cho mọi nơi tắt (prod `server.ts`, mọi harness test).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa lỗi vòng đời tắt instance — luồng SSE vẫn đóng khi tắt như spec HUB-FR-42, chỉ hoãn một macrotask để Bun không treo `server.stop`; docs/current không mô tả tắt instance).

## Việc còn lại
- Bẫy ghi lại (chưa sửa, ngoài phạm vi): Bun 1.3.14 không gửi header response tới khi có byte đầu ⇒ `GET /runs/:id/events`
  của run đang chạy chưa có sự kiện mới chờ tới `: ping` đầu (15 s) mới "mở". Có thể gửi `: ping` ngay khi mở như `/me/stream`.
