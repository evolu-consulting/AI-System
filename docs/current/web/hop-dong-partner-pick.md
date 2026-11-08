# hop dong partner pick

Cập nhật: 2026-11-08 · Nguồn: cr122-p10-partner-pick. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Ô đối tác chọn từ sổ, MST/CCCD lấy từ sổ và chỉ đọc (nguồn: cr122-p10-partner-pick)
Loại HĐ Mua/Bán/Giới thiệu lấy vai NCC/Khách hàng/Bên trả hoa hồng; chọn đối tác ⇒ ô MST (hoặc CCCD nếu số 12 chữ số) tự điền và chỉ đọc;
gõ tên chưa có ⇒ "Đối tác mới · sẽ tạo khi lưu" và nhập tay được.
- Kịch bản: khi loại HĐ là Mua thì vai tìm là NCC, Bán là Khách hàng, Giới thiệu là bên trả hoa hồng [test: apps/workspace-web/src/features/contract-form/lib/partner-match.test.ts » vai theo loại HĐ và nhãn MST hay CCCD]

#### Yêu cầu: AI đọc ra đối tác thì gợi ý khớp với sổ (nguồn: cr122-p10-partner-pick)
Khớp MST trước rồi tên; khớp chắc chắn ⇒ chọn sẵn; mơ hồ ⇒ "Có phải <tên>?" cho người dùng chọn.
- Kịch bản: khi MST của AI khớp đúng một đối tác thì chọn sẵn dù tên khác [test: apps/workspace-web/src/features/contract-form/lib/partner-match.test.ts » khớp MST trước thì đúng một là chắc dù tên khác]
- Kịch bản: khi tên khớp nhưng MST hai bên khác nhau hoặc chỉ gần giống thì hỏi "Có phải …?" [test: apps/workspace-web/src/features/contract-form/lib/partner-match.test.ts » chỉ gần giống thì mơ hồ, không có gì thì none]
