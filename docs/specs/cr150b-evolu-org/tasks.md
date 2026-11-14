# cr150b-evolu-org — CR-150 · sơ đồ tổ chức Evolu cho bản test (stg-test)

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: dữ liệu seed UAT; chỉ đổi script seed bản test + tài liệu UAT, sản phẩm không đổi).

## Plan
Người dùng giao sơ đồ: Ban Giám đốc (gốc) Thomas Tran «Giám đốc»; 4 phòng dưới (Kinh doanh: Julian Bui; Kỹ thuật: Vio Ngo; Chăm sóc khách hàng: Rowan Hoang; R&D: Edgar Nguyen), mỗi người là trưởng phòng, quản lý trực tiếp = Thomas. Seed CHỈ THÊM/idempotent trên evolu; giữ 4 tài khoản `uat-nhan-*`.

## Làm
| Việc | File | Trạng thái |
|---|---|---|
| Luật thuần `planOrg` (người, phòng, trưởng phòng, quản lý, chức vụ; chỉ đặt cái còn trống) + test | `tools/scripts/src/seed-demo-partner.org.ts`, `.org.test.ts` (7 test) | xong |
| I/O áp kế hoạch qua API admin (`/admin/org/*`, `/admin/groups`, `/admin/users`) | `tools/scripts/src/seed-demo-partner.org.io.ts` | xong (chưa chạy trên staging) |
| Quy trình «Nhận HĐ từ đối tác (UAT)»: phụ trách = `julian.bui`; duyệt = trưởng phòng Kinh doanh (nhóm `pb-kinh-doanh`, chỉ trưởng phòng); ký = nhóm `uat-nhan-ky` có thêm `thomas.tran`; ghi đè theo tên khi chạy lại | `seed-demo-partner.data.ts`, `seed-demo-partner.ts` | xong |
| Cột tài khoản phía evolu | `docs/uat/hop-dong-2-cong-ty.md` | xong |

## Không làm
Chạy seed trên staging; xoá/sửa người, phòng, quy trình có sẵn; sửa tính năng.

## Quyết định trong lúc làm
- Làm qua API admin (không `onboardTenant`) vì onboard có thể đổi phòng có sẵn; phòng đã là phòng ban / người đã có quản lý hoặc chức vụ ⇒ giữ nguyên.
- Quy trình Nhận HĐ của evolu nay GHI ĐÈ theo tên (trước: không ghi đè) để cập nhật người/nhóm; quy trình tên khác không đụng.
- Email `<tên đăng nhập>@evolu.test`; mật khẩu người MỚI từ `UAT_EVOLU_PW` (file UAT_EVOLU.pw). Thomas = Toàn quyền, 4 trưởng phòng = Nhân viên (sửa).
- Một bước duyệt ⇒ Trưởng phòng Kinh doanh (theo yêu cầu).
- `slice:new` báo lỗi pre-commit (`git hook` cần git ≥ 2.36, máy có 2.34); worktree vẫn tạo đủ.

## Việc còn lại
Điều phối chạy: chép lên `seed-src/` các file `seed-demo-partner.ts`, `seed-demo-partner.data.ts`, `seed-demo-partner.org.ts`, `seed-demo-partner.org.io.ts`, rồi `bash seed-demo.sh --partner-only`.
