# UAT hợp đồng giữa 2 công ty (CR-150)

Bản test (staging). **Demo** = bên gửi, **evolu** = bên đối tác. Mật khẩu KHÔNG ghi ở đây: người Demo dùng file `DEMO_OWNER.pw`, người UAT evolu dùng file `UAT_EVOLU.pw` (cả hai nằm trên máy chủ bản test).
Mỗi ca: làm đúng vai, đúng tài khoản, đánh dấu Đạt hoặc Không đạt. Ca có chữ **[KÝ SỐ THẬT]** cần nhà cung cấp ký thử (xem mục 0); không có thì bỏ qua ca đó, các ca khác vẫn chạy được bằng «Tải lên bản đã ký».

## 0. Chuẩn bị (điều phối làm một lần)
| Việc | Cách làm |
|---|---|
| Nạp dữ liệu | `bash seed-demo.sh --org-only` rồi `bash seed-demo.sh --partner-only` (chạy trên máy chủ bản test). Chạy lại được, không trùng; phía evolu chỉ thêm, không xoá. |
| Ký số thật (tuỳ chọn) | Quản trị Demo: Cài đặt › Kết nối bật nhà cung cấp ký thử; trang Quy trình, mở quy trình «UAT · HĐ từ 500 triệu», bước «Ký hợp đồng», đổi «Ký qua» sang nhà cung cấp đó. |
| Tệp hợp đồng | Chuẩn bị 3 tệp PDF hợp đồng có chữ (một tệp ghi giá trị khoảng 150 triệu, một khoảng 400 triệu, một khoảng 1,2 tỷ). |

## 1. Tài khoản
| Công ty | Tên đăng nhập | Vai trong UAT |
|---|---|---|
| Demo | `demo-owner` | Giám đốc (Toàn quyền), người ký công ty |
| Demo | `binh.tran` | Trưởng phòng Kinh doanh, người duyệt cấp 1 |
| Demo | `cuong.le`, `dung.pham` | Nhân viên Kinh doanh, người tạo hợp đồng |
| Demo | `phuc.do` / `tung.mai` | Trưởng phòng Mua hàng / nhân viên Mua hàng |
| Demo | `em.hoang` | Kế toán trưởng, người duyệt, người ký công ty |
| Demo | `ha.ly` | Kế toán, người đã thêm đối tác evolu vào sổ đối tác |
| Demo | `huy.dang` | Trưởng phòng Pháp chế, người chọn đối tác khi gửi |
| Demo | `demo-viewer` | Chỉ xem (kiểm không có nút duyệt) |
| evolu | `uat-nhan-gd` | Giám đốc nhận (Toàn quyền), nhận lời mời nối |
| evolu | `uat-nhan-phutrach` | Người phụ trách hợp đồng nhận |
| evolu | `uat-nhan-duyet` | Người duyệt hợp đồng nhận |
| evolu | `uat-nhan-ky` | Người ký bên nhận |

Quy trình duyệt của Demo (xét từ trên xuống, hợp đồng đi theo quy trình đầu tiên khớp):
1. **UAT · HĐ từ 500 triệu**: Trưởng phòng → Giám đốc → Ký → Gửi đối tác (đề nghị ký cùng lúc).
2. **UAT · HĐ phòng Mua hàng**: Trưởng phòng → Kế toán trưởng → Ký.
3. **UAT · HĐ phòng Kinh doanh gửi đối tác**: Trưởng phòng → Ký → Gửi đối tác.
4. «Duyệt hợp đồng» (mọi hợp đồng còn lại, có sẵn).

Evolu: quy trình **Nhận HĐ từ đối tác (UAT)**: Duyệt → Ký → Đồng ý. Mức quan trọng: dưới 300 triệu = Thường, từ 300 triệu = Quan trọng, từ 1 tỷ = Rất quan trọng. Người phụ trách: `uat-nhan-phutrach`.

## 2. Tạo hợp đồng và chọn quy trình
| Mã | Vai + tài khoản | Bước bấm | Kết quả mong đợi | Đạt/Không |
|---|---|---|---|---|
| T01 | Demo · `cuong.le` | Hợp đồng › tải tệp PDF (khoảng 400 triệu) › chờ AI đọc | AI điền tên, đối tác, giá trị, ngày. Sửa được từng ô. | |
| T02 | `cuong.le` | Mở hợp đồng vừa tạo, xem phần quy trình sẽ chạy | Nói rõ quy trình «UAT · HĐ phòng Kinh doanh gửi đối tác» và lý do (phòng người tạo = Kinh doanh, dưới 500 triệu). | |
| T03 | `dung.pham` | Tải tệp PDF khoảng 1,2 tỷ | Quy trình «UAT · HĐ từ 500 triệu» (giá trị lớn). | |
| T04 | `tung.mai` | Tải một PDF mua hàng | Quy trình «UAT · HĐ phòng Mua hàng». | |
| T05 | `cuong.le` | Tải PDF thiếu giá trị rồi bấm Gửi duyệt | Báo thiếu gì cần điền; chưa gửi được. | |
| T06 | `demo-viewer` | Mở hợp đồng của `cuong.le` | Xem được; không thấy nút Gửi duyệt, Duyệt. | |

## 3. Duyệt nhiều cấp
| Mã | Vai + tài khoản | Bước bấm | Kết quả mong đợi | Đạt/Không |
|---|---|---|---|---|
| D01 | `cuong.le` | Gửi duyệt hợp đồng T01 | Trạng thái «Đang duyệt»; ghi rõ đang chờ `binh.tran`. | |
| D02 | `binh.tran` | Việc của tôi › mở việc › Duyệt | Việc chuyển sang bước Ký; `cuong.le` thấy chuông báo. | |
| D03 | `dung.pham` rồi `binh.tran` | Gửi hợp đồng 1,2 tỷ (T03); `binh.tran` Duyệt | Việc tiếp theo về `demo-owner` (Giám đốc), không về người khác. | |
| D04 | `demo-owner` | Duyệt cấp Giám đốc | Sang bước Ký. | |
| D05 | `phuc.do`, `em.hoang` | Duyệt hợp đồng mua hàng (T04) ở cấp 1 rồi cấp 2 | Cấp 2 về `em.hoang`; xong cấp 2 sang bước Ký. | |
| D06 | `binh.tran` | Một hợp đồng khác: bấm Trả lại, ghi lý do | Hợp đồng về Nháp; người tạo thấy lý do + chuông; sửa rồi Gửi duyệt lại được. | |
| D07 | `binh.tran` | Một hợp đồng khác: bấm Từ chối, ghi lý do | Trạng thái «Từ chối»; người tạo thấy lý do; không gửi duyệt lại được nếu chưa sửa. | |
| D08 | `cuong.le` | Gửi duyệt rồi bấm Rút về Nháp | Việc duyệt biến mất khỏi `binh.tran`; hợp đồng về Nháp. | |
| D09 | `demo-owner` | Cài đặt › Uỷ quyền khi vắng: uỷ quyền cho `em.hoang`; sau đó một hợp đồng chờ `demo-owner` duyệt | `em.hoang` thấy việc và duyệt được; hồ sơ ghi «duyệt thay». | |
| D10 | `demo-owner` (Toàn quyền) | Mở hợp đồng đang chờ người khác › Duyệt thay | Duyệt được; hồ sơ duyệt ghi «Duyệt thay · Toàn quyền» và tên người thật. | |
| D11 | `demo-viewer` | Việc của tôi | Không có việc duyệt nào. | |

## 4. Ký
| Mã | Vai + tài khoản | Bước bấm | Kết quả mong đợi | Đạt/Không |
|---|---|---|---|---|
| K01 | Người ký công ty: `demo-owner` hoặc `em.hoang` | Việc của tôi › mở việc Ký › Tải lên bản đã ký (không ký số) › chọn PDF | Bước Ký xong; hợp đồng sang bước kế (gửi đối tác hoặc xong). | |
| K02 | `cuong.le` (người tạo) | Mở việc Ký của chính hợp đồng mình tạo | Không nhận được việc Ký (người ký phải khác người tạo). | |
| K03 **[KÝ SỐ THẬT]** | `demo-owner` | Ký bằng nhà cung cấp thử | Hiện trạng thái đang ký rồi «Đã ký»; tệp đã ký được lưu. Ghi nhận ký thử chưa có giá trị pháp lý. | |
| K04 | `em.hoang` | Bước Ký: tải lên tệp không phải PDF | Báo lỗi dễ hiểu, chưa qua bước. | |

## 5. Gửi đối tác xác nhận (Demo → evolu)
| Mã | Vai + tài khoản | Bước bấm | Kết quả mong đợi | Đạt/Không |
|---|---|---|---|---|
| G01 | `huy.dang` | Việc của tôi › «Chọn đối tác & người nhận» | Danh sách có công ty evolu (tên + mã số thuế); không phải gõ tay. | |
| G02 | `huy.dang` | Nhập email sai dạng rồi bấm Gửi | Báo cách sửa; chưa gửi. | |
| G03 | `huy.dang` | Nhập email đúng, bấm Gửi | Trạng thái «Chờ đối tác xác nhận»; lần gửi đầu giữ chờ evolu nhận lời mời nối. | |
| G04 | evolu · `uat-nhan-gd` | Đăng nhập › Hợp đồng › băng lời mời đầu danh sách › Nhận | Băng biến mất; hợp đồng của Demo hiện ở danh sách. | |
| G05 | `cuong.le` | Mở hợp đồng ở Demo | Thấy «Đã gửi đối tác», ghi rõ bên nhận là evolu; không lộ người duyệt nội bộ của evolu. | |

## 6. Evolu nhận và xử lý
| Mã | Vai + tài khoản | Bước bấm | Kết quả mong đợi | Đạt/Không |
|---|---|---|---|---|
| N01 | evolu · `uat-nhan-phutrach` | Hợp đồng › lọc Nguồn = Đối tác gửi | Thấy hợp đồng của Demo; `uat-nhan-phutrach` là người phụ trách. | |
| N02 | `uat-nhan-phutrach` | Mở hợp đồng 400 triệu | Mức «Quan trọng» (từ 300 triệu); hợp đồng 1,2 tỷ là «Rất quan trọng»; hợp đồng dưới 300 triệu là «Thường». | |
| N03 | evolu · `uat-nhan-duyet` | Việc của tôi › mở › Đồng ý | Việc chuyển sang bước Ký. | |
| N04 | evolu · `uat-nhan-ky` | Việc Ký › Tải lên bản đã ký | Hợp đồng ở evolu «Đã đồng ý». | |
| N05 | Demo · `cuong.le` | Mở hợp đồng; xem chuông | Thấy «Đối tác đã xác nhận» + chuông; trạng thái xong. | |
| N06 | evolu · `uat-nhan-duyet` | Hợp đồng khác: bấm Trả lại, ghi lý do | Demo thấy «Đối tác trả lại» kèm lý do; hợp đồng về người tạo sửa; chuông báo. | |
| N07 | evolu · `uat-nhan-duyet` | Hợp đồng khác: bấm Từ chối, ghi lý do | Demo thấy «Đối tác từ chối» kèm lý do; chuông báo. | |
| N08 **[cùng lúc]** | evolu · `uat-nhan-gd` | Hợp đồng 1,2 tỷ (bên gửi đề nghị ký cùng lúc): Đồng ý ký cùng lúc, chọn người ký | Hai bên cùng thấy hai dòng ký; Demo không thấy người duyệt nội bộ của evolu. | |
| N09 | evolu · `uat-nhan-gd` | Hợp đồng ký cùng lúc khác: Xử lý bình thường | Quay về quy trình nhận bình thường (không ký cùng lúc). | |
| N10 | Demo · `cuong.le` | Hợp đồng ký cùng lúc: Huỷ phiên ký, không ghi lý do | Nút Huỷ khoá tới khi có lý do; có lý do thì phiên ký chuyển «Đã huỷ». | |

## 7. Kết quả, hồ sơ duyệt, mốc
| Mã | Vai + tài khoản | Bước bấm | Kết quả mong đợi | Đạt/Không |
|---|---|---|---|---|
| H01 | Demo · `cuong.le` | Chuông (góc trên) | Có thông báo cho từng mốc: đã duyệt, đã ký, đối tác xác nhận/trả lại/từ chối. Bấm vào mở đúng hợp đồng. | |
| H02 | `demo-owner` | Mở hợp đồng › Hồ sơ duyệt | Lịch sử đủ: ai duyệt cấp nào, lúc nào, ý kiến; xem được tệp PDF/Word của hợp đồng ngay trong trang. | |
| H03 | `binh.tran` | Hồ sơ duyệt của hợp đồng đã duyệt | Thấy cả bản đã duyệt và các lần trả lại trước đó. | |
| H04 | `ha.ly` | Hợp đồng đã xong › Mốc thực hiện | Có mốc theo hợp đồng (giao, thu, nhắc hết hạn); thêm một mốc tay được. | |
| H05 | evolu · `uat-nhan-phutrach` | Hợp đồng nhận đã xong | Thấy kết quả «Đã đồng ý»; hồ sơ duyệt của evolu chỉ evolu thấy. | |

## 8. Cài đặt
| Mã | Vai + tài khoản | Bước bấm | Kết quả mong đợi | Đạt/Không |
|---|---|---|---|---|
| C01 | Demo · `demo-owner` | Cài đặt › Quy trình duyệt | Danh sách đủ 3 quy trình UAT + «Duyệt hợp đồng», đúng thứ tự xét; mỗi dòng ghi «Bắt đầu khi» bằng chữ dễ hiểu (vd «Giá trị ≥ 500 triệu», «Phòng = Mua hàng»); «Duyệt hợp đồng» ghi «Mọi hợp đồng còn lại». | |
| C02 | `demo-owner` | Bấm một quy trình | Xem được sơ đồ và danh sách bước; có khối «Ký và đối tác của quy trình này» (ký qua gì, ai ký, gửi đối tác). | |
| C03 | `cuong.le` (nhân viên) | Cài đặt › Quy trình duyệt | Xem được danh sách và sơ đồ, nhưng không có nút bật/tắt/đổi thứ tự. | |
| C04 | `demo-owner` | Cài đặt › Kết nối | Chỉ còn kết nối cấp công ty: ký số (nhà cung cấp nào) và «Đối tác xác nhận» đang Bật. | |
| C05 | evolu · `uat-nhan-gd` | Cài đặt › Kết nối | «Đối tác xác nhận» Bật; công ty cho phép được tìm thấy. | |
| C06 | evolu · `uat-nhan-gd` | Trang Quy trình › «Nhận HĐ từ đối tác (UAT)» | Panel có 3 ô: «Quan trọng từ» (300), «Rất quan trọng từ» (1000), «Người phụ trách hợp đồng nhận» (`uat-nhan-phutrach`). | |
| C07 | evolu · `uat-nhan-gd` | Đổi «Rất quan trọng từ» thành 200 (nhỏ hơn 300) rồi Lưu | Báo lỗi khoảng giá trị ngay ở ô, chưa lưu. | |
| C08 | Demo · `demo-owner` | Trang Quy trình › quy trình bất kỳ › xoá «Ký qua» (hoặc người ký phía công ty) ở bước Ký › Lưu | Báo lỗi theo từng ô («Chọn ký qua…», «Chọn người ký phía công ty»); chưa lưu được. Khôi phục lại rồi Lưu OK. | |
| C09 | Demo · `demo-owner` | Tắt quy trình «UAT · HĐ phòng Kinh doanh gửi đối tác» rồi gửi duyệt hợp đồng khác của Kinh doanh | Hợp đồng đi theo quy trình khớp kế tiếp («Duyệt hợp đồng»). Bật lại sau khi thử. | |

## 9. Ghi chú còn thiếu
- Hai loại hợp đồng mới của CR-152 (Nhượng quyền, Thỏa thuận hợp tác) chưa có trên bản này, chưa có hợp đồng mẫu và chưa có ca; thêm khi CR-152 vào nhánh.
- Ca K03 cần nhà cung cấp ký thử; nếu chưa có thì ghi «Bỏ qua». Ca N08 cần tệp PDF có chữ.
