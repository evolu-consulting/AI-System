---
id: X2a-rooms
title: Chat user↔user - DM 1-1, nhóm, realtime theo user, chưa đọc/đã đọc, danh bạ cùng tenant
milestone: X2a
status: draft             # draft → ready → approved → in-progress → done
requirements: [HUB-FR-96, HUB-FR-97, HUB-FR-98, HUB-FR-99, HUB-FR-100, HUB-FR-102, HUB-FR-75 (vế phòng), HUB-BR-22, HUB-BR-14 (bối cảnh), AC-H23, AC-H24, AC-H25, AC-H07/H08 (giữ nguyên), CHAT-AC-37..45, X2a-R01..R24, X2a-AC01..AC16]
design:
  - docs/CHANGE-REQUESTS.md#CR-047 (R1–R13), CR-048 (chỉ để chừa chỗ X2b)
  - docs/design/agent-hub/ba-agent-hub.md (§6.9 FR-96…103; §7 HUB-BR-21/22; §8 `rooms`, `room_members`, `room_messages`; §9.1 dòng `/directory`, `/rooms*`, `/me/stream`; §9.2 "Luồng người dùng"; §9.3 `ROOM_NOT_FOUND`, `NOT_ROOM_OWNER`, `DM_IMMUTABLE`, `ROOM_FULL`; §11 AC-H07, H08, H23–H25)
  - docs/design/chat-app/usecases-chat.md (UC-09, UC-10; CHAT-AC-37…45)
  - canvas: docs/design/chat-app/canvas-x2/ (Main, DM, NewGroup, Mobile; https://claude.ai/artifact/GS6GeKK6ycaY6seR77iKs3) · token docs/design/canvas/tokens-map.md
owner: backend-lead + frontend-lead + qc
---

# X2a · Phòng chat: DM 1-1 + nhóm (chỉ user)

CR-047 (2026-10-07): làm trước H4b, phiên Hub được sửa `apps/chat-web`, `packages/db`, `packages/contracts/src/chat` (chỉ thêm). Phần agent trong phòng (`@agent`, menu `@` liệt kê agent dùng được) là **X2b** (CR-048) — X2a chỉ chừa chỗ (§5.3).

## 1. Phạm vi
**Làm:**

| # | Nhóm | Nội dung | Nguồn |
|---|---|---|---|
| A | DB + RLS | Migration Hub `0011_x2a_rooms`: `hub.rooms`, `hub.room_members`, `hub.room_messages` (+ mốc đọc), RLS theo **thành viên** + khoá `tenant_id` (§4) | HUB-FR-96, BR-22 |
| B | API phòng | Danh bạ, tạo DM/nhóm, chi tiết, đổi tên, xoá, thêm/bớt, rời, chuyển chủ, ẩn DM, tin (lịch sử + gửi), đánh dấu đã đọc (§3) | HUB-FR-96…98, 100, 102 |
| C | Realtime | `GET /me/stream` (SSE theo user) qua Redis Streams, `Last-Event-ID`, đúng với ≥ 2 instance Hub; tách khỏi stream run (§6) | HUB-FR-99 |
| D | Contract | `@ai/contracts/chat` **chỉ thêm** file mới (`rooms.ts`, `directory.ts`, `me-stream.ts`) + `CHAT_ROOM_ERRORS`; không sửa schema đã có | CR-047 R13 |
| E | Chat UI | Sidebar "Tin nhắn & Nhóm" + "Hỏi AI", màn phòng (DM/nhóm), tạo nhóm, quản lý thành viên, rời/ẩn/xoá, huy hiệu chưa đọc, "Đã xem", banner kết nối lại; khung flow bên phải sẵn cho X2b (§5.3) | UC-09, UC-10, canvas-x2 |
| F | Đóng mốc | `done:x2a`, review ≤ 2 vòng + **security review RLS riêng**, I2 | ROADMAP |

**Không làm:** `@agent`/`@orchestrator` trong phòng, menu `@` trong phòng, run trong phòng, `runs.room_id` (X2b, CR-048) · đính kèm file trong phòng (Q3) · presence, "đang gõ", email/push (COULD, HUB-FR-100) · sửa/xoá tin (CR-047 R10) · phòng khác tenant · bật/tắt chat theo tenant (ADM-FR-64, CR-047 R11) · lệnh `/` trong phòng · Extension · sửa `.html` design (TECH-DEBT #32) · sửa trang/API hội thoại C1.

## 2. Luật (X2a-R)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| X2a-R01 | Phòng thuộc đúng 1 tenant = `tenant_id` của JWT người tạo. Mọi thành viên cùng tenant đó. Không có đường nào thêm user khác tenant | FR-96, CR-047 R1 |
| X2a-R02 | User "dùng được" = định nghĩa `accountUsable` hiện có của Hub (user active, không `locked_by_tenant`, tenant không khoá). Danh bạ, tạo DM, thêm thành viên chỉ nhận user dùng được; khác → `USER_NOT_FOUND` (404, như không tồn tại) | FR-98, 102 |
| X2a-R03 | Không phải thành viên hiện tại (chưa từng, đã rời, bị bớt, phòng đã xoá) → **404 `ROOM_NOT_FOUND`** cho mọi endpoint `/rooms/:id*` (đọc **và ghi**), kể cả `tenant_admin`/`platform_admin`; không 403 | FR-96, BR-22, AC-H23 |
| X2a-R04 | Thành viên nhưng không phải chủ gọi việc của chủ → 403 `NOT_ROOM_OWNER` (họ đã biết phòng tồn tại) | FR-98 |
| X2a-R05 | DM: đúng 2 thành viên, `name` null, khoá DM duy nhất theo tenant (`plan-db.md` §4). Mở DM lần 2 trả phòng cũ (200), lần đầu tạo (201). DM với chính mình → 400 `DM_SELF` | FR-97, AC-H24 |
| X2a-R06 | DM: đổi tên / thêm / bớt / xoá / chuyển chủ / rời → 409 `DM_IMMUTABLE`. Chỉ được **ẩn phía mình** (`hidden_at`) | FR-97 |
| X2a-R07 | DM ẩn: biến mất khỏi `GET /rooms` của người ẩn; tin **mới hơn** `hidden_at` (của bất kỳ ai) làm hiện lại (xoá `hidden_at`) + tính chưa đọc. Mở lại DM qua danh bạ cũng bỏ ẩn. | FR-97, CHAT-AC-38 |
| X2a-R08 | Nhóm: tên bắt buộc, trim, 1–80 ký tự (`VALIDATION_ERROR`). Người tạo = chủ (`role=owner`). Tối đa **50 thành viên tính cả chủ**; tạo/thêm vượt → 409 `ROOM_FULL`, không ghi phần nào | FR-98, CHAT-AC-41 |
| X2a-R09 | Chỉ chủ: đổi tên, thêm, bớt, xoá phòng, chuyển chủ. Thêm người đã là thành viên → bỏ qua (idempotent, không lỗi) | FR-98, CHAT-AC-42 |
| X2a-R10 | Rời: thành viên thường tự rời (`left_at`). Chủ rời khi còn thành viên khác → 409 `OWNER_MUST_TRANSFER`; chủ là người duy nhất còn lại → rời = xoá phòng | FR-98, CHAT-AC-43 |
| X2a-R11 | Chuyển chủ: chỉ sang thành viên hiện tại (khác → `USER_NOT_FOUND`); chủ cũ thành `member`. Mỗi phòng đúng 1 owner (ràng buộc DB) | FR-98 |
| X2a-R12 | Xoá phòng nhóm (chủ): xoá mềm `deleted_at`; mọi thành viên nhận `room.deleted`, sau đó 404. Không khôi phục ở v1 | FR-98, CR-047 R10 |
| X2a-R13 | Bị bớt/đã rời: mất quyền đọc **toàn bộ** phòng (404), không nhận sự kiện nữa. Được thêm lại → thấy toàn bộ lịch sử (như thành viên mới) | FR-96, CHAT-AC-44 |
| X2a-R14 | Thành viên mới thấy **toàn bộ** lịch sử từ tin đầu tiên (không cắt theo `joined_at`) | FR-96, CR-047 R8 |
| X2a-R15 | Tin: `content` trim, 1…`CHAT_CONTENT_MAX` (16.000). Không sửa, không xoá. Thứ tự = `seq` tăng dần do DB cấp (không tin đồng hồ client). `client_msg_id` (uuid) chống gửi trùng: cùng (room, sender, client_msg_id) → trả tin đã có (200) | FR-96, CR-047 R10 |
| X2a-R16 | X2a: `@xxx` trong tin phòng là **chữ thường** (không gọi agent, không lỗi); X2b bật `@agent` | CR-048 |
| X2a-R17 | Chưa đọc của (user, phòng) = số tin `seq > last_read_seq` mà `sender_id ≠ user`. Tổng = tổng các phòng hiện thấy (không gồm DM đang ẩn) | FR-100, AC-H25 |
| X2a-R18 | `POST /rooms/:id/read {seq}`: mốc đọc chỉ **tăng** (`greatest`), `seq` lớn hơn tin cuối → kẹp về tin cuối. Gửi tin = tự đánh dấu đã đọc tới tin đó cho người gửi | FR-100 |
| X2a-R19 | "Đã đọc" (đã xem): sau khi mốc đọc của X tăng, các thành viên khác nhận `room.read {room_id, user_id, seq}` | CR-047 R9 |
| X2a-R20 | Sự kiện chỉ gửi cho **thành viên lúc sự kiện xảy ra** (tính trong transaction ghi). Người bị bớt nhận đúng một `room.member_removed` rồi thôi | FR-99, AC-H23 |
| X2a-R21 | `XADD` **sau commit** DB (TECH-DEBT #13); lỗi Redis không hỏng ghi DB, client đồng bộ lại qua `stream.reset` (§6) | FR-99 |
| X2a-R22 | Danh bạ: chỉ user dùng được cùng tenant, trừ chính mình; chỉ trả `id`, `display_name`, `username`, `active`. Không email, role, group, tenant khác (schema zod `.strict()`) | FR-102, CHAT-AC-37 |
| X2a-R23 | Hội thoại C1 giữ nguyên trang `/c/:id`, API, RLS, AC-H07/H08; bảng phòng tách riêng (không thêm `room_id` vào `hub.messages`) | CR-047 R13, BR-22 |
| X2a-R24 | Không log nội dung tin phòng (chỉ id, độ dài) | HUB-NFR-04 |

## 3. Contract (backend-lead chốt schema ở PLAN)
File mới: `packages/contracts/src/chat/{rooms,directory,me-stream}.ts`, thêm export vào `chat/index.ts`; mã lỗi `CHAT_ROOM_ERRORS` trong `chat/errors.ts` (thêm khối mới, không đổi khối cũ). Mọi endpoint: Bearer JWT (như C1), mọi role người dùng.

| Method | Path | Ai | Request | Response | Lỗi |
|---|---|---|---|---|---|
| GET | `/directory` | user | `?q=` (≤ `LIST_Q_MAX`, tìm `display_name`/`username`, không phân biệt hoa thường), `?limit` | `{items: DirectoryUser[]}` | 400 `VALIDATION_ERROR` |
| GET | `/rooms` | user | `?cursor`, `?limit` | `{items: RoomSummary[], next_cursor, unread_total}` — sắp theo tin cuối mới nhất; gồm `kind`, `name`/`peer` (DM), `last_message` (xem trước), `unread`, `member_count` | — |
| POST | `/rooms` | user | `{kind:"dm", user_id}` hoặc `{kind:"group", name, member_ids[]}` | DM: 200 phòng cũ / 201 mới; nhóm: 201 · `RoomDetail` | 400 `VALIDATION_ERROR`/`DM_SELF` · 404 `USER_NOT_FOUND` · 409 `ROOM_FULL` |
| GET | `/rooms/:id` | thành viên | — | `RoomDetail` (+ `members[]`: id, display_name, username, role, `last_read_seq`; `my_role`) | 404 `ROOM_NOT_FOUND` |
| PATCH | `/rooms/:id` | chủ | `{name}` | `RoomDetail` | 404 · 403 `NOT_ROOM_OWNER` · 409 `DM_IMMUTABLE` · 400 |
| DELETE | `/rooms/:id` | chủ | — | 204 | 404 · 403 · 409 `DM_IMMUTABLE` |
| POST | `/rooms/:id/members` | chủ | `{user_ids[]}` (giới hạn: plan D8) | `RoomDetail` | 404 · 403 · 409 `DM_IMMUTABLE`/`ROOM_FULL` · 404 `USER_NOT_FOUND` |
| DELETE | `/rooms/:id/members/:user_id` | chủ | — (bớt chính mình → dùng `leave`) | 204 | 404 · 403 · 409 `DM_IMMUTABLE` · 400 |
| POST | `/rooms/:id/leave` | thành viên | — | 204 | 404 · 409 `DM_IMMUTABLE`/`OWNER_MUST_TRANSFER` |
| POST | `/rooms/:id/transfer` | chủ | `{user_id}` | `RoomDetail` | 404 · 403 · 409 `DM_IMMUTABLE` · 404 `USER_NOT_FOUND` |
| POST | `/rooms/:id/hide` | thành viên DM | — | 204 | 404 · 409 `GROUP_NOT_HIDEABLE` |
| GET | `/rooms/:id/messages` | thành viên | `?before_seq`, `?limit` (mặc định 50) | `{items: RoomMessage[] (seq tăng dần), has_more}` | 404 |
| POST | `/rooms/:id/messages` | thành viên | `{content, client_msg_id}` | 201 `RoomMessage` (200 nếu trùng `client_msg_id`) | 404 · 400 |
| POST | `/rooms/:id/read` | thành viên | `{seq}` | `{unread, unread_total}` | 404 · 400 |
| GET | `/me/stream` | user | header `Last-Event-ID` (tuỳ chọn) | `text/event-stream` (§6) | 401 |

`RoomMessage` (X2a ghi `sender_type:"user"`; trường dự phòng X2b có trong schema dạng nullable/optional): `id, room_id, seq, sender_type ("user"|"agent"), sender {id, display_name}, content, created_at, run_id?, flow_id?, trigger_message_id?`.

**Sự kiện `/me/stream`**: `room.message`, `room.unread`, `room.read` (thêm so với BA, X2a-R19), `room.member_added` (người được thêm nhận kèm `room`), `room.member_removed`, `room.updated`, `room.deleted`, `stream.reset` (thêm), `: ping` 15 s — payload + khi nào: [`spec-isolation.md` §1.1](spec-isolation.md).

**`CHAT_ROOM_ERRORS`** (HTTP · code · câu VI/EN do frontend-lead chốt): 404 `ROOM_NOT_FOUND` · 403 `NOT_ROOM_OWNER` · 409 `DM_IMMUTABLE` · 409 `ROOM_FULL` · 409 `OWNER_MUST_TRANSFER` · 409 `GROUP_NOT_HIDEABLE` · 400 `DM_SELF` · 404 `USER_NOT_FOUND`. Không đặt trùng mã khối khác (`CHAT_API_ERRORS`…).

## 4. Dữ liệu (backend-lead)
Migration Hub `packages/db/migrations-hub/0011_x2a_rooms.sql` (viết tay, idempotent như `0010`; không sửa migration đã commit). Bảng `hub.rooms` / `hub.room_members` / `hub.room_messages`, hàm `SECURITY DEFINER`, RLS, `seq`, danh bạ Q1 (không migration Admin), seed dev: **chi tiết ở [`plan-db.md`](plan-db.md) (plan thắng spec)**. Bất biến cần giữ: `scope=system` không dùng cho API phòng; fan-out tính trong transaction của request (scope user). Lệch CR-047 R11 → §10.

## 5. UI (frontend-lead)
Canvas `docs/design/chat-app/canvas-x2/` (README). Câu chữ lấy từ artboard; chỗ thiếu frontend-lead bổ sung ở `plan-frontend.md` (VI/EN đủ, a11y như C1).

### 5.1 Màn và thành phần (X2a)
| Màn / thành phần | Nội dung | Artboard |
|---|---|---|
| Sidebar | Nút "Hỏi AI" (hội thoại AI mới, như C1) + "Nhóm mới"; ô tìm "Tìm hội thoại, người, nhóm"; mục **"Tin nhắn & Nhóm"** (sắp theo tin cuối, xem trước "Tên: …"/"Bạn: …", huy hiệu chưa đọc + tổng) rồi mục **"Hỏi AI"** (hội thoại C1 giữ nguyên) | Main, DM |
| Tin nhắn mới | Tìm trong danh bạ (`GET /directory`) → mở DM (CHAT-AC-37/38) | Main/DM (ô tìm) |
| Màn phòng `/rooms/:id` | Header: tên/peer, "Nhóm · n thành viên · chủ nhóm X", avatar thành viên `+n`, "Thêm người" (chỉ chủ), menu (đổi tên/xoá — chủ; rời — mọi người; DM: chỉ "Ẩn hội thoại"); tin **phẳng** user↔user nhóm theo ngày, tin mình "Bạn · 09:15"; pill "n tin mới"; composer "Tin nhắn cho nhóm" / "Tin nhắn cho <tên>" | Main, DM |
| Tạo nhóm | Dialog: "Tên nhóm *", "Thành viên" chip (gồm "(bạn) · chủ nhóm"), đếm "n / 50 · gồm bạn", tìm "Tìm người trong công ty", "Huỷ"/"Tạo nhóm" | NewGroup |
| Quản lý thành viên | Drawer/dialog từ header: danh sách + vai trò; chủ: thêm (dùng lại picker NewGroup), bớt, chuyển chủ; mọi người: rời (chủ → yêu cầu chuyển chủ trước, CHAT-AC-43) | (mô tả theo NewGroup) |
| Đã xem | DM: "Đã xem" dưới tin cuối của mình khi peer `last_read_seq ≥` tin đó; nhóm: "Đã xem bởi n" (tooltip tên) (Q5) | (không có artboard) |
| Trạng thái | tải · rỗng · lỗi · 404 "Không tìm thấy" (AC-45) · "Đang kết nối lại…" (AC-40) · "Nhóm đã đủ 50 người" | C1 States |
| Điện thoại | Phòng toàn màn, sidebar thành màn danh sách | Mobile |

Đánh dấu đã đọc: phòng mở + tab hiển thị + cuộn tới cuối → `POST /read` (≤ 1 lần/giây). Auth dùng lại C1.

### 5.2 Quyết định UI đã chốt với người dùng (2026-10-07)
Lần 1: *"về UI ổn, follow theo thread như hiện tại nữa là được, giống màn 1 tuy nhiên collapse/expand"*. Lần 2 (cùng ngày, **thay** phần panel): *"cũng không nên show cái sidebar, tôi có thể @ agent luôn cũng được, để đỡ tốn diện tích page"*. Kết quả hiệu lực:
1. **Không có panel agent bên phải** (kể cả trạng thái thu gọn) và **không có hàng chip agent** (cả desktop lẫn điện thoại). Panel bên phải ở artboard Main/DM và hàng chip ở DM/Mobile là phương án cũ, **bỏ**.
2. Danh sách agent dùng được (X2b, HUB-FR-103) hiện qua **menu `@` trong composer** — như Chat hiện có (tên + `@key` + mô tả, lọc theo quyền user, cùng nguồn `GET /agents`). Placeholder composer phòng gợi ý gõ `@` để hỏi agent, `/` để chạy lệnh (câu chữ chốt ở `plan-frontend`; `/` trong phòng chỉ là gợi ý cho X2b, X2a chưa chạy lệnh). Điện thoại: cũng menu `@`.
3. **Giữ mô hình thread/flow C1**: trong phòng, câu trả lời agent là **một khối flow** như hội thoại AI hiện nay — có "Trả lời tiếp" mở **khung flow bên phải** (`?flow=`; điện thoại: sheet từ dưới như C1), câu hỏi tiếp trong flow tiếp tục cùng agent/ngữ cảnh; tin user↔user là tin phẳng.

### 5.3 Chuẩn bị cho X2b (X2a làm sẵn khung, chưa có chức năng)
- Bố cục màn phòng 2 cột (sidebar · dòng thời gian) + **khung flow bên phải** chỉ hiện khi có `?flow=` (dùng lại `flow-panel` C1); X2a chưa mở được khung (route chấp nhận `?flow=` nhưng bỏ qua). Không chừa cột panel agent.
- Thành phần tin nhận `sender_type`: X2a chỉ render `user`; chừa nhánh `agent` (render bằng khối flow C1 `FlowBlock`) để X2b cắm vào. Không parse `@` ở X2a.
- Composer phòng dùng lại khung composer C1 (đã có menu `@`/`/` từ X1) nhưng **tắt menu `@`/`/` ở X2a** (cờ/prop), để X2b chỉ việc bật; placeholder X2a chưa nhắc `@`/`/`.

## 6. Realtime → [`spec-isolation.md` §1](spec-isolation.md)
Khoá Redis theo user, `XREAD` multiplex mỗi instance, `Last-Event-ID` / `stream.reset`, auth Bearer qua fetch (không token trên URL), giới hạn kết nối, ngân sách AC-H25.

## 7. Cách ly — ma trận ai thấy gì → [`spec-isolation.md` §2](spec-isolation.md)
Tóm tắt: chỉ thành viên hiện tại thấy/ghi phòng; mọi người khác (kể cả `tenant_admin`, tenant khác) → 404 + không sự kiện; danh bạ chỉ 4 cột cùng tenant; hội thoại C1 không đổi.

## 8. Tiêu chí nghiệm thu (qc)
Giữ xanh: CHAT-AC-01…36, `test:contract:chat`, AC-H07/H08. Given/When/Then ở `test-plan.md`.

| AC | Nội dung ngắn | Test |
|---|---|---|
| AC-H23 | C/D/`tenant_admin` không thành viên: `GET /rooms/G`, `/messages`, `/me/stream` → 404 / không sự kiện của G | int hub-api |
| AC-H24 | DM mở 2 lần cùng phòng; `DM_IMMUTABLE`; nhóm: B thấy toàn bộ lịch sử, chỉ chủ thêm/bớt, B rời được, người thứ 51 → `ROOM_FULL`; user tenant khác không có trong danh bạ, không thêm được | int |
| AC-H25 | B nhận `room.message` + `room.unread`+1 ≤ 2 s kể cả A, B ở **2 instance**; nối lại `Last-Event-ID` không mất/lặp; đã đọc → `unread=0`; tin của A không tạo chưa đọc cho A | int (2 instance) |
| CHAT-AC-37…45 | Như usecases UC-09, UC-10 | e2e chat |
| X2a-AC01 | Ma trận §7 ở mức DB (`spec-isolation.md` §2): role `hub_api` + GUC của C/D đọc 0 hàng `rooms`/`room_members`/`room_messages` của G; không UPDATE/DELETE được `room_messages` | int `packages/db` |
| X2a-AC02 | Người ngoài **ghi** (`POST messages/read/members/leave/hide`, `PATCH`, `DELETE`) → 404, DB không đổi (X2a-R03) | int |
| X2a-AC03 | Rời/bị bớt → 404 + hết sự kiện sau đúng 1 `member_removed`; thêm lại → thấy toàn bộ lịch sử (R13, R14) | int |
| X2a-AC04 | Chủ rời khi còn người → `OWNER_MUST_TRANSFER`; chuyển chủ rồi rời được; chủ duy nhất rời = xoá phòng (R10, R11) | int |
| X2a-AC05 | Xoá phòng: mọi thành viên nhận `room.deleted`, sau đó 404; không phải chủ → 403 (R04, R12) | int |
| X2a-AC06 | DM ẩn: mất khỏi `GET /rooms` của người ẩn, người kia vẫn thấy; tin mới → hiện lại + chưa đọc (R07) | int + e2e |
| X2a-AC07 | Gửi lại cùng `client_msg_id` → 1 tin, 200; `seq` tăng liền, không trùng khi gửi song song (R15) | int (song song) |
| X2a-AC08 | `Last-Event-ID` quá cũ/sai → `stream.reset`; client tải lại danh sách (§6) | int + unit FE |
| X2a-AC09 | B đọc → A nhận `room.read`; mốc đọc không lùi, kẹp về tin cuối (R18, R19) | int + e2e ("Đã xem") |
| X2a-AC10 | Danh bạ: không email/role/group (schema strict), không user tenant khác/không dùng được/chính mình; tìm theo tên (R22) | int + contract |
| X2a-AC11 | Contract chỉ thêm: mọi export cũ của `@ai/contracts/chat` giữ nguyên tên + hình (snapshot), test contract chat C1 xanh (R23) | unit contract |
| X2a-AC12 | `/me/stream` không token → 401; token không nằm trên URL; JWT hết hạn → stream đóng, client nối lại không mất tin | int + unit FE |
| X2a-AC13 | Nhóm: tên rỗng/>80 → `VALIDATION_ERROR`; tạo với 50 người (gồm chủ) được, 51 → `ROOM_FULL` không ghi dở (R08) | int |
| X2a-AC14 | Chuỗi `@agent` trong tin phòng ở X2a là chữ thường, không tạo run (R16) | int |
| X2a-AC15 | UI: sidebar 2 mục, huy hiệu chưa đọc cập nhật realtime, pill "n tin mới", banner kết nối lại; không có panel agent/hàng chip; composer phòng chưa bật menu `@`/`/` (§5.2, §5.3) | e2e chat |
| X2a-AC16 | Không log nội dung tin phòng (R24) | int |

**`done:x2a`**: qc chốt ở `test-plan.md` (mẫu `done-x1.ts`; gồm int RLS `packages/db` + hub-api 2 instance, contract + e2e chat).

## 9. Câu hỏi mở (đều có mặc định; không trả lời = chấp nhận mặc định)
| Q | Câu hỏi | Mặc định đề xuất |
|---|---|---|
| Q1 | Migration Admin cho danh bạ? | **Không cần**: `hub_ro` đã có `SELECT` cột cần (0002). Không thu hẹp cột cũ (email/role) ở X2a để khỏi vỡ code Hub hiện có; ghi TECH-DEBT "thu hẹp cột `admin.users` cho `hub_ro`" (gần #34) |
| Q2 | `room_messages` bảng riêng hay `hub.messages` + `room_id`? | **Bảng riêng** (BA §8 để spec chốt): không đụng policy `messages` theo `user_id` / AC-H07 |
| Q3 | Đính kèm file trong phòng (artboard Main có file PDF)? | **Hoãn sang X2b** (cần cho "file đã gửi vào phòng", HUB-FR-101); X2a không nút đính kèm ở composer phòng |
| Q4 | Mô hình flow trong phòng (X2b) | Như §5.2 mục 3: kết quả agent = khối flow; "Trả lời tiếp" mở `?flow=`; tin trong flow là `room_messages` có `flow_id` (dòng thời gian chính chỉ hiện khối gốc + "n tin trong luồng"). X2a chỉ chừa cột `flow_id`/`run_id`/`trigger_message_id`; FK + `runs.room_id` + ai được hỏi tiếp trong flow + tin flow có tính chưa đọc không → chốt ở spec X2b |
| Q5 | Hiển thị "đã xem" | DM "Đã xem"; nhóm "Đã xem bởi n" dưới tin cuối của mình (tooltip tên) |
| Q6 | Tìm danh bạ bỏ dấu? | Không ở X2a (ILIKE); → TECH-DEBT |
| Q7 | e2e chat chạy với gì? | hub-api thật + DB test (stack như e2e X1), không mở rộng mock Hub C1 cho **realtime** (không phát sự kiện). Stub tối thiểu không tính là mở rộng: `GET /rooms` → `{items:[],next_cursor:null,unread_total:0}` (khớp `RoomListResponseSchema`, plan §2), `GET /directory` → `{items:[]}`; `GET /me/stream` → SSE 200 chỉ ping (task B3); mock còn lại chỉ `page.route` cho trạng thái lỗi |
| Q8 | Giữ bao nhiêu sự kiện/user trong Redis? | `MAXLEN ~ 1000`; quá → `stream.reset` |
| Q9 | Đường dẫn phòng | `/rooms/:id` (CHAT-AC-45); C1 giữ `/c/:id` |

## 10. Quyết định
### Trước Gate (đã chốt với người dùng)
- [x] 2026-10-07 CR-047 R1–R13: cùng tenant; DM không đổi tên/thêm người; ai cũng tạo nhóm, chủ quản lý, ≤ 50; lịch sử đầy đủ cho thành viên mới; không sửa/xoá tin; chủ xoá phòng; DM ẩn phía mình; realtime v1 = tin mới + chưa đọc + đã đọc; contract chat chỉ thêm; được sửa Chat/`packages/db` cho X2.
- [x] 2026-10-07 UI: canvas X2 đã duyệt (bố cục phòng, tạo nhóm, mobile) + giữ thread/flow C1; **bỏ panel agent/hàng chip, dùng menu `@` trong composer** (người dùng đổi ý cùng ngày, §5.2).
- Lệch phát hiện khi tách spec: CR-047 R11 giả định cần migration `SELECT` hẹp trên `admin.users`, nhưng `hub_ro` đã có quyền (Q1).
### Trong lúc làm (agent tự quyết theo Luật 2)
- 2026-10-07 [docs-architect, readiness R1, Luật 2b] Stub mock Hub (`tools/mocks/src/*`) cho `/rooms`, `/directory`, `/me/stream` ở mức tối thiểu để e2e C1 xanh, không phải mở rộng realtime (Q7, task B3); `hub.create_room` kiểm `is_tenant_user` (plan-db §4.2); tên FE theo contract BE (`parseMeStreamEvent`, `last_activity_at`, `preview`, `owner_id`+`members[]`); 400 = `VALIDATION_ERROR`; `pingMs` trong deps `startHub` (mặc định 15000); QC1 chỉ khoá `tests/acceptance/X2a/**` + `e2e/chat/x2a-*`, contract `x2a-*` là lưới phụ; token giao diện DataZeus (nếu áp) thuộc mốc UI riêng, không chặn X2a, e2e X2a không khẳng định màu/ảnh chụp.
- 2026-10-07 [frontend-lead, PLAN P2] Q5 "Đã xem" DM/nhóm dưới tin cuối của mình; Q9 `/rooms/$id`; mở DM qua ô tìm sidebar mục "Người"; mobile giữ Sheet danh sách C1; Composer phòng thêm prop `menus`/`attachments`; `shell.newChat` → "Hỏi AI"; ngưỡng JS chat có thể nới 150 → 160 KB (chi tiết `plan-frontend.md` §0, §14).
- 2026-10-07 [backend-lead, PLAN P1] Tự quyết D1–D16 → `plan.md` §1 (đổi so với spec: 400 = `VALIDATION_ERROR` (spec cũ ghi mã khác); bỏ `rooms.owner_id`; `member_ids`/`user_ids` ≤ 200, > 50 ⇒ `ROOM_FULL`; thêm `client_msg_id`, `last_seq`, `preview`).
- 2026-10-07 [backend-lead, B1] `create_room`: kind lạ/peer sai ⇒ 22023; `dm_key` so uuid (không theo collation).
- 2026-10-07 [backend-lead, B2] `DirectoryQuerySchema` non-strict (khoá lạ bỏ qua); query/`RoomList`/`MessageList` strict; `RoomFullDetails.requested` ≥ 0.

## 11. Rủi ro → [`spec-isolation.md` §3](spec-isolation.md)
RLS đệ quy/lọt hàng khi tạo phòng, sự kiện lọt cho người vừa bị bớt, mất sự kiện khi Redis lỗi, tranh chấp `seq`, cạn kết nối SSE, hồi quy C1, `hub_ro` đọc rộng `admin.users`.

## 12. Tranh chấp test
- 2026-10-07 [backend-lead, B1] D11b đỏ khi chạy cả file (riêng thì xanh): D08 commit sẵn DM `lan`–`hoa` acme ⇒ `create_room` trả phòng cũ (R05). Đề xuất: D08 dùng cặp khác.
- 2026-10-07 [qc] Phân xử: test sai (phụ thuộc thứ tự, không phải code) — D08 đổi cặp `lan`–`hoa` sang `lan`–`tam`; D11b giữ nguyên; db-rls 18/18 xanh 2 lần liên tiếp; khoá đã cập nhật.
