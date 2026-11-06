# CR-107 · Kế hoạch test (mô tả, chưa viết test)

Thuộc `index.md`. Luật 0b: unit logic thuần + một int đường chính mỗi endpoint mới + một test chặn đọc chéo tenant mỗi bảng mới; e2e viết cuối đợt. Loại: U=unit, I=int, E=e2e, M=rà thủ công.

| Phần | AC | Loại | Mô tả ngắn |
|---|---|---|---|
| P0 | AC01 | U | depcruise/quy ước: hub không import `app_roles` |
| P0 | AC02 | I | HT-75/76 hiện có xanh |
| P0 | AC03 | M | rà diff không đụng module đóng băng |
| P1 | AC01-02,05 | E | sidebar tên công ty; click mở workspace; tenant_admin không thấy "Thêm công ty" |
| P1 | AC03-04 | E+I | wizard bước 1–2; thoát giữa chừng không để tenant nửa vời |
| P2 | AC01-03 | E | 5 tab; **redirect route cũ → tab; sửa e2e nav hiện có** |
| P3 | AC01,06 | E | không có "tạo vai" cho chat/studio/admin/external |
| P3 | AC02-05 | E | 3 vai mặc định; tạo vai; 409; Group read-only |
| P3 | AC07 | E | **dock contracts ở chat mở theo quyền đọc contracts** sau đổi vai |
| P4 | AC01 | U | hàm biên dịch thuần: **Quản trị ⇒ 3 grant**, Đọc+Ghi ⇒ 2, Đọc ⇒ 1 |
| P4 | AC02 | I | **đúng 1 NOTIFY** mỗi lần lưu |
| P4 | AC03,07 | I | không grant user lẻ; idempotent |
| P4 | AC04 | I | **chặn đọc chéo tenant cho `app_roles`** |
| P4 | AC05-06 | I | từ chối vai chat/external; 409 slug trùng, xoá còn user |
| P5 | AC01-04 | I | dry-run không ghi; thiếu xác nhận bị từ chối; audit mỗi grant; chạy lại không đổi |
