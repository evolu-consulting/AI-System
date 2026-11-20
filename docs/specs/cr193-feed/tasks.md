---
id: cr193-feed
lát: cr193-feed
cr: CR-193
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Community: bỏ nút «Nhắc tên» ở bình luận; nút Lọc nổi cả máy tính; ô đăng bài không dính; thẻ theo luật L1–L4 (token, không mã cứng).

## Làm
- [x] BR-193-1 `Thread.tsx` ẩn nút (MentionPicker `hideButton`), giữ gõ `@`.
- [x] BR-193-2 `Feed.tsx`/`FeedFilterSheet.tsx`: bỏ `.stickytop`/`.feedbar`, `.filterfab` mọi màn; máy tính góc phải dưới + đệm đáy.
- [x] BR-193-3/L1–L4 `mockup.css`/`feed.css`: `--border`, bo `--radius-md`, đệm 16/12px, cách 12px, bong bóng `--muted`, `.cmts` không nền, `.deal` không viền.
- [x] BR-193-4 bỏ `.post::before`. BR-193-5 ô đăng không sticky.

## Không làm / Chạm
Không: Đối tác, hộp thoại chung, router/cuộn, token toàn cục. Chạm `apps/workspace-web/src/modules/community/ui/**`, e2e community-web.

## Test tối thiểu
`useStuck.test.ts` (composerCompact còn export). e2e viết, chưa chạy: `cr191-feed-ui.cm.ts` (CR193 ×2), `composer.cm.ts`, `cr186-*`.

## Quyết định trong lúc làm
- Nút Lọc máy tính đặt phải-dưới NGAY TRÊN nút trợ lý (không đè); điện thoại giữ bên trái.
- Giữ `composerCompact`/`useStuck` (không còn dùng ở Feed) vì có test; ghi nợ gỡ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi giao diện bảng tin Community theo CR-193, không đổi nghiệp vụ; e2e e2e/community-web/cr191-feed-ui.cm.ts).

## Việc còn lại
Chụp lại ảnh baseline (điều phối). Gỡ `useStuck`/`composerCompact` nếu không ai dùng.
