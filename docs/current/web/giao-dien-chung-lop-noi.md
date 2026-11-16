# Lớp nổi của bộ giao diện chung (CR-177 · nguồn: cr177-u3-kit-b)

Code: `packages/web-kit/src/ui/kit/overlay*`, `packages/web-kit/src/ui/toast.ts`. Bàn phím cho menu/ngăn: [ban-phim-lop-noi.md](ban-phim-lop-noi.md).

#### Yêu cầu: Hộp thoại chung cuộn riêng
Cao tối đa 90% màn hình; tiêu đề và hàng nút đứng yên, chỉ phần thân cuộn; Esc đóng, giữ focus trong hộp, trả focus về nút mở.
- Kịch bản: khi dựng hộp thoại thì có aria-modal và vùng thân cuộn riêng [test: packages/web-kit/src/ui/kit/overlay.test.tsx » dialog có aria-modal và vùng body cuộn riêng, header/footer cố định]

#### Yêu cầu: Xác nhận xoá nguy hiểm — «Giữ lại» là mặc định
Hộp xác nhận mất dữ liệu đưa con trỏ vào nút huỷ («Giữ lại»), không vào nút xoá.
- Kịch bản: khi mở hộp danger thì focus vào nút huỷ [test: packages/web-kit/src/ui/kit/overlay.test.tsx » danger đưa focus vào nút huỷ và chặn focus mặc định]

#### Yêu cầu: Ô chọn có tìm
Gõ không dấu, không phân biệt hoa thường vẫn tìm ra mục có dấu.
- Kịch bản: khi gõ «bao gia» thì ra «Báo giá» [test: packages/web-kit/src/ui/kit/overlay.test.tsx » gõ «bao gia» ra «Báo giá» (không phân biệt hoa/dấu)]

#### Yêu cầu: Xác nhận tại chỗ cần lý do
Khung xác nhận tại chỗ có ô nhập bắt buộc thì nút xác nhận khoá cho tới khi có chữ.
- Kịch bản: khi ô trống thì nút khoá [test: packages/web-kit/src/ui/kit/overlay.test.tsx » nút xác nhận khoá khi ô bắt buộc còn trống, bật khi có chữ hoặc không bắt buộc]

#### Yêu cầu: Thông báo «Hoàn tác»
Việc đổi lại được hiện thông báo có nút «Hoàn tác» trong 6 giây (thường 3 giây).
- Kịch bản: khi bấm Hoàn tác thì gọi hàm hoàn tác, thông báo ở lại 6000 ms [test: packages/web-kit/src/ui/toast.test.ts » toastUndo gọi onUndo khi bấm nút và dùng 6000 ms]

Nợ: nối `ERROR_TOAST_MS`/`SUCCESS_TOAST_MS` cũ vào `TOAST_MS`/`TOAST_UNDO_MS`.
