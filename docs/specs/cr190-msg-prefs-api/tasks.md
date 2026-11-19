---
id: cr190-msg-prefs-api
lát: cr190-msg-prefs-api
cr: CR-190
làn: đầy đủ
migration: pack-contracts 0126
phụ thuộc:
---
## Plan (ngắn)
Máy chủ nhớ THEO TỪNG NGƯỜI: ghim hội thoại và «đánh dấu chưa đọc», cho cả cuộc nội bộ (`contracts.msg_*`) lẫn cuộc đối tác (`hub.pmsg_*`). Một bảng đa hình `contracts.msg_conv_prefs` (RLS tenant + chỉ chính chủ). Danh sách và chi tiết hội thoại trả kèm `pinned_at` + `marked_unread`; mở cuộc (đánh dấu đã đọc) tự xoá cờ.

## Làm
- [x] Migration `0126_cr190_msg_conv_prefs.sql` + journal: bảng `msg_conv_prefs (tenant_id, user_id, conv_kind, conv_id, pinned_at, marked_unread_at)`, PK 4 cột, CHECK `conv_kind`, RLS RESTRICTIVE chỉ chính chủ + chỉ người nội bộ; chèn cuộc `internal` phải là thành viên.
- [x] Contract: `PinRequestSchema`, `MarkUnreadRequestSchema`, `ConvPrefsSchema`; `ConversationSummary` thêm `pinned_at`, `marked_unread`.
- [x] API: `PUT /messages/conversations/:id/pin` · `PUT …/mark-unread` (nội bộ); `PUT /messages/partner/:id/pin` · `PUT …/mark-unread` (đối tác). Thân `{pinned}` / `{unread}`, trả `{pinned_at, marked_unread}`.
- [x] Danh sách (`GET /messages/conversations`) và chi tiết (`GET …/:id`, `GET /messages/partner/:id`) trả kèm; MỘT câu `prefsOf` cho cả trang.
- [x] `POST …/read` (nội bộ và đối tác) xoá cờ «chưa đọc».
- [x] Tổng chưa đọc (`GET /messages/unread`, `unread_total`) cộng +1 mỗi cuộc có cờ mà không còn tin chưa đọc thật.

## Không làm / Chạm
Không làm: UI (lát `cr190-msg-list-ui`), thay đổi ai được nhắn ai, sắp xếp ghim-trước phía máy chủ (UI sắp theo `pinned_at`), lọc `?unread=true` theo cờ.
Chạm: `packages/db/migrations-pack-contracts` (0126 + journal), `packages/contracts/src/pack-contracts/messages.ts`, hub-api `packs/contracts/messages` (`adapters/messages-prefs.repo.ts`, `application/messages-prefs.usecase.ts` mới; `messages.repo/routes/usecase/ports/view`, `partner.routes`, `partner-chat.usecase`).

## Test tối thiểu
int `messages-prefs-cr190.int.test.ts` (route + RLS, evotest `-Dirty`); chạy lại để chắc không vỡ: `messages.int`, `messages-read-cr178.int`, `messages-rls.int`, `pmsg-api.int`, `pmsg-partner-api.int`, `company-name.int` (dựng DB sạch = migrate); unit `application/*`; `tsc` hub-api.

## Quyết định trong lúc làm
- `conv_kind` = `internal | partner`, không FK (cuộc partner ở schema hub). Quyền ghi nằm ở use case: nội bộ phải là thành viên (`facts`), đối tác phải là một đầu cuộc (`pmsg_detail` ⇒ 404); RLS chặn thêm: ghim `internal` phải thuộc `msg_my_conversations()`.
- Hàng hết gì để nhớ (cả ghim lẫn cờ trống) bị xoá trong cùng câu (CTE `delete` + `update` trên hai tập hàng rời nhau) — không để hàng rỗng.
- Cờ «chưa đọc» KHÔNG đụng `last_read_seq`/mốc đọc đối tác. «Mở cuộc» = lúc gọi `POST …/read` (chỗ UI đã gọi khi mở). `GET` chi tiết không xoá cờ (để xem trước/tải lại không mất cờ).
- Tổng chưa đọc: cuộc nội bộ chỉ +1 khi KHÔNG còn tin chưa đọc thật (không đếm đôi); cuộc đối tác +1 mỗi cờ vì hàm hub đếm thật là nội bộ (không có migration hub trong lát) ⇒ cuộc đối tác vừa có tin chưa đọc thật vừa có cờ đếm hơn 1.
- Cột `pinned_at`/`marked_unread` ở contract để `.optional()` (máy chủ luôn gửi) để không buộc sửa fixture test khoá của gói `messages-web`.
- Lọc `?unread=true` giữ nguyên (không tính cờ): bộ lọc phía nguồn đối tác dùng hàm hub nội bộ; lát UI bỏ tab «Chưa đọc».
- Bỏ khỏi nhóm / người cuối rời nhóm: hàng ghim cũ của cuộc `internal` còn lại nhưng vô hại (đọc luôn đi qua thành viên); ghi nhận, không dọn trong lát.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan.md
#### Yêu cầu: Ghim và đánh dấu chưa đọc theo từng người
Mỗi người tự ghim hội thoại (nội bộ và đối tác) và «đánh dấu chưa đọc»; máy chủ nhớ theo người, người khác (kể cả cùng cuộc, cùng công ty) không thấy. Danh sách và chi tiết hội thoại trả kèm `pinned_at` và `marked_unread`. Cờ chưa đọc không đổi mốc đã đọc, tự xoá khi mở cuộc (đánh dấu đã đọc) và được cộng vào tổng chưa đọc khi cuộc không còn tin chưa đọc thật. Người ngoài cuộc ghim/đánh dấu ⇒ 404.
- Kịch bản: khi người được giao (không phải người tạo) ghim thì chỉ người đó thấy ghim [test: apps/hub-api/src/modules/packs/contracts/messages/messages-prefs-cr190.int.test.ts » VY (được giao, không phải người tạo) ghim: VY thấy `pinned_at`, TIEN (người tạo) và LAN thì không, phản hồi đúng contract]
- Kịch bản: khi người ngoài cuộc (cùng công ty hoặc công ty khác) ghim thì bị 404 và không tạo dữ liệu [test: apps/hub-api/src/modules/packs/contracts/messages/messages-prefs-cr190.int.test.ts » người ngoài cuộc (LAN, cùng công ty) và người công ty khác (DUNG) ghim ⇒ 404 `MSG_NOT_FOUND`, không tạo hàng]
- Kịch bản: khi bỏ ghim mà không còn cờ nào thì xoá hẳn bản ghi [test: apps/hub-api/src/modules/packs/contracts/messages/messages-prefs-cr190.int.test.ts » thân sai ⇒ 400, bỏ ghim ⇒ xoá hàng (không để hàng rỗng)]
- Kịch bản: khi đánh dấu chưa đọc thì số chưa đọc thật giữ nguyên, tổng chưa đọc +1 và chỉ người đánh dấu thấy [test: apps/hub-api/src/modules/packs/contracts/messages/messages-prefs-cr190.int.test.ts » VY đọc hết rồi đánh dấu: cờ chỉ của VY, số chưa đọc thật vẫn 0, tổng chưa đọc +1, TIEN không bị ảnh hưởng]
- Kịch bản: khi mở cuộc thì cờ chưa đọc tự xoá và cuộc có tin chưa đọc thật không bị đếm đôi [test: apps/hub-api/src/modules/packs/contracts/messages/messages-prefs-cr190.int.test.ts » mở cuộc (đã đọc) xoá cờ, cuộc đang có tin chưa đọc thật + cờ không bị đếm đôi]
- Kịch bản: khi mở cuộc thì chỉ xoá cờ, giữ ghim [test: apps/hub-api/src/modules/packs/contracts/messages/messages-prefs-cr190.int.test.ts » ghim + cờ cùng lúc: mở cuộc xoá cờ giữ ghim, bỏ ghim xoá hàng, người ngoài (LAN, DUNG) đánh dấu ⇒ 404]
- Kịch bản: khi người đầu kia của cuộc đối tác ghim/đánh dấu thì người mở cuộc không thấy, người thứ ba bị 404 [test: apps/hub-api/src/modules/packs/contracts/messages/messages-prefs-cr190.int.test.ts » HA (đầu kia, không phải người mở cuộc) ghim + đánh dấu: VY (người mở) không thấy, DUNG (người thứ ba) và LAN ⇒ 404, không tạo hàng]
- Kịch bản: khi mở cuộc đối tác thì xoá cờ, giữ ghim [test: apps/hub-api/src/modules/packs/contracts/messages/messages-prefs-cr190.int.test.ts » tổng chưa đọc của HA tính cả cờ, mở cuộc (đã đọc) xoá cờ, giữ ghim]
- Kịch bản: khi đọc trực tiếp bảng tuỳ chọn thì chỉ thấy hàng của chính mình, không ghi hộ người khác, cuộc nội bộ phải là thành viên [test: apps/hub-api/src/modules/packs/contracts/messages/messages-prefs-cr190.int.test.ts » không ghi hộ người khác, cuộc nội bộ không phải thành viên không ghim được, sửa/xoá hàng người khác không tác dụng]

## Việc còn lại
- Lát `cr190-msg-list-ui`: gọi API, sắp ghim-trước, «⋯» ghim/đánh dấu, điện thoại giữ lâu; gọi `POST …/read` khi mở cuộc để xoá cờ.
- Gộp: kiểm `meta/_journal.json` của pack-contracts (`when` tăng dần; 0125 và 0127 là của CR khác).
