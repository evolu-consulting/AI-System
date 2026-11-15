# UAT hợp đồng giữa 2 công ty: NitiGroup ↔ Preschool

Bản test: https://app-test.evoluconsulting.com. Mật khẩu: mật khẩu chung đã báo (hoặc mật khẩu bạn đã đổi). Ghi Đạt / Không đạt từng ca.
Ký: dùng «Tải lên bản đã ký» (chọn một PDF bất kỳ), không cần ký số thật. Chuẩn bị 2 tệp PDF hợp đồng có chữ.

## 0. Đã chuẩn bị (điều phối, 2026-11-15)
- Cả 2 công ty «Đang bật · sẵn sàng gửi và nhận» (8/8 điều kiện): kênh gửi nhận bật, Danh bạ bật, có quy trình gửi + nhận.
- Nhóm quyền: NitiGroup Toàn quyền = `thuytien.le`, `admin`; Nhân viên = `thuyngan.le`, `thuyvy.trang`, `hr`, `thuphuong.pham`. Preschool Toàn quyền = `dung.dang`.
- Preschool trên bản test dùng tên pháp lý / mã số thuế GIẢ («Preschool (bản test)», 9999999901) để hiện trong danh bạ.

## 1. Quy trình đang chạy
| Công ty | Gửi HĐ đi | Nhận HĐ từ đối tác |
|---|---|---|
| NitiGroup | Nhân viên tạo ⇒ trưởng phòng duyệt (leo cấp tới Tiên); Tiên tự tạo ⇒ «Chuẩn bị ký» → Ký (Tiên) → **«Nhờ đối tác ký / xác nhận trên hệ thống?»** (Tiên): Có ⇒ Chọn đối tác & người nhận → gửi → chờ đối tác; Không ⇒ kết thúc «Đã duyệt» (nội bộ) | Phụ trách `thuyvy.trang` → Tiên duyệt → Ký (Tiên) → Đồng ý |
| Preschool | Chuẩn bị ký (Dung) → Ký (Dung) → **«Nhờ đối tác ký / xác nhận trên hệ thống?»**: Có ⇒ chọn đối tác → gửi → chờ; Không ⇒ kết thúc nội bộ | Chuẩn bị ký (Dung) → Ký (Dung) → Đồng ý |

## 2. Chiều NitiGroup → Preschool
| Mã | Ai (mã công ty · tên đăng nhập) | Bấm gì | Mong đợi | Đạt? |
|---|---|---|---|---|
| A01 | `nitigroup` · `thuyvy.trang` | Hợp đồng › tải PDF › chờ AI đọc (lỗi thì «Nhập tay») › điền đối tác Preschool › Gửi duyệt | HĐ «Đang duyệt», chờ Tiên | |
| A02 | `nitigroup` · `thuytien.le` | Việc của tôi › Duyệt | Sang «Chuẩn bị ký» rồi «Ký hợp đồng» của Tiên | |
| A03 | `thuytien.le` | Ký › Tải lên bản đã ký; bước «Nhờ đối tác ký / xác nhận trên hệ thống?» › chọn **Có** | Sang «Chọn đối tác & người nhận» | |
| A03b | `thuytien.le` | (HĐ khác) tới bước «Nhờ đối tác ký…» › chọn **Không** | HĐ «Đã duyệt», không gửi đối tác | |
| A04 | `thuytien.le` | Chọn đối tác: tìm «Preschool» trong danh sách, email người nhận `dung.dang@preschool.com` › Gửi | «Chờ đối tác xác nhận»; lần đầu chờ Preschool nhận lời mời | |
| A05 | `preschool` · `dung.dang` | Hợp đồng › băng lời mời đầu danh sách › Nhận | Băng mất; HĐ của NitiGroup hiện, chạy quy trình Nhận HĐ | |
| A06 | `dung.dang` | Việc của tôi › Chuẩn bị ký › Ký (tải bản đã ký) › Đồng ý | HĐ Preschool «Đã xác nhận» | |
| A07 | `nitigroup` · `thuyvy.trang` | Mở HĐ | Thấy «Đối tác đã xác nhận», bên nhận Preschool; không lộ người nội bộ Preschool | |

## 3. Chiều Preschool → NitiGroup (đã nối ở mục 2 ⇒ không còn lời mời)
| Mã | Ai | Bấm gì | Mong đợi | Đạt? |
|---|---|---|---|---|
| B01 | `preschool` · `dung.dang` | Tạo HĐ (đối tác NitiGroup) › Gửi duyệt | Không có bước duyệt; sang «Chuẩn bị ký» của Dung | |
| B02 | `dung.dang` | Chuẩn bị ký › Ký (tải bản đã ký) › «Nhờ đối tác ký…» chọn Có › Chọn đối tác NitiGroup, email `thuyvy.trang@nitigroupvn.com` › Gửi | Gửi thẳng, không chờ lời mời | |
| B03 | `nitigroup` · `thuyvy.trang` | Hợp đồng | HĐ Preschool gửi hiện; Vy là người phụ trách | |
| B04 | `nitigroup` · `thuytien.le` | Việc của tôi › Duyệt › Ký (tải bản đã ký) | HĐ NitiGroup «Đồng ý»; Preschool thấy «Đối tác đã xác nhận» | |

## 4. Nhánh lỗi
| Mã | Ai | Bấm gì | Mong đợi | Đạt? |
|---|---|---|---|---|
| C01 | `dung.dang` | Một HĐ NitiGroup gửi tới › Trả lại, ghi lý do | NitiGroup thấy lý do, HĐ quay lại để sửa và gửi lại vòng 2 | |
| C02 | `thuytien.le` | Một HĐ Preschool gửi tới › Từ chối, ghi lý do | Preschool thấy «Đối tác từ chối» kèm lý do | |
| C03 | `thuyngan.le` (Nhân viên) | Mở HĐ đang chờ Tiên | Không có nút Duyệt / Ký | |
