# cr159-onboard-users — CR-159 (yaml onboarding khai người dùng + add-on Bảng tin; 3 tenant evolu / nitigroup / preschool)

## Plan
CLI `tenant-onboard` thêm `users:` (email, tên, chức vụ, vai `admin|member`) và `addons:`. Người dùng tạo qua `users.service.createUser` (luôn `must_change_password`), chức vụ qua `org.service.setJobTitle`, add-on qua `features.entitlements.grantEntitlement`. Thứ tự: đọc người dùng (chỉ đọc, kiểm `--pw-out`) → tenant → người dùng → gói (quản trị mới thành Chủ gói) → add-on → phòng ban (trưởng/thành viên, không còn `pending`).

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Luật thuần `planUsers`, schema `users:`/`addons:` (trùng email/tên đăng nhập, chức vụ ≤ 80) | `domain/onboard.rules.ts`, `adapters/onboard.schema.ts` | [x] |
| 2 | Usecase + cổng người dùng/add-on; báo cáo `users`, `addons` (không có mật khẩu) | `application/onboard.usecase.ts`, `application/ports.ts`, `adapters/onboard.repo.ts`, `tenant-onboard.run.ts` | [x] |
| 3 | CLI `--pw-out` (600, `email<TAB>mật khẩu`, chỉ người mới) + `--dry-run` | `tenant-onboard.cli.ts` | [x] |
| 4 | yaml: `evolu`, `preschool` mới; `nitigroup` viết lại (5 phòng, bỏ import) | `deploy/tenants/*.yaml` | [x] |
| 5 | Test | `domain/onboard.rules.test.ts`, `tenant-onboard.int.test.ts` | [x] |

## Quyết định trong lúc làm
- Tên đăng nhập = phần trước `@` của email (phải hợp lệ `USERNAME_RE`, không trùng trong file); ngôn ngữ người dùng `vi`.
- Mật khẩu ghi vào file ngay khi sinh (append) để lỗi bước sau không làm mất; báo cáo chỉ có số đếm + email vừa tạo.
- Người đã có: chỉ cập nhật tên/vai/chức vụ khi khác; đổi vai chịu luật «quản trị cuối cùng» của users.service (LAST_ADMIN) — không né.
- Add-on chưa đăng ký ⇒ `VALIDATION_ERROR ADDON_UNKNOWN` (bước này sau bước người dùng; chạy lại an toàn).
- `nitigroup.yaml` bỏ `import`; test cũ đọc file này đã chỉnh theo (5 phòng). `tests/acceptance/NITI/onboard.int.test.ts` (đã khoá) còn kỳ vọng 23 phòng + import ⇒ QC cần cập nhật.

- Trước khi ghi DB, `precheck` (chỉ đọc) kiểm: phòng ban hợp lệ, mọi add-on đã đăng ký (`ADDON_UNKNOWN`), có `--pw-out` (`PW_OUT_REQUIRED`) và thư mục của nó ghi được (`PW_OUT_NOT_WRITABLE`, thử tạo rồi xoá một file).
- Người quản trị phải đứng ĐẦU `users:` (tạo trước). Mất mật khẩu tạm ⇒ đặt lại trên trang quản trị, không chạy lại CLI.

- Vòng 3: `--password-env <TÊN>` = MỘT mật khẩu chung cho user MỚI (đọc từ biến môi trường; rỗng/chưa đặt ⇒ `PASSWORD_ENV_EMPTY`; ngoài `PASSWORD_MIN_LEN..MAX` ⇒ `PASSWORD_LENGTH`, cả hai trước khi ghi DB); khi đó `--pw-out` không bắt buộc và nếu truyền thì chỉ ghi email. `--no-force-change` (mặc định tắt) ⇒ user mới `must_change_password=false`.
- Đường đi: `users.service.createUser` thêm tham số tuỳ chọn `opts {password, mustChange}` (repo `insertUser` nhận `mustChangePassword`, mặc định true) — API `POST /users` không truyền nên giữ M1-R17. Chọn cách này vì service không có đường đặt mật khẩu/cờ khác; đặt sau khi tạo sẽ qua `resetPassword` (luôn sinh ngẫu nhiên, ép đổi).

## Việc còn lại
- Tắt email theo tenant (evolu, preschool): KHÔNG có công tắc theo tenant (`HUB_NOTIFY_MODE` chung toàn hệ thống) ⇒ chưa khai `notify_email`; cần CR riêng. Tới khi có: giữ mail chung ở chế độ tắt hoặc chỉ bật sau khi xác nhận domain.
- Đổi mật khẩu lần đầu: ĐÃ có (`must_change_password=true` mọi user tạo qua users.service).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/cai-dat-va-quyen.md

#### Yêu cầu: yaml onboarding khai người dùng, chức vụ, vai quản trị và add-on Bảng tin
Mục `users:` (email, tên, chức vụ, vai `admin` hoặc `member`) tạo người dùng đúng đường của quản trị (bắt đổi mật khẩu lần đầu); mục `addons:` bật tính năng thêm như Bảng tin. Mật khẩu tạm chỉ ghi vào file do `--pw-out` chỉ định (quyền 600), không in ra.
- Kịch bản: khi yaml có `users:` và `addons:` thì tạo đủ người dùng kèm chức vụ, vai, bật Bảng tin, trưởng phòng và thành viên gán ngay không còn chờ [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.int.test.ts » tạo mới: user qua users.service (must_change_password), chức vụ, vai, add-on, trưởng và thành viên gán ngay (không pending), mật khẩu chỉ trong file]
- Kịch bản: khi chạy lại lần hai thì không đổi gì và không sinh mật khẩu mới [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.int.test.ts » chạy lại lần 2: không đổi gì (version, audit, config_version, mật khẩu), không sinh mật khẩu mới]
- Kịch bản: khi người đã có đổi tên, chức vụ hoặc vai thì chỉ cập nhật các trường đó và giữ mật khẩu [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.int.test.ts » đổi tên và chức vụ (boss) và vai (head.kd lên quản trị) ⇒ chỉ cập nhật các trường đó, giữ mật khẩu, không thêm dòng mật khẩu]
- Kịch bản: khi dùng một mật khẩu chung thì mọi người mới đăng nhập được bằng nó, vẫn bị ép đổi, chạy lại không đổi mật khẩu và mật khẩu không có trong báo cáo hay file [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.int.test.ts » mật khẩu chung: user mới đăng nhập được bằng nó, mặc định vẫn ép đổi, chạy lại không đổi mật khẩu, không ghi mật khẩu ra báo cáo hay file]
- Kịch bản: khi chạy CLI với `--password-env` và `--no-force-change` thì đầu ra không chứa mật khẩu, người mới không bị ép đổi và biến rỗng thì báo lỗi [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.int.test.ts » CLI --password-env --no-force-change: stdout và stderr không chứa mật khẩu, user mới must_change_password=false, đăng nhập được và biến rỗng báo lỗi]
- Kịch bản: khi mật khẩu chung sai độ dài thì báo lỗi trước khi ghi DB [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.int.test.ts » mật khẩu chung sai độ dài ⇒ lỗi trước khi ghi DB, thông báo không chứa mật khẩu]
- Kịch bản: khi có người mới mà thiếu `--pw-out` thì báo lỗi và không ghi gì vào DB [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.int.test.ts » có user mới mà không có nơi ghi mật khẩu ⇒ lỗi PW_OUT_REQUIRED, không ghi gì vào DB]
- Kịch bản: khi add-on chưa đăng ký thì báo lỗi rõ [test: apps/admin-api/src/modules/tenant-onboard/tenant-onboard.int.test.ts » add-on chưa đăng ký ⇒ lỗi rõ, không im lặng]
- Kịch bản: khi đọc yaml thì email trùng, tên đăng nhập trùng, thiếu chức vụ hay vai lạ đều bị từ chối [test: apps/admin-api/src/modules/tenant-onboard/domain/onboard.rules.test.ts » CR-159 · users: parse + validate]
- Kịch bản: ba file evolu, nitigroup, preschool hợp lệ và mọi trưởng phòng, thành viên đều có trong người dùng [test: apps/admin-api/src/modules/tenant-onboard/domain/onboard.rules.test.ts » ba file CR-159 evolu nitigroup preschool hợp lệ và mọi người trong phòng ban đều có trong users]
