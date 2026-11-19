---
id: cr187-community-ui
lát: cr187-community-ui
cr: CR-187
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
BR-187-4 (Tin nhắn toàn màn + tên dài), BR-187-6 (icon Sửa/Xoá/Ẩn bình luận), BR-187-7 (tương phản token), BR-187-9 (chống nháy đổi tab).

## Làm
- [x] `FULLSCREEN_PATHS = [/contracts/messages]`; `MessagesPage` bỏ `calc(100dvh-…)`; `ConversationRow`/aside `min-w-0`+`overflow-hidden` (TruncText đã có «…» + tooltip).
- [x] `IconAction` (tooltip + aria-label, 28px cách 2px; ≤ 640px 44px sát nhau) thay nút chữ ở `CommentItem`; nút ⋯ của bài thêm tooltip.
- [x] `useFeed`: đổi tab/lọc giữ bài cũ + `stale` (làm mờ `.feedbody`), đổi người xem vẫn bỏ bài cũ; số đếm hiện «–» khi chưa có dữ liệu; chip chọn không đổi độ đậm.
- [x] `tokens.test.ts` đo tương phản 24 cặp chữ/nền sáng + tối; sửa token tối `--destructive` (2,66 ⇒ đạt) và màu cứng `#8a4306` ở `QuoteForm`.
- [x] e2e: `e2e/community-web/cr187-ui.cm.ts`, `e2e/cr187/messages-fullscreen.spec.ts` (viết, chưa chạy).

## Không làm / Chạm
Không thiết kế lại Tin nhắn/bảng tin (CR-190/191).

## Test tối thiểu
`feed-merge.test.ts` (scopeChange), `tokens.test.ts` (tương phản), `shell-lib.test.ts` (cờ toàn màn).

## Quyết định trong lúc làm
- Bài: Sửa/Xoá/Ẩn nằm trong menu ⋯ (dòng có chữ) giữ nguyên; chỉ nút ⋯ thêm tooltip. Icon-only áp cho nút bình luận.
- Logic đổi phạm vi tách thành hàm thuần `scopeChange` (domain/feed-merge.ts) vì repo không có test hook React.
- Tối: `--destructive` #f97066 + chữ trên nó #2a0a08 (nút đỏ đặc ở tối thành đỏ sáng chữ tối) — cần soát UI tối.
- Nợ: màu cứng ở `style=` ngoài vùng rõ ràng không còn thấy trong Community/SHT.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/giao-dien-on-dinh.md
#### Yêu cầu: Giao diện ổn định (cuộn, nháy, nút icon, tương phản)
Tin nhắn là trang toàn màn: trang đứng yên, chỉ khung con cuộn, tên công ty dài cắt «…». Đổi tab/lọc bảng tin giữ bài cũ làm mờ tới khi có dữ liệu mới, số đếm không về 0. Nút Sửa/Xoá/Ẩn bình luận chỉ icon có tooltip (28px máy tính, 44px điện thoại). Chữ/nền token đạt ≥ 4,5:1 cả sáng và tối.
- Kịch bản: khi đổi tab thì giữ dữ liệu cũ và đánh dấu stale [test: apps/workspace-web/src/modules/community/domain/feed-merge.test.ts » cùng người xem đổi tab ⇒ stale giữ bài cũ làm mờ, trang mới thay hẳn]
- Kịch bản: khi đổi người xem thì bỏ bài cũ [test: apps/workspace-web/src/modules/community/domain/feed-merge.test.ts » đổi người xem ⇒ reset (bỏ bài cũ, kể cả khi bộ lọc cũng đổi)]
- Kịch bản: khi xem sáng hoặc tối thì chữ/nền đạt 4,5 [test: packages/web-kit/src/styles/tokens.test.ts » chế độ tối: mọi cặp chữ/nền token đạt 4,5]
- Kịch bản: khi mở Tin nhắn thì là trang toàn màn [test: apps/workspace-web/src/features/shell/lib/shell-lib.test.ts » mặc định chỉ Tin nhắn toàn màn, khai báo đường dẫn ⇒ khớp chính nó và con]
- Kịch bản: khi bấm Tất cả/Cần bán thì khung tab không nhảy [test: e2e/community-web/cr187-ui.cm.ts » đổi tab Tất cả → Cần bán: khung các tab không đổi cỡ, số đếm không về 0]
- Kịch bản: khi xem bình luận thì nút icon 28px cách 2px [test: e2e/community-web/cr187-ui.cm.ts » nút icon của bình luận: 28px cách 2px trên máy tính]
- Kịch bản: khi mở Tin nhắn thì không có thanh cuộn trang [test: e2e/cr187/messages-fullscreen.spec.ts » Tin nhắn: không có thanh cuộn trang, dòng hội thoại không tràn sang khung phải]

## Việc còn lại
Điều phối chạy 2 e2e cuối đợt (messages cần cấu hình stack như cr169). Soát UI tối nút đỏ (`--destructive`). Bảng tin Profile `FeedList` chưa có e2e riêng cho stale.
