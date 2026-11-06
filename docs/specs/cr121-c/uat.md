# CR-121 C · UAT lượt 1 (2026-11-06, gd0 3d0529254)

Ảnh: scratchpad `uat-cr121c\` (35 ảnh thật + 9 artboard). 9 nhóm màn, cả platform_admin và tenant_admin.
Giới hạn: seed mỏng (công ty chưa bật app, 0 workflow, 0 lệnh, 0 lượt chạy) ⇒ chưa chụp được: bảng luật, dải "Cần xử lý" có dữ liệu, ngăn Gán, ngăn workflow, bản riêng công ty, trang lượt chạy. Artboard mở file:// thiếu `support.js` ⇒ chỉ so cấu trúc + nhãn, chưa so màu/khoảng cách. Cần UAT lượt 2 với seed đầy đủ.

## Lỗi sản phẩm → giao sửa
| Mã | Lỗi | Lát |
|---|---|---|
| L2 | Thư viện 1440px cắt cột hành động ("Sửa · Nhân bản" chạm mép) | F9 |
| L5 | Nhãn chế độ xem "Canvas/Danh sách" ở `/processes/new` vs "Sơ đồ/Danh sách" chỗ khác | F9 |
| — | Tab "Mẫu · chạy thử" còn bảng kiểu cũ song song Thư viện mới (Luật GỐC 1–2) | F9 |
| L3 | Agent hiện "Agent …16c662" (mảnh id) trên Công cụ AI | F10 |
| — | tenant_admin vào được `/ai-tools` bằng URL (API platform-only) | F10 |
| — | Lưu mức app ở tab Ứng dụng xong, tab Quy trình không cập nhật tới khi tải lại | F8 |
| L1 | Hub chỉ cho CORS :3000; admin-web cổng khác ⇒ "Network error" không nói nguyên nhân | ghi deploy (`HUB_CORS_ORIGINS`) |

## Khác artboard — chấp nhận (đã quyết / hợp lý)
Sidebar 6 mục phẳng; logo + khối người dùng chân sidebar; tooltip `title`; bảng Ứng dụng thêm cột Chi tiết, Thành viên là số; 4 ô số ở tab Ứng dụng; Công ty › Quy trình 4 cột + chip tên bước; ngăn việc thêm "Chỉ gồm quy trình cùng loại"; Thư viện cấu trúc khớp; tenant_admin `/processes` → Công ty › Quy trình (c13); breadcrumb Công cụ AI một cấp và tenant_admin không có mục Quy trình (quyết ở review cuối đợt R2); Hệ thống 9 thẻ (artboard không vẽ).

## Người dùng đã quyết (2026-11-06)
1. Sidebar: nhớ lựa chọn mở/thu gọn của người dùng, mọi trang như nhau → F11.
2. Sáng/tối: đã có trong menu tài khoản (icon góc phải, `AccountMenu` → `PrefsPanel` Sáng/Tối/Theo máy, CR-120 "nút sáng/tối icon") — KHÔNG thêm nút ở thanh trên; mục UAT "thiếu nút sáng/tối" là sai.
3. "Gói + Đổi gói" và loại "Hook": bỏ khỏi CR-121 (hàng chờ).
4. Công ty › Ứng dụng: người dùng chê "chữ Tắt bị lệch, nhiều chữ quá, design đơn giản" → F11 (LevelControl thẳng hàng, bỏ mô tả dài/trạng thái lặp/"Chi tiết", gộp thông tin trùng đầu trang, sửa số "0 vs 1/5 ứng dụng đang bật", thanh lưu chỉ hiện khi có thay đổi).
5. Badge số sidebar (số đếm nhỏ cạnh mục, vd "Công ty 3"): người dùng "Không cần" ⇒ bỏ; gỡ prop/badge chưa nối dữ liệu nếu còn trong code (F11).

## UAT lượt 2 — kết quả (gd0 179a3adfb, ảnh `uat-cr121c\r2\`)
Đã đạt: tab Ứng dụng gọn + thẳng hàng; Thư viện menu ⋯ hết cắt cột (L2); tên agent thật (L3); trang chỉ xem bản thư viện cho tenant_admin + "Mở bản riêng"; bản riêng có Huỷ·Lưu, không Xuất bản.
Chặn → F14: L6 platform_admin mở bản riêng công ty "Không tìm thấy"; L7 platform_admin mở trang lượt chạy của công ty "Không tìm thấy".
Nên sửa → F14: chip bước Thư viện bị cắt giữa chữ; "Dùng bởi" lặp câu dài; nút Sơ đồ/Danh sách ở bản riêng chỉ icon. → F15: ngăn việc tiêu đề "Luật định tuyến" xuống 3 dòng, "Còn lại (mặc định)" xuống dòng, nút "Xong" sát mép ở 900px.
Chưa kiểm được (stack không có Dify/agent-runtime): ngăn workflow, lượt chạy "cần quyết định". L8 (tenant_admin không có mục Quy trình/Công cụ AI) là quyết định review R2 — không phải lỗi.
Bảo mật: script UAT lượt 2 in thân POST /auth/login ⇒ lộ SEED_ADMIN_PASSWORD (local) trong output agent; không ghi file/commit. Khuyên đổi nếu dùng lại nơi khác.

## UAT lượt 2 (kế hoạch, sau F8–F10)
Seed: công ty bật Sổ Hợp Tác, có luật + bản riêng, 1 workflow, 2 lượt chạy (done + needs_decision). Chụp lại 03c ngăn Gán + bảng luật, 06c ngăn workflow, 07 bản riêng, 08 trang lượt chạy, dải "Cần xử lý".
