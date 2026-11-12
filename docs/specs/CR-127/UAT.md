# CR-127 / CR-128 · Kịch bản UAT (người dùng tự test tay)

Mục tiêu: kiểm hợp đồng chạy theo quy trình duyệt của công ty trên stack dev local. Mọi dữ liệu test tạo trên công ty **demo**, KHÔNG dùng `evolu`.

## Dựng dữ liệu (CR-130 · chạy lại được, chỉ tenant demo)
- Community + đối tác SHT (dọn dữ liệu Community cũ của demo rồi dựng lại): `bun --env-file=.env.local tools/scripts/src/seed-community-demo.ts --out .data/dev-up/community-pw.json --apply --reset --dev-fixture` (xoá `.data/dev-up/community-pw.json` sau khi chạy).
- Quy trình duyệt hợp đồng / đề nghị mua hàng: `bun run demo:flows`
- Kết quả: 3 NCC + 3 Khách hàng có tài khoản Bảng tin, đối tác SHT chưa mời, 1 đơn xin tham gia đang chờ (Nam Việt Packaging). Tài khoản đối tác `doitac-*` dùng chung mật khẩu dev `DEMO_OWNER_PW` (`.env.local`).

## 0. Dựng dữ liệu (làm trước tiên)
1. Stack dev đang chạy, có tenant demo (`scripts\dev-up.ps1 -SeedDemo`, xem `docs/guides/local-setup.md`).
2. Chạy: `bun run demo:flows` — tạo bằng đúng đường Quản trị nền tảng (tạo từ sơ đồ trống → vẽ bước → «Áp dụng cho công ty») hai quy trình cho công ty demo; chạy lại được (ghi đè bản cũ, không nhân bản); tự kiểm và báo lỗi nếu sai.
   - **Duyệt hợp đồng**: bắt đầu khi hợp đồng được gửi duyệt → Trưởng phòng duyệt → nếu giá trị > 500.000.000 thì Giám đốc duyệt → Kết thúc.
   - **Đề nghị mua hàng**: bắt đầu bằng phiếu Yêu cầu (mặt hàng, số lượng, giá trị dự kiến, lý do) → Trưởng phòng duyệt → Kết thúc.
3. Địa chỉ: Admin http://localhost:3000 · Sổ Hợp Tác http://localhost:3300/contracts · Community http://localhost:3400.
4. Mật khẩu: xem tệp mật khẩu dev (`.env.local`, khoá `DEMO_OWNER_PW` cho user demo, `SEED_ADMIN_PASSWORD` cho quản trị nền tảng; mật khẩu đối tác ở `.data\dev-up\demo-partners.txt`). KHÔNG ghi mật khẩu vào tài liệu.
5. Cần hai trình duyệt (hoặc một cửa sổ ẩn danh) để đăng nhập hai người cùng lúc. Lỡ làm hỏng: tải/tạo hợp đồng mới là đủ; chạy lại `bun run demo:flows` để đưa hai quy trình về chuẩn.

### Tài khoản
| Mã công ty | Đăng nhập | Vai trò | Dùng cho |
|---|---|---|---|
| `platform` | `admin` | Quản trị nền tảng | UC-30 đến UC-34 |
| `demo` | `demo-owner` (Nguyễn Văn An) | Quản trị công ty, Toàn quyền; thuộc nhóm Giám đốc, Trưởng bộ phận… | Người duyệt, duyệt thay |
| `demo` | `demo-editor` (Lê Văn Cường) | Nhân viên; nhóm **Trưởng phòng** | Người tải/gửi; người duyệt bước 1 |
| `demo` | `demo-viewer` (Trần Thị Bình) | Chỉ xem | Kiểm quyền chỉ xem |
| `demo` | `doitac-*` | Đối tác | UC-21 |

Lưu ý nhóm: «Trưởng phòng» chỉ có `demo-editor`; «Giám đốc» có `demo-owner`. Nên người tải HĐ (editor) cũng là người duyệt bước 1; muốn người gửi khác người duyệt thì để `demo-owner` tải/gửi và `demo-editor` duyệt, hoặc ngược lại cho bước Giám đốc.

## 1. Tóm tắt
| Mã | Tên | Vai trò | Ưu tiên |
|---|---|---|---|
| UC-01 | Tải HĐ lên: người tải là người phụ trách | Nhân viên | Cao |
| UC-02 | Tải HĐ không đọc được / sai tệp | Nhân viên | TB |
| UC-03 | Sửa HĐ nháp và lưu | Người tạo | Cao |
| UC-04 | Xoá HĐ nháp ở trang chi tiết | Người tạo | Cao |
| UC-05 | Xoá HĐ nháp ở danh sách | Người tạo | Cao |
| UC-06 | HĐ đã gửi duyệt không xoá được | Người tạo | Cao |
| UC-07 | Người khác không xoá/sửa nháp của bạn | Nhân viên khác | TB |
| UC-10 | Gửi duyệt HĐ ≤ 500 triệu (1 bước) | Người gửi | Cao |
| UC-11 | Gửi duyệt HĐ > 500 triệu (2 bước) | Người gửi | Cao |
| UC-12 | Rút HĐ về nháp | Người gửi | TB |
| UC-13 | Công ty tắt quy trình: Gửi duyệt báo lý do | Người gửi | Cao |
| UC-14 | Duyệt: Nhận việc → Duyệt | Người duyệt | Cao |
| UC-15 | Trả lại sửa rồi gửi lại | Người duyệt, người gửi | Cao |
| UC-16 | Từ chối | Người duyệt | Cao |
| UC-17 | Toàn quyền duyệt thay | Toàn quyền | TB |
| UC-18 | Nhận việc, trả về nhóm, người khác thấy ai đang xử lý | Người duyệt | TB |
| UC-19 | Tìm theo số HĐ và cột «Số HĐ» | Mọi vai | Cao |
| UC-20 | Danh sách: trạng thái, «Đang chờ», bộ lọc | Mọi vai | Cao |
| UC-21 | Gửi đối tác xác nhận (nếu có trên màn hình) | Người gửi, đối tác | TB |
| UC-22 | Hợp đồng «Xong» chỉ đọc, phiên bản mới | Người phụ trách | TB |
| UC-23 | Hồ sơ duyệt tải PDF có dấu | Người gửi, người duyệt | TB |
| UC-25 | Phiếu Yêu cầu «Đề nghị mua hàng»: tạo | Nhân viên | Cao |
| UC-26 | Phiếu: duyệt → kết quả | Người duyệt | Cao |
| UC-27 | Phiếu: thiếu ô bắt buộc, trả lại, từ chối | Nhân viên, người duyệt | TB |
| UC-28 | Thông báo / chuông | Mọi vai | Cao |
| UC-30 | Quản trị nền tảng: tạo quy trình từ sơ đồ trống | Quản trị nền tảng | Cao |
| UC-31 | Sửa quy trình, «Áp dụng cho công ty» | Quản trị nền tảng | Cao |
| UC-32 | Thanh lưu báo lý do khi chưa hợp lệ | Quản trị nền tảng | TB |
| UC-33 | Xoá quy trình nháp (đã áp dụng thì không xoá) | Quản trị nền tảng | TB |
| UC-34 | Quản trị công ty chỉ xem quy trình | Quản trị công ty | Cao |

Thứ tự đề nghị: mục 0 → UC-01 → UC-03 → UC-04/05 → UC-10 → UC-14 → UC-11 → UC-15/16 → UC-19/20 → UC-25/26 → UC-28 → UC-30 trở đi → còn lại.

---

## A. Tải lên và HĐ nháp

### UC-01 · Tải HĐ lên: người tải là người phụ trách
**Tiền đề:** đã chạy mục 0. **Tài khoản:** `demo-editor`.
**Bước**
1. Sổ Hợp Tác › Hợp đồng, tải một tệp văn bản/PDF, bấm xác nhận tải lên.
2. Đợi đọc/trích xuất; màn chi tiết mở ra.
3. Nhìn «Người phụ trách», trạng thái, các nút.
**Mong đợi**
- [ ] Hợp đồng ở trạng thái «Nháp».
- [ ] Người phụ trách = chính người tải (Lê Văn Cường).
- [ ] Có «Lưu nháp», «Gửi duyệt», «Xoá» (người tạo).
- [ ] Tải lên KHÔNG tự chạy quy trình duyệt nào (việc duyệt chỉ bắt đầu khi Gửi duyệt).
**Ghi chú lỗi:** ______

### UC-02 · Tải tệp không đọc được
**Tài khoản:** `demo-editor`.
**Bước:** tải một tệp rỗng hoặc sai định dạng.
**Mong đợi**
- [ ] Báo lỗi bằng câu nói cách khắc phục (đổi tệp / nhập tay), không treo.
- [ ] Không để lại hợp đồng hỏng khó hiểu trong danh sách.
**Ghi chú lỗi:** ______

### UC-03 · Sửa HĐ nháp
**Tài khoản:** `demo-editor` (người tạo).
**Bước:** mở nháp ở UC-01 → sửa «Tên hợp đồng», đối tác, giá trị (120.000.000), mốc → «Lưu nháp» → tải lại trang.
**Mong đợi**
- [ ] Giá trị đã sửa còn sau khi tải lại; vẫn «Nháp».
- [ ] Nhập sai (giá trị âm/chữ) có báo ô nào sai.
**Ghi chú lỗi:** ______

### UC-04 · Xoá HĐ nháp ở trang chi tiết
**Tài khoản:** `demo-editor`.
**Bước:** tạo một nháp mới (UC-01) → ở chi tiết bấm «Xoá» → xác nhận.
**Mong đợi**
- [ ] Có hộp xác nhận nói rõ xoá không khôi phục.
- [ ] Sau xoá quay về danh sách, hợp đồng không còn.
**Ghi chú lỗi:** ______

### UC-05 · Xoá HĐ nháp ở danh sách
**Tài khoản:** `demo-editor`.
**Bước:** `/contracts/list` → dòng HĐ nháp của mình → thao tác «Xoá» → xác nhận.
**Mong đợi**
- [ ] Chỉ dòng nháp của mình có thao tác Xoá; dòng đã gửi/xong/của người khác thì không.
- [ ] Xoá xong dòng biến mất, không cần tải lại.
**Ghi chú lỗi:** ______

### UC-06 · HĐ đã gửi duyệt không xoá được
**Tài khoản:** `demo-editor`. **Tiền đề:** có HĐ «Đang duyệt» (UC-10).
**Bước:** mở HĐ đang duyệt; nhìn danh sách và chi tiết.
**Mong đợi**
- [ ] Không có nút «Xoá» ở cả chi tiết lẫn danh sách (muốn bỏ thì «Rút về» rồi xoá nháp).
**Ghi chú lỗi:** ______

### UC-07 · Người khác không xoá/sửa nháp của bạn
**Tài khoản:** `demo-viewer`, rồi `demo-owner`.
**Bước:** mở nháp của `demo-editor`.
**Mong đợi**
- [ ] Chỉ-xem: không có Lưu/Gửi/Xoá. Toàn quyền: theo quyền đã cấp (ghi lại nếu xoá được).
**Ghi chú lỗi:** ______

---

## B. Gửi duyệt và duyệt (quy trình «Duyệt hợp đồng»)

### UC-10 · Gửi duyệt HĐ ≤ 500 triệu (1 bước)
**Tài khoản:** người gửi `demo-owner`; người duyệt `demo-editor` (nhóm Trưởng phòng).
**Bước**
1. `demo-owner` tải HĐ, đặt giá trị 120.000.000, «Lưu nháp», «Gửi duyệt» (xem trước các bước nếu có).
2. Xem chi tiết HĐ.
3. `demo-editor` vào «Chờ tôi duyệt».
**Mong đợi**
- [ ] «Gửi duyệt» KHÔNG báo lỗi 409/«chưa có quy trình».
- [ ] «Nháp» → «Đang duyệt»; chi tiết hiện đúng 1 bước «Trưởng phòng duyệt», đang chờ nhóm Trưởng phòng.
- [ ] `demo-editor` thấy việc trong «Chờ tôi duyệt».
**Ghi chú lỗi:** ______

### UC-11 · Gửi duyệt HĐ > 500 triệu (2 bước)
**Tài khoản:** như UC-10.
**Bước:** tạo HĐ giá trị 600.000.000 → Gửi duyệt → `demo-editor` Nhận việc + Duyệt bước 1 → `demo-owner` xem.
**Mong đợi**
- [ ] Chi tiết hiện 2 bước: Trưởng phòng rồi Giám đốc.
- [ ] Sau bước 1, việc chuyển sang nhóm Giám đốc; `demo-owner` nhận, duyệt → «Xong».
- [ ] Với 120 triệu (UC-10) không có bước Giám đốc; đúng ngưỡng 500.000.000 thì không thêm bước (chỉ «lớn hơn» mới thêm).
**Ghi chú lỗi:** ______

### UC-12 · Rút về nháp
**Tài khoản:** người gửi. **Tiền đề:** HĐ «Đang duyệt», chưa ai quyết.
**Bước:** bấm «Rút về», nhập lý do.
**Mong đợi**
- [ ] HĐ về «Nháp», việc duyệt của người duyệt biến mất; gửi lại được.
**Ghi chú lỗi:** ______

### UC-13 · Công ty tắt quy trình: Gửi duyệt báo lý do
**Tài khoản:** `admin` tắt «Duyệt hợp đồng» ở Quy trình của công ty demo; `demo-editor` thử Gửi duyệt.
**Mong đợi**
- [ ] Có dòng «Công ty chưa có quy trình duyệt hợp đồng» kèm chỉ dẫn; nháp vẫn lưu được; HĐ vẫn «Nháp».
- [ ] Bật lại (hoặc chạy lại `bun run demo:flows`) thì Gửi duyệt chạy lại.
**Ghi chú lỗi:** ______

### UC-14 · Duyệt: Nhận việc → Duyệt
**Tài khoản:** người duyệt `demo-editor`.
**Bước:** «Chờ tôi duyệt» → dòng hiện «Chưa ai nhận» → mở → «Nhận việc» (thẻ «Bạn đang giữ») → «Duyệt», nhập ý kiến (và tệp nếu bước đòi).
**Mong đợi**
- [ ] Chưa nhận việc thì không có nút Duyệt.
- [ ] Duyệt xong: bước kế mở hoặc HĐ «Xong»; ý kiến ghi trong hồ sơ duyệt.
- [ ] Người gửi nhận thông báo (UC-28).
**Ghi chú lỗi:** ______

### UC-15 · Trả lại sửa rồi gửi lại
**Bước:** người duyệt Nhận việc → «Trả lại sửa» (nhập lý do) → người gửi mở HĐ.
**Mong đợi**
- [ ] HĐ về «Nháp», hiện lý do trả lại; sửa và Gửi duyệt lại được, lượt mới bắt đầu từ bước 1.
**Ghi chú lỗi:** ______

### UC-16 · Từ chối
**Bước:** người duyệt Nhận việc → «Từ chối» (lý do).
**Mong đợi**
- [ ] HĐ «Từ chối», người gửi thấy lý do; HĐ chỉ đọc.
**Ghi chú lỗi:** ______

### UC-17 · Toàn quyền duyệt thay
**Tài khoản:** `demo-owner` (Toàn quyền, KHÔNG thuộc Trưởng phòng); HĐ do `demo-editor` gửi.
**Bước:** `demo-owner` mở HĐ ở bước Trưởng phòng → Nhận việc → Duyệt.
**Mong đợi**
- [ ] Không Nhận việc thì chưa Duyệt được.
- [ ] Bước 1 có huy hiệu «Duyệt thay · Toàn quyền» (có thể không hiện nếu duyệt từ màn «Chờ tôi duyệt»: ghi lại).
**Ghi chú lỗi:** ______

### UC-18 · Nhận việc, trả về nhóm
**Tài khoản:** hai người cùng nhóm duyệt (có thể thêm một user vào nhóm Trưởng phòng).
**Mong đợi**
- [ ] A nhận → B thấy «A đang xử lý», Duyệt khoá; A «Trả về nhóm» → ai cũng nhận được.
**Ghi chú lỗi:** ______

---

## C. Danh sách và tìm kiếm

### UC-19 · Tìm theo số HĐ, cột «Số HĐ»
**Tài khoản:** mọi vai. **Tiền đề:** có HĐ có số (HĐ seed hoặc HĐ đã nhập số).
**Bước:** `/contracts/list` → nhìn cột «Số HĐ» → gõ một phần số HĐ vào ô tìm → thử gõ tên HĐ.
**Mong đợi**
- [ ] Có cột «Số HĐ»; HĐ chưa có số hiện trống rõ ràng.
- [ ] Tìm theo số ra đúng HĐ; tìm theo tên vẫn ra; không khớp thì có câu «không có kết quả».
**Ghi chú lỗi:** ______

### UC-20 · Trạng thái, «Đang chờ», bộ lọc
**Mong đợi**
- [ ] Chỉ 4 trạng thái: Nháp / Đang duyệt / Từ chối / Xong.
- [ ] Cột «Đang chờ» cho biết ai/nhóm nào đang chờ; lọc theo trạng thái, «Hiệu lực», «Nguồn» đúng.
**Ghi chú lỗi:** ______

### UC-21 · Gửi đối tác xác nhận
**Tài khoản:** người phụ trách; đối tác `doitac-*`. Nếu màn hình không có nút «Gửi đối tác» thì ghi «không có» và đi tiếp.
**Bước:** mở HĐ phù hợp → «Gửi đối tác xác nhận» (thông tin đối tác điền sẵn trên trang chi tiết) → đối tác nhận email/lời mời → xác nhận.
**Mong đợi**
- [ ] Thông tin đối tác điền sẵn; gửi xong hiện trạng thái «Chờ đối tác»; không gửi trùng khi bấm hai lần.
- [ ] Đối tác xác nhận/từ chối → bên mình thấy kết quả; không lộ người duyệt nội bộ.
**Ghi chú lỗi:** ______

### UC-22 · HĐ «Xong» chỉ đọc, phiên bản mới
**Mong đợi**
- [ ] HĐ «Xong» không sửa được; «Phiên bản mới» tạo bản «Nháp», bản cũ vẫn «Xong».
**Ghi chú lỗi:** ______

### UC-23 · Hồ sơ duyệt tải PDF
**Bước:** HĐ đã duyệt → «Hồ sơ duyệt» → tải PDF.
**Mong đợi**
- [ ] Tải được; tiếng Việt có dấu đúng; có người duyệt, ý kiến, thời điểm.
**Ghi chú lỗi:** ______

---

## D. Phiếu Yêu cầu «Đề nghị mua hàng»

### UC-25 · Tạo phiếu
**Tài khoản:** `demo-owner` (hoặc bất kỳ nhân viên demo). **Tiền đề:** mục 0.
**Bước:** mở mục «Yêu cầu» (ứng dụng không gian làm việc) → chọn «Đề nghị mua hàng» → điền Mặt hàng «Máy in», Số lượng «2», Giá trị dự kiến 12.500.000, Lý do → Gửi.
**Mong đợi**
- [ ] Danh sách quy trình có «Đề nghị mua hàng» với đủ 4 ô; ô bắt buộc có dấu.
- [ ] Gửi xong thấy yêu cầu «Đề nghị mua Máy in» trong danh sách của mình, trạng thái đang chờ Trưởng phòng.
- [ ] Bấm Gửi hai lần không tạo hai yêu cầu.
**Ghi chú lỗi:** ______

### UC-26 · Phiếu: duyệt → kết quả
**Tài khoản:** `demo-editor`.
**Bước:** «Chờ tôi duyệt» → thấy việc kèm nội dung phiếu → Nhận việc → Duyệt.
**Mong đợi**
- [ ] Việc hiện đủ thông tin phiếu để quyết định.
- [ ] Duyệt xong, yêu cầu của người tạo chuyển «Đã duyệt» và người tạo được báo.
**Ghi chú lỗi:** ______

### UC-27 · Phiếu: thiếu ô, trả lại, từ chối
**Bước:** gửi phiếu bỏ trống «Mặt hàng»; gửi phiếu khác rồi Trả lại / Từ chối.
**Mong đợi**
- [ ] Thiếu ô bắt buộc báo rõ ô nào, không tạo yêu cầu.
- [ ] Trả lại / Từ chối: người tạo thấy kết quả kèm lý do.
**Ghi chú lỗi:** ______

### UC-28 · Thông báo / chuông
**Mong đợi**
- [ ] Việc mới: người duyệt thấy chuông/thông báo. Duyệt/Trả lại/Từ chối/Xong: người gửi được báo, bấm vào mở đúng HĐ/yêu cầu.
- [ ] Không báo trùng nhiều lần cho cùng một việc.
**Ghi chú lỗi:** ______

---

## E. Quản trị nền tảng (tài khoản `admin`, http://localhost:3000)

### UC-30 · Tạo quy trình từ sơ đồ trống
**Bước:** Quy trình › «Tạo quy trình» → chọn công ty **demo** (và app Sổ Hợp Tác nếu hỏi) → tên «Duyệt thử» → «Tạo và mở sơ đồ» → thêm khối «Duyệt», chọn «Ai duyệt».
**Mong đợi**
- [ ] Sơ đồ mở dạng danh sách khối, có sẵn điểm kết thúc; không còn mẫu/thư viện/sao chép.
- [ ] Quy trình mới ở trạng thái nháp, CHƯA ảnh hưởng gửi duyệt của công ty.
**Ghi chú lỗi:** ______

### UC-31 · Sửa và «Áp dụng cho công ty»
**Bước:** mở «Duyệt hợp đồng» → đổi ngưỡng Nếu thành 300.000.000 → «Áp dụng cho công ty» → gửi duyệt HĐ 400 triệu. Sau đó chạy lại `bun run demo:flows` để trả ngưỡng.
**Mong đợi**
- [ ] Áp dụng báo thành công; HĐ 400 triệu có thêm bước Giám đốc; lượt đang chạy trước đó không bị đổi.
**Ghi chú lỗi:** ______

### UC-32 · Thanh lưu báo lý do
**Bước:** thêm khối «Nếu» chưa điền điều kiện / khối Duyệt chưa chọn người.
**Mong đợi**
- [ ] Thanh dưới nói bước nào thiếu gì; điền đủ thì «Áp dụng cho công ty» bấm được; «Chạy thử» không tạo dữ liệu thật.
**Ghi chú lỗi:** ______

### UC-33 · Xoá quy trình nháp
**Bước:** quy trình «Duyệt thử» (UC-30, chưa áp dụng) → «Xoá» → xác nhận; thử tìm nút Xoá ở «Duyệt hợp đồng» (đã áp dụng).
**Mong đợi**
- [ ] Nháp xoá được; quy trình đã áp dụng/đã có lượt chạy không có nút Xoá (dùng «Tắt»).
**Ghi chú lỗi:** ______

### UC-34 · Quản trị công ty chỉ xem
**Tài khoản:** `demo-owner` vào Admin (mã công ty `demo`).
**Mong đợi**
- [ ] Thấy hai quy trình và các bước; không có «Tạo quy trình»/sửa/xoá; có câu nói chỉ quản trị nền tảng mới sửa.
- [ ] Vẫn chỉnh được cài đặt vận hành (giờ tự trả việc chưa nhận).
**Ghi chú lỗi:** ______

---

## Đã biết / chưa làm
- Hiệu năng hoãn (danh sách HĐ p95 ~51–100 ms, quét nền 60–76 ms): không tính là lỗi UAT.
- Hợp đồng thường không còn «+ Thêm mốc»; thư viện quy trình, mẫu, sao chép, «Tóm tắt hợp đồng» đã gỡ.
- Ký số cần cấu hình riêng; chưa có thì bỏ qua.
- «Đề nghị mua hàng» cùng sự kiện «Khi gửi duyệt hợp đồng» với «Duyệt hợp đồng» nên bảng Quy trình có thể cảnh báo «bị che bởi quy trình không điều kiện»: không ảnh hưởng chạy bằng phiếu (đã ghi vào báo cáo CR-128).
- Code chưa commit trên nhánh `staging-improve`.

## Cách báo lỗi
Ghi: mã UC, bước số, tài khoản, điều đã thấy, điều mong đợi, kèm ảnh cả màn hình (thấy URL). Lỗi chặn ghi «Chặn».
