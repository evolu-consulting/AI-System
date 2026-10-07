# X2a · Phụ lục plan-frontend: role/nhãn và ca e2e

Phụ lục của [`plan-frontend.md`](plan-frontend.md). Nhãn phải giữ đúng khi code (frontend-lead); ca e2e do qc viết.

## 1. Role + nhãn cho e2e (VI; giữ nguyên khi code)
| Vùng | Locator |
|---|---|
| Sidebar | `navigation "Hội thoại"` (giữ nguyên aria-label) · `link "Hỏi AI"` (→ `/c/new`) · `button "Nhóm mới"` · `searchbox "Tìm hội thoại, người, nhóm"` · `region "Tin nhắn & Nhóm"` (`<section aria-labelledby>`, tiêu đề `h3`) · `region "Hỏi AI"` (`h3`) · `link "<tên phòng/peer>"` (tên accessible = chỉ tên; xem trước + "n tin chưa đọc" nằm ở `aria-describedby`; `aria-current="page"` khi mở) · huy hiệu `data-testid="unread-badge"` (text = số) · tổng `data-testid="unread-total"` · người trong kết quả: `button "Nhắn tin với <tên>"` |
| Ghi chú C1 | Nhóm thời gian của "Hỏi AI" **giữ `h2`** (e2e C1 đã khoá lọc `h2, a[href^="/c/"]`); tiêu đề hai mục dùng `h3`. Đổi chữ: `shell.newChat` "Hội thoại mới" → "Hỏi AI"; `shell.search` "Tìm hội thoại" → "Tìm hội thoại, người, nhóm" (e2e C1 dùng `searchbox { name: "Tìm hội thoại" }` khớp chuỗi con → vẫn qua; qc rà `link "Hội thoại mới"` ở unit/e2e C1) |
| Header phòng | `heading` cấp 1 = tên nhóm / tên peer · text "Nhóm · 5 thành viên · chủ nhóm Minh Trần" · `button "Thành viên (5)"` · `button "Thêm người"` (chỉ chủ, nhóm) · `button "Tuỳ chọn phòng"` → `menuitem "Đổi tên nhóm"` / `"Xoá nhóm"` (chỉ chủ) / `"Rời nhóm"` / `"Thành viên"`; DM: `button "Ẩn hội thoại"` (không có đổi tên/thêm/xoá/rời) |
| Dòng thời gian | `log "Tin nhắn của phòng"` · mỗi tin `article` có `aria-label="<tên>, <giờ>"` (mình: "Bạn, <giờ>") · `separator`/`heading` cấp 3 ngày · `button "n tin mới"` (pill) · `status` "Đã xem" / "Đã xem bởi n" |
| Composer phòng | `textbox "Tin nhắn cho <tên|nhóm>"` (aria-label cũng là placeholder: "Tin nhắn cho nhóm" / "Tin nhắn cho Minh Trần") · `button "Gửi"`; **không** có `button "Đính kèm"`, **không** có `listbox` menu khi gõ `@`/`/` |
| Tạo nhóm | `dialog "Tạo nhóm"` · `textbox "Tên nhóm"` (nhãn "Tên nhóm" + dấu `*` `aria-hidden`, `aria-required`) · `list "Thành viên đã chọn"` (chip "Thu Hà (bạn) · chủ nhóm" + chip khác có `button "Bỏ <tên>"`) · `status` "4 / 50 · gồm bạn" · `searchbox "Tìm người trong công ty"` · `checkbox "<tên>"` (mô tả = username) · `button "Huỷ"` · `button "Tạo nhóm"` (`disabled` khi tên rỗng) |
| Thêm người | `dialog "Thêm người vào nhóm"` · cùng searchbox/checkbox · người đã trong nhóm: `checkbox` `disabled` + "Đã trong nhóm" · `button "Thêm"` · `button "Huỷ"` |
| Thành viên | `dialog "Thành viên"` · `list` + `listitem` (tên, `@username`, nhãn "Chủ nhóm") · chủ: `button "Tuỳ chọn của <tên>"` → `menuitem "Chuyển quyền chủ nhóm"` / `"Bớt khỏi nhóm"` |
| Xác nhận | `alertdialog "Xoá nhóm?"` · `alertdialog "Rời nhóm?"` · `alertdialog "Chuyển quyền chủ nhóm?"` · `alertdialog "Bớt khỏi nhóm?"` — nút xác nhận `button "Xoá"`/`"Rời nhóm"`/`"Chuyển quyền"`/`"Bớt"`, nút `button "Huỷ"` · chủ rời khi còn người: `alertdialog "Chuyển quyền chủ nhóm trước khi rời"` + `button "Mở danh sách thành viên"` |
| Đổi tên | `dialog "Đổi tên nhóm"` · `textbox "Tên nhóm"` · `button "Lưu"` |
| Trạng thái | `status` "Đang kết nối lại…" · `alert` "Không kết nối được máy chủ" + `button "Thử lại"` · 404: `heading` "Không tìm thấy cuộc trò chuyện" + `link "Về trang chào"` · toast qua `sonner` (`status`) |

`data-testid` chỉ khi role không đủ: `unread-badge`, `unread-total`, `data-room-id` trên `link` phòng, `data-seq` trên `article` tin (qc khử trùng/thứ tự).


## 2. E2E (qc viết; hub-api thật + DB test, Q7)
Cấu hình đề xuất: `e2e/chat/playwright.x2a.config.ts` (đuôi `.x2a.ts`, như mẫu `*.combine.ts`/`*.x1.ts`) chạy `chat-web` build/preview + hub-api thật + Postgres/Redis test + 2 user acme đăng nhập bằng 2 `browser.newContext()` (A, B); `page.route` chỉ dùng cho ca lỗi (500 `/rooms`, đứt `/me/stream`). Ca FE cần phủ:
| Ca | Nội dung | AC |
|---|---|---|
| E-R1 | sidebar có 2 `region`; không có panel/chip agent; gõ `@` trong composer phòng không mở `listbox` | X2a-AC15 |
| E-R2 | A tìm B ở searchbox → `button "Nhắn tin với …"` → vào `/rooms/:id`; mở lần 2 cùng id; DM không có đổi tên/thêm/xoá | CHAT-AC-37, 38 |
| E-R3 | A gửi, B (context khác) thấy tin ≤ 2 s + `unread-badge`, `unread-total`; B mở phòng → về 0; A thấy "Đã xem" | CHAT-AC-39, AC09 |
| E-R4 | tạo nhóm (tên + 2 người) → chủ; người thứ 51 → "Nhóm đã đủ 50 người" (seed 49) | CHAT-AC-41 |
| E-R5 | chủ thêm/bớt/đổi tên/xoá; thành viên thường không thấy nút; thêm người mới thấy toàn bộ lịch sử | CHAT-AC-42, 44 |
| E-R6 | rời nhóm; chủ rời khi còn người → `alertdialog "Chuyển quyền chủ nhóm trước khi rời"`; chuyển rồi rời được | CHAT-AC-43 |
| E-R7 | gõ tay `/rooms/<id lạ>` → "Không tìm thấy cuộc trò chuyện" | CHAT-AC-45 |
| E-R8 | chặn `/me/stream` → `status` "Đang kết nối lại…" → bỏ chặn → không mất/lặp tin | CHAT-AC-40 |
| E-R9 | ẩn DM → biến khỏi sidebar; tin mới của peer → hiện lại + badge | X2a-AC06 |
| E-R10 | pill "n tin mới" khi cuộn lên và có tin đến | X2a-AC15 |
| E-R11 | mobile 390×844: Sheet danh sách, phòng toàn màn, không chip | Mobile |
Unit FE (tôi viết cùng code): `event-router` (mỗi sự kiện bảng §3, `stream.reset`), `me-stream-driver` (nối lại, `Last-Event-ID`, 401→refresh, đóng khi `stop`), `room-logic` (xem trước, nhóm ngày, `seenBy`, kẹp `seq`), `room-errors` (đủ mã), `use-mark-read` (throttle), `Composer` (`menus={false}` không gọi `/agents`). Không sửa `tests/acceptance/**`, `e2e/**`.

