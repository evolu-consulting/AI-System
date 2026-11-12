# UAT đợt 2026-11-12 (CR-128e, CR-129, CR-130, CR-131, CR-132, CR-133, CR-140, sửa bảo mật)

Môi trường: tenant **demo** (mã công ty `demo`). Không dùng tenant evolu.
Mật khẩu: một mật khẩu dev chung = **DEMO_OWNER_PW** trong `.env.local` cho mọi tài khoản nội bộ bên dưới; admin nền tảng `admin` dùng `SEED_ADMIN_PASSWORD`; đối tác `doitac-*`: `.data/dev-up/demo-partners.txt`. KHÔNG ghi mật khẩu vào tài liệu.
Dựng/chạy lại dữ liệu: `bun run demo:org`, rồi `bun run demo:purchase` cho «Quy trình mua hàng» (lặp lại được; dev-up có -SeedDemo tự chạy cả hai). Có sẵn: quy trình «Duyệt hợp đồng», «Đề nghị mua hàng» (bước «Trưởng phòng duyệt» = trưởng phòng của người gửi); 4 HĐ mẫu «[Demo] …» đang chờ duyệt; HĐ «Hợp đồng mua văn phòng phẩm» (UAT-1) như cũ; Bảng tin đã bật, có bài mẫu.

### Sơ đồ tổ chức công ty mẫu

| Phòng ban (đều trực thuộc Ban Giám đốc) | Trưởng phòng | Thành viên |
|---|---|---|
| Ban Giám đốc | Nguyễn Văn An (`demo-owner`) — Giám đốc | — |
| Phòng Kinh doanh | Trần Thị Bình (`binh.tran`) | Lê Minh Cường (`cuong.le`), Phạm Thu Dung (`dung.pham`), Hồ Minh Quân (`demo-editor`) |
| Phòng Mua hàng | Đỗ Quang Phúc (`phuc.do`) | Mai Văn Tùng (`tung.mai`) |
| Phòng Kế toán – Tài chính | Hoàng Văn Em (`em.hoang`) — Kế toán trưởng | Vũ Thị Giang (`giang.vu`) KT quản trị · Lý Thu Hà (`ha.ly`) KT thanh toán/mua hàng · Đinh Văn Hùng (`hung.dinh`) Thủ quỹ · Phan Thị Yến (`demo-viewer`) NV Kế toán |
| Phòng Pháp chế | Đặng Quốc Huy (`huy.dang`) | — |
| Kho vận | Bùi Văn Khoa (`khoa.bui`) — Quản lý kho | Ngô Thị Lan (`lan.ngo`) |

Quyền trong Sổ Hợp Tác: Giám đốc = Toàn quyền; trưởng phòng, kế toán, nhân viên = Nhân viên (sửa); Thủ quỹ = Chỉ xem. Nhóm vai (ngoài phòng ban): «Người ký HĐ» = Giám đốc + Kế toán trưởng; «Tài chính» = Giang; «Thủ quỹ» = Hùng; «Kế toán thanh toán / mua hàng» = Hà.

### Ca quy trình theo người thật (HĐ mẫu đã gửi sẵn; mở bằng đúng tài khoản)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| P1 | `cuong.le` gửi, `binh.tran` duyệt | Cường có HĐ «[Demo] HĐ dịch vụ chữ ký số» 300 triệu đã gửi duyệt; đăng nhập `binh.tran` ⇒ «Chờ tôi duyệt» | Bình thấy việc và duyệt được; Cường/Dung/Quân KHÔNG thấy việc này; duyệt xong HĐ «Đã duyệt» (dưới 500 triệu, không lên Giám đốc) |
| P2 | `giang.vu` gửi ⇒ `em.hoang` ⇒ `demo-owner` | HĐ «[Demo] HĐ mua thiết bị văn phòng» 800 triệu: Em duyệt trước; sau đó đăng nhập `demo-owner` | Việc đầu về Em (trưởng phòng Kế toán), không về Giang; Em duyệt xong thì việc «Giám đốc duyệt» về An (trên 500 triệu); An duyệt ⇒ «Đã duyệt» |
| P3 | `binh.tran` tự gửi ⇒ `demo-owner` | HĐ «[Demo] HĐ bán lô thiết bị» 150 triệu do chính trưởng phòng gửi | Bình không tự duyệt được; việc «Trưởng phòng duyệt» lên An (trưởng phòng cấp trên) |
| P4 | `binh.tran` uỷ quyền `dung.pham` | Bình ⇒ Uỷ quyền duyệt cho Dung (khoảng ngày bao gồm hôm nay); sau đó `cuong.le` gửi thêm một HĐ | Việc về Bình đồng thời hiện cho Dung duyệt thay (thẻ «Duyệt thay Bình»); hết hạn uỷ quyền thì Dung không còn thấy |
| P5 | `tung.mai` gửi ⇒ `phuc.do` | HĐ «[Demo] HĐ mua nguyên vật liệu» 120 triệu | Việc về Phúc (trưởng phòng Mua hàng), không về Em |

Ghi kết quả: ✅ đạt · ❌ lỗi (ghi mã UC + mô tả + ảnh).

## A. Đầu trang hợp đồng (CR-128e)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| A1 | demo-owner | Tạo HĐ mới (tải file), mở trang chi tiết khi còn nháp | Thanh trên: Huỷ · Lưu nháp · 1 nút chính · «Thao tác ▾». Menu có «Xoá hợp đồng» màu đỏ ở cuối. Không có nút nào tràn hàng |
| A2 | demo-owner | Cuộn xuống trang HĐ nháp | Thanh nút dính trên cùng, vẫn đủ nút |
| A3 | người được giao duyệt UAT-1 | Mở UAT-1 khi đến lượt mình | Chỉ «Duyệt» nằm ngoài. «Trả lại sửa», «Từ chối» nằm trong «Thao tác ▾» |
| A4 | demo-owner | Mở một HĐ đã duyệt xong | Nút chính «Tải phiên bản mới»; menu có «Tạm khoá», vạch ngăn, «Xoá hợp đồng» đỏ |
| A5 | demo-owner | Tạm khoá HĐ ở A4 | Nút chính đổi thành «Mở khoá» |
| A6 | demo-owner | Xem dòng thông tin dưới tên HĐ | Có link «Xem file gốc»; trạng thái hiện tiếng Việt (vd «Nháp»), không có chữ kiểu DRAFT |
| A7 | bất kỳ | Mở chi tiết một Đối tác | 1 nút chính + «Thao tác ▾» (có «Sửa liên hệ») |
| A8 | điện thoại (màn hẹp) | Mở chi tiết HĐ | Không tràn ngang; ô «Phụ trách» có lề |

## B. Tài liệu kèm trên hợp đồng (CR-133)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| B1 | demo-owner | Ở danh sách HĐ, tải lên file .docx làm HĐ (công ty bật ký số) | Bị từ chối, câu nói rõ chỉ nhận PDF |
| B2 | demo-owner | Mở UAT-1, khối «Tài liệu kèm» ⇒ Thêm tệp .docx | Tệp hiện trong khối, tải về được |
| B3 | demo-owner | Bấm «Gỡ» tệp ở B2 | Có hộp hỏi xác nhận; xác nhận thì tệp biến mất |
| B4 | demo-owner | Thêm file .doc (Word cũ) hoặc .exe | Báo lỗi, nói rõ định dạng được nhận |
| B5 | hung.dinh (Chỉ xem) | Mở UAT-1 | Xem và tải tệp kèm được; không có nút Thêm/Gỡ (nếu không có quyền sửa) |
| B6 | bất kỳ | HĐ có tệp kèm ở bước duyệt | Cùng khối hiện nhóm «tệp kèm theo bước duyệt», chỉ xem/tải |

## C. Tin nhắn (CR-132)

Mở 2 trình duyệt (hoặc 1 thường + 1 ẩn danh): A = demo-owner, B = demo-editor.

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| C1 | A | Menu trái «Tin nhắn» ⇒ «Nhắn tin mới» ⇒ chọn demo-editor ⇒ gửi «Chào» | Tin hiện ngay ở A |
| C2 | B | Không tải lại trang | Mục menu «Tin nhắn» và nút khoang trợ lý có chấm đỏ số 1; hội thoại in đậm, lên đầu |
| C3 | B | Mở hội thoại | Chấm đỏ mất; A thấy «đã xem» (nếu có) |
| C4 | A | Gửi một ảnh .png | B thấy ảnh thu nhỏ; bấm mở lớn |
| C5 | A | Gửi một file .pdf | B thấy thẻ tệp, tải về được |
| C6 | A | Thu hồi một tin của mình | Cả hai bên thấy «Tin nhắn đã được thu hồi»; không thu hồi được tin của người khác |
| C7 | A | Tạo nhóm «Nhóm UAT» với editor + viewer | Cả 3 thấy nhóm, nhắn được |
| C8 | thành viên thường | Thử bớt người khác / đổi tên nhóm | Không có nút (chỉ chủ nhóm làm được) |
| C9 | A (chủ nhóm) | Rời nhóm | Người vào sớm nhất thành chủ nhóm |
| C10 | B | Mở khoang trợ lý bên phải ⇒ tab «Tin nhắn» | Danh sách hội thoại; mở một cuộc chat, có nút ‹ quay lại; tab «Trợ lý AI» vẫn dùng bình thường |
| C11 | B | Ở màn Tin nhắn toàn màn | Không có nút trợ lý nổi che nút Gửi |
| C12 | điện thoại | Xem thanh dưới | Có mục «Tin nhắn» kèm số chưa đọc; nhãn không bị cắt |
| C13 | bất kỳ | Có tin mới | KHÔNG có thông báo trong chuông, không email (chỉ chấm đỏ) |
| C14 | demo-viewer | Thử mở link tệp của hội thoại mình không tham gia (copy link từ A) | Không xem được |
| C15 | đối tác doitac-* | Tìm mục Tin nhắn | Không có (bản đầu chỉ nội bộ) |

## D. Bảng tin (CR-129, CR-130)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| D1 | demo-editor | Đăng bài kèm 4 ảnh | Bài hiện lưới 3 ô, ô cuối «+1» |
| D2 | bất kỳ | Bấm một ảnh | Xem phóng to, ảnh ở giữa, ‹ › hai bên, «1 / 4» và «Tải về» |
| D3 | demo-editor | Đính kèm video .mp4 | Bị từ chối, câu nói rõ định dạng nhận |
| D4 | bất kỳ | Xem số lượng hàng trong bài/gợi ý | Hiện «320 cuộn», không «320.0000» |
| D5 | demo-viewer | Bình luận vào bài của người khác, gõ @ để nhắc đối tác | Bình luận được, danh sách @ hiện |
| D6 | người được @ | Mở chuông, bấm thông báo | Mở đúng bài và cuộn tới bình luận; câu thông báo gọn «A bình luận bài: “…”» |
| D7 | không phải chủ bài | Thử ẩn bình luận | Không làm được; chỉ chủ bài ẩn được |
| D8 | demo-editor (không phải quản trị) | Xem hàng đơn xin tham gia | Không thấy (chỉ quản trị Sổ Hợp Tác duyệt đơn) |
| D9 | demo-owner (quản trị) | Duyệt một đơn tham gia, chọn «gắn với đối tác có sẵn» | Duyệt được; đối tác nhập tay chưa có HĐ cũng có trong danh sách chọn |
| D10 | đối tác doitac-* | Đăng nhập, vào Bảng tin | Xem bài được chia sẻ, bình luận được; KHÔNG có nút «Mở trợ lý AI»; không vào được phần hợp đồng |
| D11 | bất kỳ | Mở chuông | Thông báo hợp đồng + Bảng tin chung một danh sách; có «Đánh dấu tất cả đã đọc» khi có tin chưa đọc |
| D12 | bất kỳ | Mở Cài đặt | Một hộp Cài đặt duy nhất, có nhóm «Bảng tin» |

## E. Bật/tắt Bảng tin (CR-130 pha 3)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| E1 | admin (nền tảng) | Admin ⇒ Công ty `demo` ⇒ thẻ Sổ Hợp Tác | Có công tắc «Bảng tin»; không còn chỗ cấp quyền riêng cho Bảng tin |
| E2 | demo-owner (quản trị công ty) | Vào màn tương tự trong admin | Chỉ xem, không bật/tắt được |
| E3 | admin | Tắt «Bảng tin» cho demo | — |
| E4 | demo-owner | Vào `/community` | Câu «Bảng tin chưa được bật cho công ty — liên hệ quản trị nền tảng»; menu không còn mục Bảng tin |
| E5 | admin | BẬT LẠI «Bảng tin» cho demo | Bảng tin dùng lại bình thường |
| E6 | admin | Tạo quy trình mới cho demo | Ô «Quy trình cho» có lựa chọn «Bảng tin» |

## F. Trang trống / không tìm thấy (CR-131)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| F1 | bất kỳ | Gõ địa chỉ sai `/contracts/abc-khong-co` | Trang «Không tìm thấy» có hình minh hoạ + nút quay về (không tự nhảy trang) |
| F2 | bất kỳ | Danh sách HĐ tìm «zzzz» | Hình minh hoạ + câu «không có hợp đồng khớp» |
| F3 | bất kỳ | Mở một danh sách chưa có dữ liệu (vd Sản phẩm của công ty mới) | Hình minh hoạ trống |
| F4 | bất kỳ | Mở link HĐ không có quyền xem | Câu «không tìm thấy / không có quyền» + nút «Về danh sách» |
| F5 | admin | Gõ địa chỉ sai trong admin | Trang không tìm thấy cùng kiểu |

## G. Sửa bảo mật (kiểm nhanh)

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| G1 | người gửi HĐ (thuộc nhóm duyệt) | Bấm «Nhận việc» ở bước duyệt HĐ của chính mình | Báo «Bạn là người gửi hồ sơ này nên không nhận việc duyệt được…» |
| G2 | quản trị công ty | Uỷ quyền duyệt thay cho tài khoản đối tác | Không chọn được / bị từ chối |
| G3 | người duyệt | Ghi bằng chứng duyệt kèm tệp | Chỉ dùng được tệp mình tải lên; trường hợp khác báo «Tệp hoặc chữ ký phải do chính bạn tải lên…» |

## H. Quy trình mua hàng (CR-140)

Dựng bằng `bun run demo:purchase` (1 quy trình cha «Mua hàng» + 3 con: A «Chọn nhà cung cấp và ngân sách», B «Hợp đồng», C «Nhận hàng và thanh toán»). Mở bằng đúng tài khoản; việc nằm ở «Chờ tôi duyệt». Mỗi bước duyệt cần ý kiến + một tệp (hoặc chữ ký).

| UC | Người | Bước | Kỳ vọng |
|---|---|---|---|
| H1 | `cuong.le` | Tạo yêu cầu «Mua hàng»: tên hàng, số lượng, dự toán **600 triệu**, lý do, tệp | Yêu cầu hiện ở «Yêu cầu của tôi»; việc đầu về `binh.tran` (trưởng phòng của Cường), không về Cường/Dung |
| H2 | `binh.tran` | Duyệt «Trưởng phòng đề xuất duyệt» | Việc «Tìm nhà cung cấp, lấy báo giá» về Phòng Mua hàng (Phúc/Tùng) |
| H3 | `tung.mai`, `phuc.do` | Tùng điền báo giá + tải tệp; Phúc duyệt; Tùng điền bảng so sánh + nhà cung cấp đề xuất | Báo giá chỉ Phúc (trưởng phòng Mua hàng) duyệt được; sau so sánh hiện HAI thẻ cùng lúc: Phòng Mua hàng và Tài chính |
| H4 | `phuc.do`, `giang.vu` | Mỗi người duyệt thẻ của mình | Cả hai đạt mới sang bước kế (một người chưa duyệt ⇒ yêu cầu vẫn dừng, thẻ hiện «1/2») |
| H5 | `giang.vu` | Điền phương án ngân sách | Trên 500 triệu ⇒ việc «Giám đốc duyệt ngân sách» về `demo-owner`; dưới 500 triệu ⇒ về `phuc.do` |
| H6 | `demo-owner`, `tung.mai`, `phuc.do` | Giám đốc duyệt; Tùng tạo PO; Phúc duyệt PO | Hết phần A, yêu cầu sang phần B «Hợp đồng» (dự toán từ 20 triệu) |
| H7 | `huy.dang` | Soạn hợp đồng: số hợp đồng + tải bản thảo | Hợp đồng «<tên hàng>» xuất hiện ở Sổ Hợp Tác (nháp), tên/đối tác/giá trị lấy từ phần A |
| H8 | `phuc.do`, `em.hoang` (hoặc người Kế toán), `huy.dang` | Duyệt song song: Pháp chế + Kế toán + Mua hàng | Ba thẻ cùng lúc; đủ cả ba mới sang Giám đốc; từ chối ở một thẻ ⇒ kết thúc «Không mua» |
| H9 | `demo-owner` | Giám đốc duyệt hợp đồng | Sang phần C (demo chưa bật ký số nên bỏ bước Ký số) |
| H10 | `khoa.bui` | Nhận hàng: ngày nhận, số lượng, biên bản; rồi duyệt nghiệm thu | Việc về Kho vận; xong sang Kế toán |
| H11 | `ha.ly`, `em.hoang` | Kiểm hoá đơn (tệp) → Kế toán trưởng duyệt; Hà lập đề nghị thanh toán | Việc kiểm hoá đơn chỉ về nhóm «Kế toán thanh toán / mua hàng» (Hà) |
| H12 | `em.hoang`, `demo-owner` | Duyệt song song Kế toán trưởng + Giám đốc | Đủ cả hai mới sang thanh toán |
| H13 | `hung.dinh` (hoặc `ha.ly`), `em.hoang` | Thanh toán, hạch toán (ngày chi + chứng từ); Kế toán trưởng duyệt | Yêu cầu «Đã xong». Chưa có ghi sổ «Xác nhận mốc» tự động (khoảng trống trong `docs/specs/cr140-purchase/tasks.md`) |
| H14 | `cuong.le` | Tạo yêu cầu thứ hai, dự toán **15 triệu** | Đi A → C, BỎ phần B (không có bước Hợp đồng); trưởng phòng Mua hàng duyệt ngân sách (không lên Giám đốc) |
| H15 | `dung.pham` | Xem yêu cầu của Cường | Không thấy (chỉ người gửi và người nhận việc xem được) |

Chạy thử tự động bằng API (không qua trình duyệt): `bun run demo:purchase --trial` (in bảng bước · người · kết quả).
