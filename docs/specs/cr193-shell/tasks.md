---
id: cr193-shell
lát: cr193-shell
cr: CR-193
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
BR-193-6 canh giữa tiêu đề + «x» ở khuôn Dialog/Sheet; BR-193-7 chính sách cuộn dùng chung cho router; luật thẻ L1–L4 vào RULES.md.

## Làm
- [x] `dialog.tsx`/`sheet.tsx`: tiêu đề `leading-6`, nút «x» ô 24×24 flex-center.
- [x] `scroll-policy.ts` + `routerScrollOptions()` cho router workspace-web và admin-web; vùng cuộn chính gắn `data-scroll-restoration-id`.
- [x] `RULES.md`: L1–L4, BR-193-6/7.
- [x] e2e `e2e/contracts-web/cr193-scroll.cw.ts` (viết, chưa chạy).

## Không làm / Chạm
Không làm Community, trang Đối tác, chi tiết hợp đồng. Chạm: web-kit (dialog, sheet, scroll-policy, RULES), Shell hai app, router hai app.

## Test tối thiểu
`bun test packages/web-kit/src/scroll-policy.test.ts`; tsc web-kit/workspace-web/admin-web.

## Quyết định trong lúc làm
- `--card` sáng đã là `#ffffff`, nền trang `#f4f4f9` ⇒ giữ token.
- Cuộn: dùng `scrollRestoration` dạng hàm của TanStack Router (bỏ qua khi cùng đường dẫn) + `scrollToTopSelectors`; Back/Forward do khoá lịch sử `__TSR_key` của router khôi phục.
- Khung `board` (`md:overflow-y-auto` bên trong main) chưa đăng ký khôi phục riêng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/scroll-hop-thoai.md
#### Yêu cầu: Chuyển trang về đầu, Back khôi phục
Mở trang mới ⇒ vùng cuộn chính ở đầu; Back ⇒ về đúng chỗ đã đọc; đổi query cùng trang không nhảy.
- Kịch bản: khi chuyển sang trang khác thì cuộn về đầu [test: packages/web-kit/src/scroll-policy.test.ts » đổi trang ⇒ xử lý (về đầu)]
- Kịch bản: khi chỉ đổi query cùng trang thì không cuộn [test: packages/web-kit/src/scroll-policy.test.ts » cùng trang (đổi query/tab) ⇒ không cuộn]
- Kịch bản: khi cuộn, sang trang khác rồi Back thì về vị trí cũ [test: e2e/contracts-web/cr193-scroll.cw.ts » chuyển trang về đầu, Back khôi phục vị trí đã cuộn]

#### Yêu cầu: Tiêu đề và nút «x» hộp thoại canh giữa dọc
- Kịch bản: khi mở hộp thoại thì tiêu đề và nút «x» cùng hàng 24px [test: thủ công — chỉ là lớp CSS, soát bằng mắt]

## Việc còn lại
Chạy e2e cr193-scroll cuối đợt.
