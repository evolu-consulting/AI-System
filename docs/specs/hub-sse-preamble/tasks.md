---
id: hub-sse-preamble
lát: hub-sse-preamble
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: hub-sse-shutdown
---
## Plan (ngắn)
Bun 1.3.14 chỉ gửi header response khi stream có byte đầu (đo evotest, hub-sse-shutdown). Luồng run (E12 POST tin + E13
`GET /runs/:id/events`) của run đang chạy chưa có sự kiện mới ⇒ client chờ tới `: ping` đầu (15 s) mới "mở".
Sửa: `EventStreamSession.start()` ghi `SSE_OPEN_FRAME` (`: open\n\n`, contracts) trước XRANGE; ping 15 s giữ nguyên.
`/me/stream` đã ghi `: ping` ngay khi mở (B7) ⇒ không đổi. Không SSE nào khác trong hub (`emptyStream` đóng ngay).

## Làm
- `packages/contracts/src/chat/events.ts` · `SSE_OPEN_FRAME`.
- `apps/hub-api/src/modules/runs/sse/sse-reader.ts` · ghi frame mở ở đầu `start()`.
- Client: mọi parser web (web-kit `sse.ts`, chat-web `read-raw-sse.ts`, workspace-web `platform/features/adapters/http.ts`,
  `contract-approval/stream/process-stream.ts`) dùng `createSseParser` (contracts) — bỏ mọi dòng `:`. Không sửa client.

## Test tối thiểu
- unit `packages/contracts/src/chat/rules.test.ts` · `: open` + dòng `:` bất kỳ bị bỏ (cả chunk cắt đôi).
- int `apps/hub-api/src/modules/runs/sse/sse-open.int.test.ts` · run đang chạy rỗng ⇒ 200 + `: open` < 500 ms.

## Quyết định trong lúc làm
- Frame riêng `: open` (không dùng lại `: ping`) để log/trace phân biệt; parser coi như nhau.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: thêm dòng chú thích SSE mà mọi parser bỏ qua; chỉ giảm độ trễ mở stream, docs/current không mô tả luồng SSE run).

## Việc còn lại
