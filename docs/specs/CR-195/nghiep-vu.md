# CR-195 — Dialog nền trắng, thẻ bài + hộp Viết bài trên điện thoại, ảnh tải nhanh (yêu cầu 2026-11-20)

Nguồn: người dùng 2026-11-20 (ảnh hộp «Viết bài» máy tính + điện thoại, thẻ bài điện thoại). Người dùng nhắn «coi đánh giá luôn bản mobile» sau khi điều phối gửi kế hoạch; điều phối coi đó là đồng ý, mặc định do điều phối đặt.

## Dialog (toàn hệ thống)
- **BR-195-1** Mọi hộp thoại nền trắng (token `--card`/`--popover`, tối thì theo token), phần đầu (tiêu đề + ×) và phần nội dung có lề đều: ngang 24px (điện thoại 16px), đầu cách trên 20px, đầu–nội dung 16px. Nội dung KHÔNG bọc thêm thẻ nền xám + viền (không lồng thẻ). Ghi luật vào `packages/web-kit/src/ui/kit/RULES.md`.
- **BR-195-2** Hộp «Viết bài»: bỏ thẻ bọc ngoài và thẻ «Ai thấy bài»; các phần thẳng trên nền trắng, ngăn bằng khoảng trống. Điện thoại: toàn màn hình, ô viết giãn hết chỗ trống, «Ai thấy bài» một hàng gọn, thanh dưới (📎 + «Đăng bài») dính đáy.

## Thẻ bài trên điện thoại (≤ 640px)
- **BR-195-3** 3 nút sửa/lưu trữ/xoá ⇒ một nút «⋯» mở menu. Đầu thẻ 3 dòng: tên · chức vụ, công ty; thời gian · phạm vi · nhãn loại bài. Không có dấu «·» ở đầu/cuối dòng.
- **BR-195-4** Phạm vi «Tất cả đối tác»/công ty cụ thể dùng biểu tượng người/nhóm, không dùng ổ khoá (ổ khoá chỉ cho bài nội bộ nếu có).
- **BR-195-5** Tên tệp dài cắt ở giữa, giữ đuôi (vd «pha-dao-ki…ng.pdf»).
- **BR-195-6** Tệp .txt/.csv/.md trong bài có nút «Xem» như PDF (áp BR-194-4 cho bảng tin; dùng chung logic, không viết lần hai).

## Ảnh tải nhanh
- **BR-195-7** Mở lại bảng tin: ảnh đã xem hiện ngay (trình duyệt giữ lại). Tệp theo id không đổi nội dung ⇒ `Cache-Control: private, max-age=86400` cho phản hồi tải tệp đã qua kiểm quyền; trong một phiên không tải lại ảnh đã có. Đo trước/sau (báo số thật). Không đổi cách đăng nhập.

## Quyết định trong lúc làm
- Người dùng «vẫn muốn giữ auth» ⇒ ảnh vẫn qua kiểm đăng nhập + quyền mỗi lần tải (không link công khai, không đổi sang cookie). Đo code: kiểm JWT cục bộ + cache cấu hình (`apps/hub-api/src/lib/auth.middleware.ts:46`) — không phải chỗ chậm. Chỗ chậm: `Cache-Control: private, no-store` (`community/domain/file.rules.ts:122`), ảnh gốc đầy đủ, đọc hết tệp vào bộ nhớ (`files.service.ts:94`).
- BR-195-7 sửa mặc định: `private, max-age=86400` (1 ngày, không `immutable` dài hạn) — đánh đổi máy dùng chung.

## Bổ sung 2026-11-21 (UAT người dùng)
- **BR-195-8** «Ai thấy bài» = «Chọn công ty…» ⇒ bấm mở hộp chọn công ty (tìm theo tên, danh sách công ty đã kết nối có ô chọn, nút «Xong (n)»; điện thoại toàn màn). Ngoài form chỉ hiện tóm tắt đã chọn (vd «2 công ty: Nitigroup, Preschool» + «Sửa»), không bày danh sách chip trong form.
- **BR-195-9** Hộp «Viết bài» điện thoại: hàng loại bài canh trái, không cắt chip đầu (cuộn ngang nếu thiếu chỗ), không có khoảng trống giữa hàng loại bài và ô viết — ô viết nằm ngay dưới và giãn chiếm phần trống.
