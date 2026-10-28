# Admin · ghi chú người dùng ngoài (đối tác)

Cập nhật: 2026-10-28 · Gộp từ: com-c1-ext-identity, com-c2-ext-deny. Chưa phải mô tả đầy đủ Admin (chưa có `current/admin`).

- Công ty đối tác: bảng `admin.external_orgs`, route `/admin/external-orgs*`, menu admin-web "Đối tác"; vô hiệu công ty ghi audit từng user; `POST /admin/external-orgs/:id/reactivate` (nút "Mở lại").
- User ngoài: `admin.users.kind='external'` + `external_org_id`, `deactivated_at`; `/admin/users?kind=&external_org_id=`. Vai luôn `member`; không vào Group, không làm quản lý/trưởng phòng (422).
- Cổng admin-api cho đối tác: chỉ hồ sơ, đổi mật khẩu, đăng xuất, mã SSO, app/portal của mình. Danh sách bề mặt chặn: `current/community/nghiep-vu.md` §13.
- Migration admin 0028 (identity ngoài), 0029 (trigger).
- Tạo công ty + user đối tác ở ai-admin; nhãn NCC/mua và liên kết SHT đặt ở Community › Đối tác.

## Chưa rõ
1. Tự quản lý thành viên của công ty đối tác (GĐ2).
2. Chưa có `current/admin` đầy đủ (quota, Trello, features).