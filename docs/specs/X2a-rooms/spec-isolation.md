# X2a · Phụ lục: realtime, cách ly, rủi ro

Phụ lục của [`spec.md`](spec.md) (tách để giữ spec ≤ 25 KB). Mã luật/AC: xem spec §2, §8.

## 1. Realtime (backend-lead chốt ở plan)
| Mục | Mặc định |
|---|---|
| Khoá Redis | Stream theo user `ustream:<user_id>` (`XADD … MAXLEN ~ 1000`); fan-out khi ghi (≤ 50 thành viên/phòng). Tách hẳn khỏi `run:<run_id>`/`sse:<run_id>` |
| Đọc | Mỗi instance Hub một kết nối chặn `XREAD BLOCK` multiplex cho mọi user đang nối (mẫu `RunStreamReader`); không pub/sub trong bộ nhớ ⇒ đúng với nhiều instance |
| Nối lại | `Last-Event-ID` = id Redis Stream; đọc tiếp từ đó; id < phần tử cũ nhất còn giữ hoặc sai định dạng → `stream.reset` rồi phát tiếp từ `$` |
| Auth | Bearer qua `fetch` stream (như `apps/chat-web/src/lib/sse.ts`), **không** token trên URL; JWT hết hạn → server đóng stream, client refresh rồi nối lại kèm `Last-Event-ID` |
| Nhiều tab | Mỗi tab một kết nối; `room.unread` đồng bộ giữa tab |
| Giới hạn | ≤ 5 kết nối đồng thời/user/instance (vượt → đóng cái cũ nhất); ping 15 s |
| Ngân sách | AC-H25: B nhận `room.message` ≤ 2 s (đo ở int test 2 instance; perf không chặn mốc — TECH-DEBT #27) |

### 1.1 Sự kiện
Sự kiện `/me/stream` (BA §9.2 + thêm `room.read`, `stream.reset`; `id:` = id Redis Stream):

| event | data | Khi |
|---|---|---|
| `room.message` | `{room_id, message: RoomMessage}` | tin mới (gửi cả người gửi — để đồng bộ tab khác) |
| `room.unread` | `{room_id, unread, total}` | chưa đọc của chính user đổi (tin mới, đã đọc ở tab khác) |
| `room.read` | `{room_id, user_id, seq}` | thành viên khác tăng mốc đọc (X2a-R19) |
| `room.member_added` | `{room_id, user_id, room?: RoomSummary}` | người được thêm nhận kèm `room`; người khác chỉ id |
| `room.member_removed` | `{room_id, user_id}` | bớt/rời (X2a-R20) |
| `room.updated` | `{room_id, name?, owner_id?}` | đổi tên, chuyển chủ |
| `room.deleted` | `{room_id}` | xoá phòng |
| `stream.reset` | `{}` | `Last-Event-ID` quá cũ/không hợp lệ → client tải lại `/rooms` + phòng đang mở |
| (comment) `: ping` | — | mỗi 15 s giữ kết nối |

## 2. Cách ly — ma trận ai thấy gì
| Người gọi | Phòng G (A chủ, B thành viên) | DM A–B | Danh bạ | Hội thoại C1 của A |
|---|---|---|---|---|
| A (chủ) | đọc, gửi, quản lý | đọc, gửi, ẩn | user acme dùng được, trừ A | thấy (như cũ) |
| B (thành viên) | đọc toàn bộ lịch sử, gửi, rời | đọc, gửi, ẩn | như trên | 404 (AC-H07) |
| C cùng tenant, không thành viên | 404 mọi endpoint, không sự kiện | 404 | thấy A, B (4 cột) | 404 |
| B sau khi rời/bị bớt | 404, hết sự kiện (sau `member_removed`) | — | — | — |
| `tenant_admin` acme, không thành viên | **404** (không ngoại lệ admin) | 404 | như C | 404 |
| D tenant khác (kể cả `platform_admin`) | 404 | 404 | không thấy user acme | 404 |
| `hub_api` DB, GUC user C | 0 hàng ở 3 bảng phòng của G | 0 hàng | — | — |

## 3. Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Policy RLS đệ quy / lọt hàng khi tạo phòng (chưa có thành viên) | Hàm `SECURITY DEFINER` `is_room_member` + luồng tạo phòng chốt ở plan; int test `test-plan.md` §4 ở mức DB (X2a-AC01); **security review riêng** (Opus) ở bước review |
| Sự kiện lọt cho người vừa bị bớt | Danh sách nhận tính trong transaction ghi (R20); test X2a-AC03 |
| Mất sự kiện khi Redis lỗi sau commit | `stream.reset` + client tải lại khi nối lại; chưa đọc luôn tính từ DB |
| Tranh chấp `seq` khi gửi song song | Khoá hàng `rooms` + unique `(room_id, seq)`; test song song X2a-AC07 |
| Kết nối SSE dài làm cạn kết nối Redis/DB | Một kết nối chặn/instance (multiplex), không giữ transaction DB trong stream |
| Sidebar mới làm hồi quy C1 | CHAT-AC-01…36 + contract chat trong `done:x2a` |
| `hub_ro` đọc được email/role mọi tenant (sẵn có) | Directory chọn đúng 4 cột + lọc tenant; schema strict; TECH-DEBT thu hẹp (Q1) |

