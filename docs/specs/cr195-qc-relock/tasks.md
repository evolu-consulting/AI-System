# CR-195 · qc relock test khoá

## Delta
- [x] Ca điện thoại ở cr191-feed-ui.cm.ts kiểm nút ⋯ post-more ≥ 44px và không còn .iconact [test: điện thoại: thẻ bài có một nút ⋯ 44px (không còn icon rời), nút Lọc nổi đáy mở sheet từ dưới]
- [x] Baseline bang-tin-mobile chụp lại (-Capture cm): lệch đúng ý CR-195 (thẻ gọn, ⋯, đầu thẻ 3 dòng, hộp Viết bài nền trắng) [test: CR-180 · bang-tin-mobile · ảnh 390 px khớp baseline]
- [x] FileBox giả (_fbfake.ts serveLink) gửi access-control-allow-origin cho link /d/ (CR-194 cách a); gỡ shim page.route ở txt-preview.spec.ts [test: Xem tệp .txt trong hộp: hiện chữ, giữ xuống dòng, có Tải về]
- [x] Relock tests/.lock

## Quyết định trong lúc làm
- Không đụng cr190/danh-sach-trai.spec.ts và cr130-journey.cs.ts (ngoài phạm vi).

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: chỉ sửa test khoá theo thiết kế CR-195, FileBox giả gửi CORS, chụp lại baseline).
