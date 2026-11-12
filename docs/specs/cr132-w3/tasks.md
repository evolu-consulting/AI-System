---
id: cr132-w3
lát: cr132-w3 (W3 của CR-132 · tab «Tin nhắn» trong khoang trợ lý, chấm đỏ, đính kèm tệp, workspace-web)
cr: CR-132
làn: nhanh
migration: không
phụ thuộc: cr132-w2 (component), cr132-m4 (sự kiện msg.*), cr132-m5 (route tệp)
---
## Plan (ngắn)
Khoang phải có tab «Trợ lý AI | Tin nhắn» (`DockTabs`); tab Tin nhắn nạp lazy `MessagesDockPanel` = `ConversationPane` ⇄ `ChatView compact onBack` (spec CR-132 §8). Hội thoại đang mở + tab nhớ trong `useDock().panel` (sống cùng khung ⇒ đóng/mở khoang vẫn đúng chỗ; nút ‹ về danh sách, không đóng khoang). Chấm đỏ: `UnreadBadge` dùng chung ở nút mở khoang (FAB), tab, thanh dưới điện thoại (mục «Tin nhắn» vào 5 cột: Hợp đồng · Tổng quan · Tin nhắn · Đối tác · Chờ tôi), cùng MỘT query `useUnreadTotal`.
Realtime (3): đã nối ở W2 trong MỘT chỗ `features/messages/hooks/msg-realtime.ts` (`msg.new|read|deleted|conversation` → cache, nối lại ⇒ tải lại); khoang và toàn màn dùng cùng cache nên không làm thêm.
Đính kèm: nút ghim ở ô soạn (`accept` = `ATTACH_ALLOWED`), tải lên ngay `POST …/files` (multipart), chip gỡ được, gửi kèm `file_ids`; tin hiện ảnh thu nhỏ (tải qua Bearer ⇒ object URL, mở ảnh ở tab mới) hoặc thẻ tệp (tên + cỡ, bấm tải). Lỗi 415/413/422 ⇒ câu «Không gửi được tệp này…» (kèm đuôi nhận và 20 MB); quá 10 tệp ⇒ câu riêng.

## Quyết định trong lúc làm
- Tự viết `MessageFiles` thay vì dùng `useImageUrl`/`ImageViewer` của community: hook đó gắn với API của module community (`useApp().api.fileObjectUrl`), không gọi được route tệp tin nhắn; tránh phụ thuộc chéo module.
- Kiểm định dạng/dung lượng ở máy khách trước khi tải (cùng `ATTACH_ALLOWED`/`ATTACH_MAX_BYTES`); server vẫn là nơi quyết định.
- Lấy tệp qua `apiResponse(GET …/files/:id)` (Bearer; fetch theo 302 tới FileBox) ⇒ blob; không dùng thẻ `<a href>` trực tiếp vì cần Bearer.
- Bỏ `mobile: "more"` của mục «Tin nhắn» để vào thanh dưới điện thoại (còn chỗ: 4 + «Chờ tôi» = 5 cột).
- `shell-ui.test.tsx` (lỗi có sẵn): thay `NotificationBell` đã gỡ bằng `ConnectedBell` (chuông web-kit duy nhất); phần số chưa đọc của chuông do test web-kit lo.
- `Shell.tsx` tách `DockSheet`, `useContractsSync`, `fabLabel` để giữ độ phức tạp ≤ 15.

## Test
unit: `messages/lib/files.test.ts` (định dạng/dung lượng/cỡ), `shell/components/dock-tabs.test.tsx` (tab, 99+, nút thu gọn), `shell-ui.test.tsx` sửa · e2e viết sẵn `e2e/contracts-web/cr132-messages-dock.cw.ts` (KHÔNG chạy). Đã chạy: `bun test src` (workspace-web: còn 1 lỗi có sẵn ngoài lát `attach.test.ts` community), `tsc --noEmit`, biome, `build` + `check:bundle` (js 145.0 KB, chunk lớn nhất 55.7 KB), `i18n:check`.

## Việc còn lại
Chạy e2e + soát UI (chụp khoang hẹp, ảnh thu nhỏ) một lần cuối đợt; kéo thả tệp vào khung chat (chưa làm).

## Delta (so với docs/current)
<!-- ADDED file riêng `tin-nhan-khoang.md`: `tin-nhan*.md` của các lát trước chưa gộp vào docs/current; gộp cuối đợt nhập vào một file. -->
Trạng thái gộp: chưa gộp
### ADDED pack-contracts/tin-nhan-khoang.md
#### Yêu cầu: Tin nhắn trong khoang trợ lý với tab và chấm đỏ chưa đọc (nguồn: CR-132)
Khoang bên phải có hai tab «Trợ lý AI» và «Tin nhắn». Tab Tin nhắn hiện danh sách hội thoại; bấm vào một hội thoại thì khung chat thay chỗ, nút ‹ quay về danh sách mà không đóng khoang, và khoang nhớ hội thoại đang mở khi đóng rồi mở lại. Nút mở khoang, tab Tin nhắn và mục «Tin nhắn» ở thanh dưới điện thoại cùng hiện số chưa đọc (trên 99 hiện 99+, bằng 0 thì không hiện).
- Kịch bản: khi có tin chưa đọc thì tab Tin nhắn hiện số, trên 99 hiện 99+, bằng 0 không có chấm, nút thu gọn chỉ ở tab Tin nhắn [test: apps/workspace-web/src/features/shell/components/dock-tabs.test.tsx » DockTabs]
- Kịch bản: khi A gửi chữ và một PDF thì B thấy chấm «1» ở nút mở khoang và tab, mở hội thoại thì chấm mất và A thấy «Đã xem» [test: e2e/contracts-web/cr132-messages-dock.cw.ts » Khoang: A gửi chữ + PDF]
#### Yêu cầu: Đính kèm tệp vào tin nhắn (nguồn: CR-132)
Nút ghim ở ô soạn chọn tệp (PDF, Word, Excel, ảnh…, tối đa 20 MB, tối đa 10 tệp mỗi tin); tệp tải lên ngay và hiện thành chip gỡ được; tin có tệp mà không có chữ vẫn gửi được. Trong tin, ảnh hiện thu nhỏ và mở ra được, tệp khác là thẻ có tên và dung lượng để tải. Tệp sai định dạng hoặc quá lớn báo câu nói rõ loại nhận được.
- Kịch bản: khi chọn tệp đuôi lạ, tệp rỗng hoặc quá 20 MB thì bị từ chối trước khi tải; đuôi hợp lệ thì nhận [test: apps/workspace-web/src/features/messages/lib/files.test.ts » tệp đính kèm]
