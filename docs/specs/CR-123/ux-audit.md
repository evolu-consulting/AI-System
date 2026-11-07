# CR-123 · Soát UX CR-122 (góc nhìn giám đốc / sale / người duyệt)

Phạm vi và giới hạn: soát **theo văn bản i18n** (`packages/i18n/locales/process/admin.vi.json`, `contracts/*.vi.json`) và Luật GỐC mục 3. **Chưa chụp màn hình sống**: bị chặn không đọc được mật khẩu demo (`ctx-local.json`), nên không đăng nhập được vào http://localhost:3600 / 3610. Chỉ thấy màn đăng nhập. Các dòng cần xác nhận bằng mắt ghi "(cần chụp)". Thư mục `shots/` chưa có ảnh.

Mức: Chặn / Cao / TB.

## A. Công ty › Quy trình (danh sách, Thư viện, bật quy trình)

| # | Màn hình | Thấy gì | Vì sao khó hiểu | Đề xuất sửa | Mức |
|---|---|---|---|---|---|
| 1 | Công ty › Quy trình | `list.subtitle`: "Chuỗi giai đoạn do agent hoặc nhóm agent làm. Người kiểm bấm Đạt thì quy trình tự chạy tiếp, Chưa đạt thì agent làm lại…" | Đây là mô tả quy trình AI, không phải quy trình duyệt hợp đồng. Giám đốc không biết "agent", "giai đoạn", "người kiểm". | "Các bước duyệt hợp đồng của công ty: ai duyệt, theo thứ tự nào, khi nào nhờ người ký." | Cao |
| 2 | Danh sách | Tab "Của công ty" / "Mẫu · chạy thử"; nút "Chép mẫu", "Chạy", cột "Lượt đang chạy", "Bật" | "Chạy thử", "Lượt" là ngôn ngữ kỹ thuật. Hai khái niệm cho một việc: "Mẫu" và "Thư viện". Công tắc "Bật" riêng (hành động ẩn bắt buộc). | Gộp một tên: "Mẫu có sẵn". Nút "Chép mẫu" → "Dùng mẫu này". Bỏ nút "Chạy" khỏi giám đốc (để Nâng cao). Gán xong là áp dụng, không cần bật riêng; nếu giữ công tắc, hiện dòng "Đang tắt vì …, bật ở đây". | Cao |
| 3 | Cờ "Dùng quy trình mới" | Cờ/công tắc theo CR-122 (cần chụp) | Giám đốc không hiểu "quy trình mới" so với cái gì; là cờ chuyển engine, thuộc kỹ thuật. | Ẩn khỏi người dùng công ty; chỉ nền tảng thấy trong Nâng cao. Công ty thấy một quy trình duy nhất đang áp dụng. | Cao |
| 4 | Thư viện | "Mặc định · {{slot}}", "Dùng cho: {{slot}}", "{{n}} tenant đang dùng", "Nhân bản", "Đặt làm mặc định", "khe" | "slot/khe", "tenant" lộ ra; "Nhân bản" và "Chép mẫu" là hai từ cho cùng một việc. | "khe" → "loại việc" (đã có "Việc cần duyệt"); "tenant" → "công ty"; thống nhất "Sao chép". | Cao |
| 5 | Xuất bản | `publish.body`: "Chỉ bản xuất bản mới được chạy. Lượt mới của tenant đang dùng chạy bản này; lượt đang chạy giữ bản cũ." | "Lượt", "tenant". Không nói rõ hợp đồng đang chờ duyệt có đổi không. | "Sau khi xuất bản, hợp đồng gửi duyệt từ bây giờ sẽ theo quy trình mới. Hợp đồng đang chờ duyệt vẫn theo quy trình cũ." | Cao |
| 6 | Lưu nháp | `saveHint`: "Lưu nháp chưa áp dụng cho tenant — bấm Xuất bản để áp dụng." | Hai bước (Lưu rồi Xuất bản) với công ty chép bản riêng; `copySaveNote` lại nói "Lưu là áp dụng ngay". Hai thông điệp mâu thuẫn. | Một quy tắc cho một loại người dùng: công ty chỉ có nút "Lưu và áp dụng"; "Xuất bản" chỉ cho nền tảng. | Cao |
| 7 | Lỗi gán/xoá | "Quy trình đang là mặc định hoặc đang gán cho tenant: không xoá/tắt/đổi ký hiệu được." (PROCESS_IN_USE); "Đang có tenant dùng: bỏ gán trước." | Không nói bỏ gán ở đâu, bằng nút nào. | "Quy trình này đang được dùng cho {{n}} loại hợp đồng. Vào Công ty › Quy trình, chọn quy trình khác rồi quay lại xoá." | TB |
| 8 | Thông báo lỗi chung | "Có tenant thiếu phòng ban theo mã…", "Quy trình dùng nguồn mã mà tenant này chưa có…" (SLOT_GROUPS_MISSING, SOURCE_NOT_FOUND) | Lộ "tenant", "mã", "nguồn mã". | "Công ty chưa có phòng ban {{tên}} mà quy trình cần. Thêm phòng ban này ở Người dùng › Phòng ban rồi lưu lại." | TB |

## B. Trình soạn quy trình (sơ đồ / danh sách)

| # | Màn hình | Thấy gì | Vì sao khó hiểu | Đề xuất sửa | Mức |
|---|---|---|---|---|---|
| 9 | Panel node "Gọi tool" | `Gọi tool`, "Chọn tool…", "Chưa có tool nào được bật cho công ty — liên hệ quản trị nền tảng", "Tool", "Tác dụng phụ", "Tham số", "Nguồn của tham số" | Toàn thuật ngữ lập trình. Giám đốc không có việc để làm ở đây. | Ẩn cả node trong nhóm "Nâng cao" (đã có nhóm). Đổi: "Gọi tool" → "Chạy tính năng", "Tác dụng phụ" → "Việc này có tác động thật (gửi đi, ghi dữ liệu)", "Tham số" → "Thông tin cần điền". | Chặn |
| 10 | Panel node "Nếu" | "Nếu (rẽ Đúng/Sai)", "Đúng thì tới bước", "Sai thì tới bước", "Bước kế", "Phép so sánh", "Kết hợp điều kiện (VÀ/HOẶC)" | "Đúng/Sai", "Bước kế" lập trình. Với sale: không rõ "Đúng" nghĩa là gì. | Câu đọc được: "Nếu **giá trị hợp đồng** **lớn hơn** **100 triệu** → đi bước A, ngược lại → bước B". Đổi "Bước kế" → "Bước tiếp theo". | Cao |
| 11 | Panel node "Duyệt" | "Duyệt bởi Group", "Nhóm kiểm", "Hạn quyết (giờ)", "Chuyển cấp tới (mã phòng ban)", "Chỉ trưởng phòng duyệt", "Nhắc mỗi (giờ)" | "Group", "mã phòng ban" (người dùng phải gõ mã như `pb-ke-toan`). Nhiều ô cho một người duyệt đơn giản. | Chọn phòng ban/người từ danh sách (không gõ mã). Mặc định chỉ thấy "Ai duyệt" + "Hạn trả lời"; còn lại gom trong "Nâng cao". | Cao |
| 12 | Panel node "Ký số" | "Nhà cung cấp ký số (khoá)", "Mặc định của công ty", "Mã phòng ban của trưởng phòng ký", `info`: "Duyệt xong thì tự gửi ký; ký xong luồng kết thúc." | "(khoá)" và "luồng" không rõ. Hai nơi cấu hình nhà cung cấp (bước và Cài đặt › Ký số). | Một nơi chọn nhà cung cấp (Cài đặt › Ký số); ở bước chỉ hiện "Ký bằng: {{nhà cung cấp mặc định}}" + liên kết đổi. Câu info → "Duyệt xong sẽ tự gửi để ký; ký xong hợp đồng chuyển sang Đã ký." | Cao |
| 13 | Node "Chờ ký xong" (chờ sự kiện) | "Chờ sự kiện", "Khoá sự kiện", "Gói bắn sự kiện này (vd esign.completed)…", "Hết hạn sau (giờ)" | Mã sự kiện `esign.completed` lộ ra. | Tên hiển thị "Chờ ký xong"; chọn từ danh sách "Khi ký xong / bị từ chối / hết hạn"; ẩn mã. Hết hạn: "Nếu quá {{n}} giờ chưa ký thì: [đi tiếp / báo người phụ trách]". | Chặn |
| 14 | Node "Thông báo" | "Chèn thông tin hợp đồng", "Chuông (luôn có)", "Thêm email" | "Chuông" lạ; ổn nếu bell có icon. Ô tiêu đề/nội dung trống không có gợi ý mẫu. | Đặt sẵn nội dung mẫu ("Hợp đồng {{Mã hợp đồng}} đã được duyệt") và chú thích "Hiện ở chuông thông báo". | TB |
| 15 | Node "Kết thúc" | `finish.outcome`: "Kết quả", lỗi "Thêm ít nhất một node Kết thúc.", "Node Kết thúc là điểm cuối" | Không rõ "kết quả" ảnh hưởng gì tới hợp đồng. "node" lộ. | "Kết thúc với: ☐ Hợp đồng được duyệt ☐ Bị từ chối ☐ Cần xử lý". Lỗi: "Thêm bước Kết thúc ở cuối mỗi nhánh." | Cao |
| 16 | Nhóm node "Cơ bản / Lõi / Nâng cao" | `group.core`: "Lõi" | "Lõi" vô nghĩa với giám đốc; "Chuẩn bị dữ liệu", "Chia / Gộp", "Agent", "Công cụ" nằm cùng menu. | Menu "+" mặc định chỉ: Duyệt, Nếu, Ký số, Chờ ký xong, Thông báo, Kết thúc. Phần còn lại dưới "Nâng cao" và chỉ nền tảng thấy. Đổi "Lõi" → bỏ. | Cao |
| 17 | Menu "+" chèn bước | "Thêm bước", "Thêm bước vào giữa", "Thêm bước DLC", "Bước DLC trong thư viện", "Bước Dify" | DLC/Dify là tên nội bộ (và DLC là phần của Rowan). | Giấu hoàn toàn với công ty ký hợp đồng; hiện theo loại ứng dụng. | Cao |
| 18 | Lỗi kiểm tra | "Cấu hình node không hợp lệ. Kiểm tra các ô được đánh dấu." (FLOW_NODE_CONFIG_INVALID); "Flow chưa hợp lệ. Kiểm tra từng node."; "Quy trình chưa hợp lệ. Kiểm tra các ô báo lỗi." | Dùng "node", "Flow" (tên khác với "Quy trình"), không nói ô nào, vì sao, sửa gì. | Chỉ ra đúng bước: "Chưa lưu được — bước 'Duyệt trưởng phòng': chọn phòng ban duyệt." (mẫu `saveBlockedStep` đã đúng, dùng đồng bộ). | Cao |
| 19 | Cầu nối dữ liệu | "Thiếu dữ liệu", "{{from}} → {{to}}: thiếu “{{key}}”", "Thêm node Ghi giá trị để nối hai bước", "Gợi ý cầu nối" | Khóa kỹ thuật (`contract_id`, key) lộ; người dùng không thể tự xử. | Hệ thống tự nối; nếu không được, hiện: "Bước 'Ký số' cần Mã hợp đồng nhưng bước trước chưa có. Bấm 'Tự sửa'." Ẩn tên khoá. | Cao |
| 20 | Rẽ nhánh Nếu có nhiều điều kiện | `if.max`: "Tối đa 6 điều kiện"; `branch`: "Luật đầu tiên khớp được dùng" | Ngôn ngữ luật lập trình. | Mô tả ví dụ ngay dưới ô: "Ví dụ: Giá trị > 100 triệu → Giám đốc duyệt". | TB |
| 21 | Giới hạn | `limitsText`: "Tối đa 7 ngày · 5 lượt cùng lúc · làm lại ≤ 3 lần mỗi giai đoạn … Chạm giới hạn → “Cần người quyết”." | Một hàng số kỹ thuật cho giám đốc. | Bỏ khỏi trang chính; nếu cần: "Hợp đồng chờ quá {{n}} ngày sẽ báo người phụ trách." | TB |
| 22 | Từ khoá thống nhất | "Quy trình" vs "Flow" (`flow.err.*`, `showcase.title`), "Giai đoạn" vs "Bước" vs "Stage" (`AUTOFIX_*`), "Đạt/Chưa đạt/Từ chối/Duyệt", "Group" vs "Nhóm" vs "Phòng ban" | Một khái niệm nhiều tên (Luật GỐC 2). | Chuẩn: **Quy trình**, **Bước**, **Duyệt / Từ chối / Trả lại**, **Phòng ban**. Quét toàn i18n, thay "Flow", "Giai đoạn", "Stage", "Group", "Đạt". | Cao |
| 23 | Lưu/Xuất bản | Toast "Đã xuất bản bản v{{n}}", "Đã sao chép và gán cho công ty này" | "bản v3" vô nghĩa với giám đốc; "gán" mơ hồ. | "Đã áp dụng. Hợp đồng gửi duyệt từ giờ theo quy trình này." | TB |

## C. Ứng dụng Hợp đồng (danh sách, tải lên, duyệt, ký)

| # | Màn hình | Thấy gì | Vì sao khó hiểu | Đề xuất sửa | Mức |
|---|---|---|---|---|---|
| 24 | Thẻ duyệt, trạng thái lỗi | `needs_decision`: "Cần quyết" (esignflow) và "Cần quyết định" (cùng file) | Hai chữ cho một trạng thái; không nói ai quyết, vì sao. | Một chữ "Cần xử lý" + lý do + ai: "Chờ bạn quyết: đối tác từ chối ký. [Gửi lại] [Dừng]". | Cao |
| 25 | Thẻ duyệt, đang ký | Thẻ ký có "Đạt", "Thử lại", "resendFail: Không gửi lại được." | "Đạt" lẫn với "Duyệt"; lỗi không nói cách xử lý. | "Không gửi lại được vì đối tác chưa có email. Thêm email ở thông tin đối tác rồi bấm Gửi lại." | Cao |
| 26 | Trạng thái chung (cần chụp) | Mọi trạng thái thẻ: Chờ / Đã duyệt / Đang ký / Lỗi | Luật GỐC 3: mỗi trạng thái cần 3 dòng: trạng thái · lý do · bước kế. | Mẫu: "Đang chờ **Trưởng phòng Kế toán** duyệt (từ 8/11, hạn 9/11). [Nhắc]". | Cao |
| 27 | Trang soát hợp đồng sau AI đọc | Nhiều thành phần kỹ thuật: `v2i` có "Giai đoạn", `v2j2` "đã dùng {{n}} token", "Token tối đa/tháng" | Token, giai đoạn lộ ở màn của sale/giám đốc. | Ẩn "token" khỏi người dùng thường (chỉ quản trị); "Giai đoạn" → "Bước". | TB |
| 28 | Cài đặt quy trình trong ứng dụng | `rep3.lead`: "Quy trình do quản trị nền tảng gán cho công ty. Bạn chỉ sửa được luật chọn quy trình…"; `slotTitle`: "Quy trình đang áp dụng"; "Quy trình của luật này không chạy được: hãy chọn quy trình khác hoặc xoá luật" | Hai nơi cấu hình (admin web "Công ty › Quy trình" và ứng dụng Hợp đồng "luật chọn quy trình"); ai là người sửa? Sai ý Luật GỐC 2. | Một nơi: Công ty › Quy trình trong admin web, ứng dụng chỉ đọc, có nút "Mở trang Quy trình". Khi hỏng: "Hợp đồng của phòng Kinh doanh không có quy trình duyệt — Chọn quy trình tại …". | Cao |
| 29 | Thông báo chuông / "Chờ tôi duyệt" | NOTIFY_NO_RECIPIENT "Không có người nhận" (chỉ cảnh báo); "Bước vẫn xong và ghi cảnh báo" | Nếu không ai nhận thông báo duyệt, hợp đồng kẹt trong im lặng. | Khi không có người nhận: chặn lưu ("Chọn ít nhất một người nhận") hoặc báo người phụ trách hợp đồng. | Cao |
| 30 | Chờ tôi duyệt (cần chụp) | Danh sách + nút Duyệt/Từ chối/Trả lại; có `flow.approve.reject`: "Từ chối đi tới"/"Trả lại đi tới" | "Từ chối đi tới" là cấu hình, không nên xuất hiện ở người duyệt. | Người duyệt chỉ thấy 3 nút: Duyệt · Trả lại sửa · Từ chối (bắt buộc ghi lý do). | TB |

## D. Màn "Lượt chạy" (admin) — vận hành

| # | Màn hình | Thấy gì | Vì sao khó hiểu | Đề xuất sửa | Mức |
|---|---|---|---|---|---|
| 31 | Tiêu đề, tab | "Lượt chạy · {{name}}", tab "Tiến độ / Token / Nhật ký", "Gỡ lỗi", "Mã lỗi cuối", "Số lần hỏi tri thức", "Việc nền" | Lộ kỹ thuật cho cả giám đốc. | Tên "Tiến trình duyệt hợp đồng {{mã HĐ}}". Tab "Gỡ lỗi" chỉ cho quản trị nền tảng. | TB |
| 32 | Nút điều khiển | "Dừng lượt chạy", "Chạy lại cả lượt", "Chạy lại từ Nếu", "Mở lại quy trình" | Bốn nút gần nghĩa, "Chạy lại từ Nếu" là kỹ thuật. | Giám đốc chỉ thấy "Dừng" và "Mở lại để sửa hợp đồng"; còn lại trong "Thao tác khác". | TB |
| 33 | Lỗi lượt chạy | "Lượt này thuộc quy trình duyệt của một gói… Hãy dùng 'Mở lại quy trình' trên màn hình của gói." | "gói" là khái niệm nội bộ. | "Hợp đồng này đã kết thúc. Muốn duyệt lại, mở hợp đồng và bấm 'Mở lại quy trình'." | TB |

## Ghi chú chung

- Điều kiện để các dòng "(cần chụp)" và căn lề/độ nhiều chữ được xác nhận: cần mật khẩu demo để đăng nhập; đề nghị người điều phối cấp (hoặc chạy lại soát có thông tin đăng nhập).
- Số lượng: Chặn 2 (9, 13), Cao 20, TB 11 (tổng 33 dòng).
