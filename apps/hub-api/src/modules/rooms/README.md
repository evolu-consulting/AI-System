# rooms — HUB-FR-96, HUB-FR-97, HUB-FR-98, HUB-BR-22

Phòng chat người–người (DM + nhóm ≤ 50), tin nhắn, đã đọc, chưa đọc. Spec: `docs/specs/X2a-rooms` (plan §3–§5, plan-db §4–§6).

| Phần | Vai trò |
|---|---|
| `rooms.routes.ts` · `room-messages.routes.ts` | `/rooms`, `/rooms/:id`, thành viên, tin, đã đọc. Mount ở `app.x2a.ts`. Chỉ parse (zod contract chat) → service. Thứ tự kiểm: 401 → `:id` không uuid 404 → không phải thành viên 404 → DM 409 → chủ 403 → body 400 |
| `manage/*` | `rooms.service` (tạo DM/nhóm, đổi tên, xoá, ẩn), `members.service` (thêm/bớt/rời/chuyển chủ), `*.repo` (SQL) |
| `messages/*` | gửi tin (khoá `hub.rooms` FOR UPDATE, `seq` liền, `client_msg_id` idempotent), lịch sử keyset, đánh dấu đọc |
| `rooms.rules.ts` · `rooms.map.ts` | luật thuần (`planCreateGroup`, `leaveOutcome`, `clampReadSeq`…), map hàng DB → DTO |
| `room-events.ts` | dựng `UserEvent` gửi tới `lib/user-stream` |

Luật:
- Mọi việc DB trong `withHubScope({kind:"user"})`; RLS 3 bảng + hàm `SECURITY DEFINER` (migration `0011_x2a_rooms.sql`). `hub.rooms` không có INSERT: tạo phòng chỉ qua `hub.create_room`.
- Mẫu outbox: service trả `{out, events}`; **sau** khi transaction commit mới `publishUserEvents` (retry 40P01 không phát đôi). Lỗi Redis chỉ log `ustream-publish-failed`.
- Thứ tự khoá: `hub.rooms` → `room_members` → `room_messages`; đánh dấu đọc/ẩn chỉ khoá hàng của mình.
- Không log nội dung tin.

Phụ thuộc: `@ai/contracts/chat`, `@ai/db/hub-scope`, `lib/user-stream`. Không import `me-stream`.
