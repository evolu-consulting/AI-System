# P3 · Phân quyền (UI RBAC) — Làn đầy đủ

FR: **ADM-FR-80** (vai theo app + vai tuỳ biến), **ADM-FR-81** (gán user vào vai). BA: D4 ②③, Q1–Q10, R4. ADR-0033 §3, §5, §6. Mock: màn 4. Contract/endpoint: **P4**.

## Nghiệp vụ
| Mục | Loại | Nội dung |
|---|---|---|
| Danh sách theo app | Mới | chỉ app là business pack (contracts/community/knowledge); mỗi app 3 vai mặc định + vai tuỳ biến |
| Mức quyền | Mới | 3 mức cố định Đọc / Đọc+Ghi / Quản trị (Q7) |
| Tạo/sửa/xoá vai tuỳ biến | Mới | slug `^[a-z0-9-]{2,32}$`; 409 khi trùng; xoá còn user ⇒ chặn 409, phải chuyển user trước (Q4) |
| Gán user | Mới | một user giữ vai ở nhiều app; quyền thực tế theo app |
| Group do vai quản lý | Đổi | read-only ở `/groups` (Q5); Group thủ công giữ nguyên |
| Ngoại lệ | — | KHÔNG hiện "tạo vai" cho chat/studio/admin (R4) và cho app đối tác với subject external (Q9); vai hệ thống không nằm ở màn này (D4 ①) |

## Quyền
tenant_admin thao tác trong tenant mình; platform_admin xem/sửa mọi tenant.

## AC
| AC | Nội dung |
|---|---|
| P3-AC01 | Chỉ 3 pack hiện trong danh sách vai; chat/studio/admin không có nút tạo vai |
| P3-AC02 | Mỗi pack đã bật hiện đúng 3 vai mặc định |
| P3-AC03 | Tạo vai tuỳ biến mức Quản trị ⇒ user trong vai truy cập được chức năng admin của pack |
| P3-AC04 | Slug trùng ⇒ lỗi 409 hiển thị; xoá vai còn user ⇒ bị chặn |
| P3-AC05 | Group của vai không sửa được ở `/groups` |
| P3-AC06 | Community + subject external: không có "tạo vai" |
| P3-AC07 | Dock contracts ở chat vẫn mở theo quyền đọc contracts sau khi đổi vai |
