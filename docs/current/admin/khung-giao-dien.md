# Admin · Khung giao diện admin-web

Cập nhật: 2026-11-09 · Gộp từ: cr121-c1-shell (đợt cr125-wave).

## Yêu cầu: Giao diện sáng/tối chọn ở menu tài khoản (nguồn: cr121-c1-shell)
Mặc định Sáng. Người dùng chọn Sáng, Tối hoặc Theo máy bằng nhóm 3 nút icon trong menu avatar ở góc phải thanh trên; không có công tắc giao diện nơi khác. Sidebar và vùng nội dung đổi màu theo giao diện.
- Kịch bản: khi chọn Tối ở menu avatar thì trang và sidebar đổi sang màu tối, chọn Sáng thì trả lại [test: e2e/cr121-shell.spec.ts » CR-121 · chọn Tối ở menu avatar thì trang và sidebar đổi màu]
- Kịch bản: khi khối tối thiếu token sidebar thì test chặn [test: apps/admin-web/src/features/shell/lib/theme-tokens.test.ts » khối .dark định nghĩa lại mọi token sidebar có ở :root]
## Yêu cầu: Nút icon có nhãn khi hover (nguồn: cr121-c1-shell)
Nút chỉ có icon không viền, hiện nhãn khi rê chuột hoặc focus bàn phím và có aria-label.
- Kịch bản: khi rê chuột vào nút tài khoản thì hiện nhãn [test: e2e/cr121-shell.spec.ts » CR-121 · nút icon có nhãn khi rê chuột và chỉ một nhóm chọn giao diện]
