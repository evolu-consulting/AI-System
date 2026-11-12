---
id: cr132-w1
lát: cr132-w1
cr: CR-132
làn: nhanh
migration: không
phụ thuộc: không
---
## Plan (ngắn)
W1 (CR-132 spec §5): một kết nối `/me/stream` mỗi tab. `platform/stream/me-stream.ts`: `meStream.subscribe(event, handler, onReconnected?)` trả hàm huỷ; mở khi có người nghe đầu, đóng khi người cuối huỷ; đứt ⇒ nối lại 1→30 s; 4xx (trừ 408/429) ⇒ dừng, người nghe mới mở lại. Khung SSE thô (`{event, data}`), người nghe tự parse ⇒ `msg.*` dùng được khi contract `messages.ts` có (module không import zod).
Chuyển sang dùng: thẻ duyệt + ký số (`process-stream.ts` còn là lớp lọc/parse, giữ `listenProcessEvents`, `isFatalStreamError`) và cờ tính năng (`platform/features/adapters/http.ts` `listenConfigChanged`).

## Quyết định trong lúc làm
- Giữ transport `fetch` + token web-kit (không `EventSource`: không gắn được header Authorization).
- `createMeStream({transport, wait})` để test bằng transport/đồng hồ giả.
- Perf: số kết nối `/me/stream` mỗi tab: trước tối đa 3 (cờ tính năng + thẻ duyệt + ký số trên trang hợp đồng) ⇒ sau luôn 1 (chừa 4 trên giới hạn 5/user cho tab khác).
- e2e có thể chạm (không chạy, không sửa): `e2e/contracts-web/approval-current.cw.ts`, `cr125-s4-card.cw.ts`, `app-config.spec.ts` (nếu đếm/chặn request `/me/stream`).

## Test tối thiểu
`bun test` workspace-web: `platform/stream/me-stream.test.ts` (1 kết nối nhiều người nghe, đóng khi huỷ cuối, nối lại + backoff, 4xx dừng) + test thẻ duyệt xanh; tsc workspace-web.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-12 (đợt cr132-wave)

Không thay đổi hành vi (lý do: tách kết nối realtime dùng chung, thẻ duyệt/ký số/cờ tính năng giữ nguyên)

## Việc còn lại
Không. W2/W3 đăng ký `msg.*` qua `meStream.subscribe`.
