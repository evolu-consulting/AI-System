---
id: cr121-c1-shell
lát: cr121-c1-shell
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Áp khung "Hướng A" cho admin-web: token sáng/tối theo mẫu Tpl-List, chọn giao diện chỉ trong menu avatar, IconButton dùng chung, sidebar theo token.

## Làm
- `styles/globals.css`: token sáng (mặc định) + khối `.dark` đủ token, kể cả `--sidebar*` (lỗi cũ: sidebar không đổi màu khi tối).
- `components/shared/IconButton.tsx`: nút icon không viền, nhãn qua tooltip khi hover/focus, bắt buộc aria-label. Áp cho nút mở menu (di động), thu gọn sidebar, tài khoản.
- Sidebar: mục cao 32px, icon 16px, mục đang chọn nền `sidebar-accent` (s3).
- Unit `shell/lib/theme-tokens.test.ts`; e2e `e2e/cr121-shell.spec.ts` (viết, chưa chạy).

## Không làm / Chạm
Trang con, ngăn trượt dùng chung, route, API. Không sửa web-kit (PrefsPanel đã là nhóm 3 nút icon duy nhất trong menu avatar; admin-web không còn công tắc giao diện nào khác).

## Test tối thiểu
`bun test apps/admin-web/src/features/shell` · typecheck admin-web · check:bundle.

## Quyết định trong lúc làm
- Chưa có nút tìm kiếm ⌘K và chuông/góp ý là component web-kit (ngoài phạm vi) ⇒ IconButton áp cho nút shell của admin-web; chuông/góp ý chuyển sang IconButton khi lát web-kit.
- Cấu trúc nav giữ nguyên (không đổi route), nên không đổi nav.test.ts.
- **Superseded (2026-11-06):** "Cấu trúc nav giữ nguyên" không còn đúng — nav đổi thành 6 mục phẳng theo `docs/specs/cr121-c/spec.md` R1 (lát c10), có đổi `nav.test.ts`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/khung-giao-dien.md
#### Yêu cầu: Giao diện sáng/tối chọn ở menu tài khoản
Mặc định Sáng. Người dùng chọn Sáng, Tối hoặc Theo máy bằng nhóm 3 nút icon trong menu avatar ở góc phải thanh trên; không có công tắc giao diện nơi khác. Sidebar và vùng nội dung đổi màu theo giao diện.
- Kịch bản: khi chọn Tối ở menu avatar thì trang và sidebar đổi sang màu tối, chọn Sáng thì trả lại [test: e2e/cr121-shell.spec.ts » CR-121 · chọn Tối ở menu avatar thì trang và sidebar đổi màu]
- Kịch bản: khi khối tối thiếu token sidebar thì test chặn [test: apps/admin-web/src/features/shell/lib/theme-tokens.test.ts » khối .dark định nghĩa lại mọi token sidebar có ở :root]
#### Yêu cầu: Nút icon có nhãn khi hover
Nút chỉ có icon không viền, hiện nhãn khi rê chuột hoặc focus bàn phím và có aria-label.
- Kịch bản: khi rê chuột vào nút tài khoản thì hiện nhãn [test: e2e/cr121-shell.spec.ts » CR-121 · nút icon có nhãn khi rê chuột và chỉ một nhóm chọn giao diện]

## Việc còn lại
Chạy e2e cr121-shell một lần cuối đợt; chuông/góp ý (web-kit) dùng IconButton; nút tìm ⌘K khi có palette.
