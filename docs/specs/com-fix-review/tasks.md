# com-fix-review — sửa lỗi review cuối đợt CR-102 (community)

Làn: đầy đủ cho Cao-1/TB-2/TB-4 (tx, RLS), nhanh cho phần còn lại. Migration chưa deploy ⇒ sửa thẳng file (template test băm nội dung ⇒ tự dựng lại).

| # | Việc | Trạng thái |
|---|------|------------|
| Cao-1 | Chuông community phát SAU commit (`communityEvents.emit*` mở tx hệ thống riêng; service trả dữ liệu sự kiện như mẫu outbox của rooms). `HostBookReader.stockHolders(tenant, product)`: 1 tx sổ (2 câu) + 1 câu quyền đọc theo tập (`packHosts`) — bỏ vòng `hostBook.read` từng chủ quản. Int: 6 tx tuần tự, tối đa 1 tx mở, số câu không đổi khi thêm chủ quản; 10 bài song song trên pool 2 xong | ✔ |
| TB-2 | `savedBy` mặc định đọc `quote_saves` trong tx phát; `emitPriceEdited`/`emitComment` cũng sau commit (không tx lồng) | ✔ |
| TB-3 | seed-community-demo: `--out` bắt buộc; từ chối APP_ENV=production / DB host ngoài localhost·*.localhost·*.test·postgres·db trừ `--i-know-prod`; chmod 600 file cũ; in cảnh báo xoá file | ✔ |
| TB-4 | 0066: nhánh `source='quote'` của policy UPDATE chỉ cho đặt `replaced_at` trên dòng còn sống (WITH CHECK removed_at IS NULL AND replaced_at IS NOT NULL) | ✔ |
| TB-5 | hub 0063: CHECK NOT VALID + VALIDATE; contracts 0067: `SET LOCAL lock_timeout = '5s'` | ✔ |
| Thấp-6 | Ghi dấu "đã lưu" lỗi ⇒ log `community-quote-mark-failed` (price_id…) rồi ném lại | ✔ |
| Thấp-7 | host-book: hạn giá theo ngày tenant (`timeZoneOf` + `now`), không `current_date` | ✔ |
| Thấp-8 | Tab NCC & giá: trần 200 dòng ưu tiên dòng còn hiệu lực | ✔ |
| Thấp-9 | `quote_saves.comment_ref` (id gốc) + FK `ON DELETE SET NULL (comment_id)`; unique theo `comment_ref`; dấu hiện "bình luận đã xoá" (`QuoteMark.commentDeleted`) | ✔ |
| Thấp-10 | Chuông bình luận: chủ quản phải còn quyền gói (`hosts`), đối tác phải thuộc công ty còn hiệu lực (`activeOrgs`); vòng quét nhắc hết hạn lọc tương tự (danh bạ `orgNames`), giao SAU commit | ✔ |
| Thấp-11 | Xoá `comment-notify.hook.ts` (no-op) | ✔ |
| Thấp-12 | community-web: hằng build `__COMMUNITY_MOCK__` + `import("./mock")`; check:bundle báo lỗi nếu bản build chứa dữ liệu mẫu | ✔ |

## Quyết định trong lúc làm
- Thấp-9: giữ dấu của chủ quản khi đối tác xoá bình luận (không cascade) — giá đã nằm ở SP & Giá, dấu là lịch sử của chủ quản.
- Chuông sau commit: lỗi phát chỉ log `community-notify-failed` (hành động đã xong). Nhắc hết hạn đã đánh dấu mà tx giao chuông lỗi ⇒ mất một lần nhắc (chấp nhận, có log).
- `stockHolders` trả người có quyền đọc gói contracts; `emitNewPost` giao với tập chủ quản community.

## Còn lại
- e2e `e2e/community-web/playwright.config.ts` (khoá, chỉ qc) build production không đặt `PUBLIC_COMMUNITY_API=mock` ⇒ sau Thấp-12 bản build là http; qc cần thêm `PUBLIC_COMMUNITY_API=mock` vào lệnh webServer (trước đây cũng đã là http — lệch sẵn).
- chmod 600 không kiểm được trên Windows (chỉ cờ chỉ-đọc).
