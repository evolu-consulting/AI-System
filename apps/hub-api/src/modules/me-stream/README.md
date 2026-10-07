# me-stream — HUB-FR-99, HUB-BR-22

`GET /me/stream`: SSE theo user (sự kiện phòng realtime), nối lại bằng `Last-Event-ID`. Spec: `docs/specs/X2a-rooms` plan §7.

| File | Vai trò |
|---|---|
| `me-stream.routes.ts` | auth, tính `resumePlan` TRƯỚC khi trả response, headers SSE |
| `me-stream.session.ts` | `MeStreamSession`: `stream.reset` (nếu cần) → `: ping` ngay (client coi byte đầu là `open`) → replay `XRANGE` → theo dõi; `: ping` mỗi `pingMs` kèm `accountUsable`; đóng lúc JWT `exp`; `MeStreamConns` ≤ `USER_STREAM_CONN_MAX`/user (phiên mới đẩy phiên cũ) |
| `me-stream.rules.ts` | thuần: `parseStreamId`, `resumeDecision` (tail/replay/reset), `evictOldest` |
| `user-stream-reader.ts` | đọc Redis stream `ustream:<uid>` (XRANGE, XINFO, subscribe) |

Ghi chú (B7):
- Dùng `lib/user-stream` (ghi/khoá/format); **không** import module `rooms` — phát sự kiện là việc của `rooms`.
- Đóng do abort (tắt instance) phải hoãn một lượt event loop (`setTimeout(…, 0)`): Bun 1.3 treo `server.stop(true)` khi ≥ 2 stream bị `close()` cùng tick ngay trước nó.
- Redis 7.4 không cập nhật `max-deleted-entry-id` khi cắt `XADD MAXLEN ~` (chỉ `XDEL` mới đổi): `streamInfoOf` (`user-stream-reader.ts`) tính `maxDeleted` hiệu lực = max(XDEL, mốc cắt) với mốc cắt = `recorded-first-entry-id` khi `entries-added > length`; `resumeDecision` giữ nguyên.

Phụ thuộc: `lib/user-stream`, `lib/auth.middleware`, `@ai/contracts/chat`.
