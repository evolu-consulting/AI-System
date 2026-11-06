# P1 · Điều hướng lồng + Wizard onboard (Làn nhanh)

FR: **ADM-FR-77** (nav), **ADM-FR-78** (wizard). BA: D1, D3. Mock: màn 1 (Khái niệm & nav), màn 2 (Wizard).

## Nghiệp vụ
| Mục | Loại | Nội dung | Nguồn |
|---|---|---|---|
| Sidebar | Đổi | chỉ liệt kê tên công ty + "Thêm công ty"; catalog nền tảng (app/feature/command/workflow) giữ ở mục nền tảng cho platform_admin | `shell/lib/nav.ts:118-147` |
| Chọn công ty | Mới | click → workspace (P2) bên phải | — |
| Wizard | Mới | Bước 1 Thông tin công ty (kèm tenant_admin đầu — `createFirstAdmin`, ADM-FR-60) → 2 Gán ứng dụng (`enablePack`) → 3 Vai/quyền → 4 Người dùng | `users.service.ts:69-83`; `packs.service.ts:72-92` |
| Bước 3/4 | Mới | bỏ qua được (Q8); sửa về sau ở tab | BA Q8 |
| Component | Mới | chưa có Stepper — tạo trong admin-web | — |

Bước 3 dùng UI/endpoint của P3/P4; nếu P4 chưa xong thì bước 3 ẩn (cờ), wizard vẫn chạy bước 1–2–4.

## Quyền
platform_admin tạo công ty; tenant_admin không thấy "Thêm công ty".

## AC
| AC | Nội dung |
|---|---|
| P1-AC01 | Sidebar chỉ có tên công ty + "Thêm công ty" (+ mục nền tảng cho platform_admin) |
| P1-AC02 | Click công ty mở workspace, URL phản ánh công ty |
| P1-AC03 | Wizard Bước 1 tạo tenant + tenant_admin đầu; thoát giữa chừng không để tenant nửa vời |
| P1-AC04 | Bước 3, 4 bỏ qua được; bước 2 gọi `enablePack` |
| P1-AC05 | tenant_admin không thấy "Thêm công ty" |

Nhãn VI/EN: lấy từ khoá i18n admin-web hiện có; nhãn mới đề xuất khi code, chờ duyệt (không bịa trong spec).
