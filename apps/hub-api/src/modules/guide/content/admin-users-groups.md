---
id: admin-users-groups
title: Quản trị — Users, Groups và Phân quyền
title_en: Admin — users, groups and permissions
audience: admin
pack: none
keywords: quản trị admin user người dùng group nhóm phòng ban phân quyền feature gói app cấp quyền mật khẩu khoá
---

## Mở trang Quản trị
Trong Chat AI bấm **Ứng dụng** > **Quản trị** (Evolu Control). Menu bên trái gồm **Tổng quan**, **Agents**, và các nhóm **TRUY CẬP** (**Users**, **Groups**, **Phân quyền**), **CHỨC NĂNG** (**Features**, **Commands**), **HỆ THỐNG** (**Chi phí & quota**, **Nhật ký**...). Quản trị công ty (tenant_admin) chỉ thấy dữ liệu công ty mình.

EN: Open Ứng dụng > Quản trị. Main menus: Users, Groups, Phân quyền, Features, Agents, Chi phí & quota.

## Tạo người dùng mới (Users)
Không có trang tự đăng ký, tài khoản tạo ở đây.
1. Vào **Users**, bấm **+ Tạo user**.
2. Điền **Tên đăng nhập** (chữ thường không dấu, số, . _ -), **Tên hiển thị**, **Email**, **Ngôn ngữ**, **Role**.
3. Bấm **Tạo user**. Mật khẩu tạm được sinh tự động và chỉ hiện một lần: sao chép và gửi cho người đó cùng **Mã công ty**. Họ phải đổi mật khẩu ở lần đăng nhập đầu.
Tenant admin cần có email để nhận cảnh báo quota.

EN: Users > "+ Tạo user"; copy the one-time temporary password.

## Khoá, reset mật khẩu, đăng xuất, tắt 2FA
Ở dòng người dùng trong **Users**, mở menu thao tác: **Sửa**, **Reset mật khẩu**, **Khoá** / **Mở khoá**, **Đăng xuất mọi thiết bị**, **Tắt 2FA**. Khoá có hiệu lực trong tối đa 15 phút. Tìm người ở ô "Tìm theo tên đăng nhập, tên, email…"; lọc **Chưa đăng nhập** để thấy người mới chưa vào.

EN: Row menu in Users: reset password, lock/unlock, sign out everywhere, disable 2FA.

## Tạo nhóm / phòng ban (Groups)
Group là nhóm người dùng để cấp quyền cho cả phòng ban thay vì từng người.
1. Vào **Groups**, bấm **+ Tạo group** (hoặc "+ Tạo group đầu tiên").
2. Nhập **Key** (chữ thường không dấu, số, dấu -; không đổi được sau khi tạo), **Tên**, **Mô tả**, bấm **Tạo group**.
3. Tab **Thành viên**: bấm **Thêm người** hoặc dán nhiều username (mỗi dòng một người, tối đa 500) để thêm cùng lúc.
4. Tab **Feature** xem các feature đã cấp cho group; tab **Agent** cấp agent cho group.
Group **beta-testers** có sẵn, không xoá được.

EN: Groups > "+ Tạo group"; add members in the "Thành viên" tab.

## Cấp quyền dùng tính năng và ứng dụng (Phân quyền)
Ứng dụng như Sổ Hợp Tác và các tính năng được cấp theo **Feature** (gói chức năng) cho từng group. Chỉ cấp được feature mà nền tảng đã mở cho công ty.
1. Vào **Phân quyền**, tab **Ma trận** ("Ma trận feature × group").
2. Tick ô giao giữa feature và group cần cấp (có thể cấp một feature cho mọi group, hoặc mọi feature cho một group).
3. Bấm lưu; thành viên thấy thay đổi trong vài giây.
Feature chưa được mở hiện nhãn "Chưa mở": liên hệ đơn vị vận hành nền tảng. Feature **core** mọi người đều có.

EN: Phân quyền > Ma trận: tick feature x group, then save.

## Kiểm tra vì sao một người không thấy lệnh hoặc ứng dụng
Vào **Phân quyền**, tab **Kiểm tra quyền**, nhập username. Trang liệt kê **Feature**, **Command**, **Agent** người đó dùng được và lý do không thấy (ví dụ "chưa cấp cho người này hay group nào", "Feature đang tắt", "tài khoản bị khoá"). Có nút cấp nhanh cho một group.

EN: Phân quyền > Kiểm tra quyền shows what a user can use and why not.

## Cấp quyền dùng Sổ Hợp Tác cho phòng ban
1. Nền tảng phải mở gói Hợp đồng cho công ty (tab **Gói** / feature của tenant: do quản trị nền tảng làm). Chưa mở thì Sổ Hợp Tác báo "Gói Hợp đồng chưa được bật cho công ty bạn".
2. Trong **Phân quyền** > **Ma trận**, cấp các feature của gói Hợp đồng cho group phòng ban (đọc để xem, ghi để sửa).
3. Trong chính Sổ Hợp Tác, chọn phạm vi xem hợp đồng và phòng ban ở **Cài đặt** > **Thành viên & điểm đối tác** (xem hướng dẫn Sổ Hợp Tác).
Người chưa được cấp thấy "Bạn chưa có quyền dùng gói Hợp đồng".

EN: Platform enables the contracts pack for the tenant; admin grants its features to groups in Phân quyền.
