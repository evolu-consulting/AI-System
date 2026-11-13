# community-admin-table · CR-137b

## Delta
- [x] Báo cáo vi phạm / Yêu cầu tham gia (người duyệt): bỏ thẻ tiêu đề + số đếm trên chip lọc; bảng chiếm hết chiều ngang; bấm dòng ⇒ hộp thoại chi tiết (Dialog) với thao tác duyệt/từ chối/ẩn bài/cảnh báo/bỏ qua như cũ. Xử lý xong ⇒ hộp thoại tự đóng. [test: e2e/community-web/flows.cs.ts, cr130-journey.cs.ts]

## Quyết định trong lúc làm
- Không đổi API. Nút dùng `Btn`; hộp thoại bọc `data-mod="community"` để giữ kiểu Community trong portal.
- «Từ chối» đơn tham gia đóng hộp thoại chi tiết trước khi mở hộp lý do (tránh hai hộp thoại chồng).

## Việc còn lại
- e2e hai file chưa chạy (cuối đợt, do điều phối). `check:bundle` cần build `dist` trước.
