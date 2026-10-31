# community-feed-redesign — bảng tin 2 cột (làn nhanh, Luật 0b)

Chỉ hình thức, `apps/community-web`. Không đổi contract/API/quyền. Nguồn: mockup `feed-mockup.html` (người dùng đã duyệt). Chỉ light, màu nhấn theo `data-accent`.

## Plan
| Việc | File | Xong |
|---|---|---|
| Dải deal: `dealStrip` (hero giá/ngân sách + ô phụ) + unit | `lib/format.ts`, `lib/format.test.ts` | [x] |
| Hook `useFeedFilters` / `useFeed` / `usePartners` (FeedList giữ nguyên cho Profile) | `ui/useFeed.ts` | [x] |
| FeedPage 2 cột, thanh tab sticky `role=tablist/tab`, `FeedFilters` dùng chung | `ui/Feed.tsx` | [x] |
| Rail: Bộ lọc; chủ quản = "Đối tác trong chợ"; đối tác = "Công ty của bạn" + "Mẹo đăng bài" | `ui/FeedRail.tsx`, `ui/icons.tsx` | [x] |
| PostCard: spine + pill theo loại, dải deal, callout (bỏ style inline) | `ui/PostCard.tsx` | [x] |
| Composer: nút loại tách rời, màu theo loại (CSS, logic giữ nguyên) | `ui/Composer.tsx`, `styles/feed.css` | [x] |
| CSS mới; gỡ `.feedgrid`, `.facts/.fact` (đã grep: chỉ Feed/PostCard dùng) | `styles/feed.css`, `mockup.css`, `globals.css` | [x] |
| e2e: khoá bài theo `data-post-id`, thêm kiểm tab + deal + rail | `e2e/community-web/feed.cm.ts` | [x] chạy 5/5 xanh |

Phase B (cần backend, chưa làm): "Báo giá đã lưu gần đây", số liệu tuần, badge "n bài" cạnh đối tác.

## Quyết định trong lúc làm
- Mockup có "Plus Jakarta Sans/Public Sans": giữ Roboto của app (không thêm font).
- `buy`/`note` dùng token cố định trong `feed.css` (`--buy*`, `--note*`, `--good*`); sell theo `--accent*`.
- Dải deal không lặp "Hàng hoá" (đã là tiêu đề); chỉ thêm khi bài không có tiêu đề. Bài mua có thêm ô "Cần trước" (mockup chỉ 2 ô) — lưới tự co.
- Thông báo: không dải deal. Bài lưu trữ/xong/hết hạn mờ nhẹ (`.muted`, như mockup).
- Spine dùng `border-radius` thay `overflow:hidden` để menu ⋯ không bị cắt.
- Chip lọc ở Profile giữ `aria-pressed` (không đổi); chỉ FeedPage dùng `role=tab`.
- Rail đối tác: PartnerOrg không có thống kê bài ⇒ chỉ tên + nhóm hàng đầu + khu vực.
- Hiệu ứng ngoài mockup: rail ẩn thẻ Bộ lọc tới khi có facets.

## Delta (so với docs/current)

### MODIFIED apps/community-web/src/ui/Feed.tsx
#### Yêu cầu
Bảng tin hiển thị 2 cột: trái = ô soạn + thanh tab sticky + bài; phải = rail (bộ lọc, đối tác). Dưới 900px xếp 1 cột.
- Kịch bản: mở `#/feed` ⇒ tab "Tất cả" `aria-selected=true`; bấm "Cần bán" ⇒ chỉ còn bài bán [test: e2e/community-web/feed.cm.ts]
- Kịch bản: rail có ô "Nhóm hàng" và (chủ quản) thẻ "Đối tác trong chợ" [test: e2e/community-web/feed.cm.ts]

### MODIFIED apps/community-web/src/ui/PostCard.tsx
#### Yêu cầu
Thẻ bài có vạch màu + pill theo loại; bài bán/mua có dải deal (giá chào / ngân sách nổi bật); gợi ý và báo giá đã lưu là callout.
- Kịch bản: bài Cần bán ⇒ dải deal có nhãn "Giá chào"; không giá ⇒ "Liên hệ" [test: apps/community-web/src/lib/format.test.ts, e2e/community-web/feed.cm.ts]
- Kịch bản: chủ quản vẫn thấy `host-hint` và `quote-saved` [test: e2e/community-web/feed.cm.ts]

### MODIFIED apps/community-web/src/ui/Composer.tsx
Không thay đổi hành vi (lý do: chỉ thêm class `feedcomposer` và `data-type` để tạo kiểu nút loại bài).

### MODIFIED apps/community-web/src/lib/format.ts
#### Yêu cầu
`dealStrip(post)` trả hero + ô phụ theo loại bài; ghi chú ⇒ null.
- Kịch bản: mua có ngân sách + hạn ⇒ hero "Ngân sách", ô "Cần trước" dạng dd/mm/yyyy [test: apps/community-web/src/lib/format.test.ts]
