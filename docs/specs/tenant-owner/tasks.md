# tenant-owner — chủ đầu tiên của tenant, không email (Luật 0b; làn: đầy đủ-gọn vì chạm auth/DB)

## Quyết định
- Người dùng chọn phương án 1: migration admin **0020** (`when` 1793850400000 > 0019 feedback 1793750400000) bỏ CHECK `users_tenant_admin_email_check`. API giữ `isEmailRequired` (tạo/sửa tenant_admin qua API vẫn bắt email); chỉ script tạo tenant_admin không email.
- Script `tools/scripts/src/tenant-owner-setup.ts` đi đường tạo user của nền tảng: `createFirstAdmin` (nhận `email: null`) + `hashPassword` + `configWrite` scope platform, role `admin_api` (RLS bật), audit + `config_changed` như API. Người ghi audit = platform_admin active cũ nhất.
- Mật khẩu 24 ký tự = `generateTempPassword(randomBytes, 24)` (thêm tham số `len`, mặc định 16). Ghi file `--out` (mặc định `/claude-home/TENANT_OWNER_<t>.txt` — volume giữ lại sau `run --rm`), mode 600, ghi trước commit, commit hỏng ⇒ xoá file. Không in mật khẩu.
- Group = Group của tenant giữ `contracts-admin` (ưu tiên `contracts-owner`); thiếu ⇒ từ chối. Trưởng phòng = phòng ban tên "Phòng Giám đốc" (không phân biệt hoa/thường, gốc trước); không có ⇒ không đặt; có trưởng cũ ⇒ thay (dry-run in tên người cũ).
- User đã có ⇒ "exists, nothing to do" (cả khi đua: 23505 ⇒ exists). Từ chối tenant `platform`, `demo`. Không gửi mail/thông báo: cổng `notifier` không bao giờ được gọi (int có spy).
- Test khoá sửa (qc): `tests/acceptance/M1/db-schema.int.test.ts` — tenant_admin không email nay hợp lệ ở DB; relock 2 dòng.

## Test
unit `tools/scripts/src/tenant-owner-setup.test.ts`; int `tests/acceptance/tenant-owner/setup.int.test.ts` (+ M1 db-schema) trên evotest.

## Việc còn lại
- Server: deploy (migration 0020 tự chạy), rồi dry-run → `--apply` (lệnh trong đầu file script). Lấy file `/claude-home/TENANT_OWNER_nitigroup.txt`, giao mật khẩu, xoá file.
- `test:lock:verify` trên gd0 đang lệch sẵn 7 file e2e (x1/studio, deployed) — không thuộc lát này.
