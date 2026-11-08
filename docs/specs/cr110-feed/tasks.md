---
id: cr110-feed
lát: cr110-feed
cr: CR-110
fr: [COM-FR-32, COM-FR-33, COM-FR-34]
làn: nhanh
migration: không
phụ thuộc: cr110-shell
---
## Plan (ngắn)
Bảng tin đã có composer thu gọn mặc định, tab sticky, rail role-aware, bố cục 2 cột/≤900 px (feed.css) từ trước; sidebar Shell đã thay `.wsside` ở Bảng tin.
Lát này siết cách ly đối tác ở PostCard (nút Lưu báo giá + form báo giá chỉ render khi `isHostViewer`, thêm vào callout giá vốn/báo giá đã lưu vốn đã gated) và chỉnh e2e khoá theo Shell.

## Làm
- [x] PostCard: nút "Lưu báo giá" và QuoteForm gated bằng `isHostViewer` (không render cho đối tác, không CSS ẩn)
- [x] e2e `feed.cm.ts` (qc): topbar = thương hiệu, thông báo/cài đặt/hồ sơ qua user-menu, thêm khẳng định cách ly đối tác
- [x] Không cần chuỗi i18n mới

## Không làm / Chạm
`.ws/.wsside` trong mockup.css còn được Profile/Settings dùng (lát khác) nên chưa xoá khỏi CSS; Feed không dùng.

## Test tối thiểu
e2e `feed.cm.ts` (chạy một lần cuối); không có logic thuần mới.

## Quyết định trong lúc làm
- Giữ kiểm tra `isHostViewer` (không dùng `caps.contracts`): mock host_staff có caps false nhưng vẫn lưu báo giá được theo vai.
- Bỏ bước chọn màu cá nhân trong e2e (COM-FR-39 bỏ ô chọn màu).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED community/hien-thi.md
#### Yêu cầu: Bảng tin — cách ly đối tác trên thẻ bài
Đối tác không bao giờ có trong DOM: nút Lưu báo giá, form báo giá, callout giá vốn, callout báo giá đã lưu, rail Đối tác.
- Kịch bản: đối tác xem bảng tin thì không có Lưu báo giá / giá vốn / báo giá đã lưu / rail Đối tác [test: e2e/community-web/feed.cm.ts]
- Kịch bản: chủ quản thấy nút Lưu báo giá và mở được form [test: e2e/community-web/feed.cm.ts]
