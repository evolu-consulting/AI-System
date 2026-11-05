---
id: cr120-handson-fixes
lát: cr120-handson-fixes
cr: CR-120
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa 6 lỗi coordinator đi tay: (1) `/contracts/login?sso=none` bị legacy-routes đổi thành `/contracts/c/login` ⇒ thêm login/sso/privacy/terms vào CONTRACTS_PAGES + 400 ⇒ câu dịch; (2) `.stickytop top:60px` ⇒ `top:0`; (3) menu tài khoản 3 mục 3 icon + tên theo nơi mở; (4) đăng ký SlotSpec `contracts.intake`; (5) GET routing trả `active` (khe opt-in tắt) + UI "Đang tắt"; (6) bỏ mã khe khỏi dòng Quy trình.

## Làm / Không làm
Không đụng DLC. Perf: GET routing vẫn 3 câu SQL như cũ (`active` tính từ kết quả đã có, không thêm câu).

## Test tối thiểu
unit: routing-active.rules, routing-current, flows-view, load-error, legacy-routes. int: routing.routes (mọi khe manifest GET 200 + active). e2e: cw-cr113.pm (1b, 1c), feed.cm (sticky), admin-processes.pa (4/6).

## Quyết định trong lúc làm
- `active` chỉ khác `true` với khe `optIn` chưa có luật và chưa có quy trình trong tập gán (cùng nguồn `moderationOn`).
- Mục menu "Thành viên & điểm đối tác" giữ tên, đổi icon Users; admin-web không có các mục này (PrefsPanel chỉ giao diện/ngôn ngữ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Trạng thái khe opt-in và khe tiếp nhận hợp đồng trong định tuyến
`GET /tenants/:tid/process-routing/:slot` trả thêm `active`: khe opt-in chưa có luật/quy trình gán ⇒ `false` (UI hiện "Đang tắt", không hiện mặc định là "Đang dùng"); khe `contracts.intake` được đăng ký nên GET trả 200 cho mọi khe manifest khai báo.
- Kịch bản: khi GET routing của mọi khe manifest khai báo thì 200, khe Community chưa bật có active=false [test: apps/hub-api/src/modules/processes/library/routing.routes.int.test.ts » cr120-handson-fixes · GET routing của MỌI khe manifest khai báo]
- Kịch bản: khi khe opt-in không luật không gán thì không active [test: apps/hub-api/src/modules/processes/library/routing-active.rules.test.ts » opt-in chưa luật chưa gán ⇒ tắt]

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Menu tài khoản và đăng nhập quay về
Menu tài khoản đặt tên theo nơi mở (Cài đặt Sổ Hợp Tác / Cài đặt Community / Thành viên & điểm đối tác), mỗi mục một icon; đăng nhập từ trang quay về SSO về `/contracts`; mã hợp đồng sai hiện câu dịch "Không tìm thấy hợp đồng".
- Kịch bản: khi đăng nhập từ trang quay về SSO thì về /contracts [test: e2e/pm-checklist/cw-cr113.pm.ts » cr120-handson-fixes · 1b · đăng nhập từ trang quay về của SSO]
- Kịch bản: khi route gốc của app nằm dưới /contracts thì không bị đổi thành id hợp đồng [test: apps/workspace-web/src/shared/kernel/legacy-routes.test.ts » route gốc của app không bị coi là id HĐ cũ]
- Kịch bản: khi mã hợp đồng sai thì hiện câu đã dịch [test: apps/workspace-web/src/features/contract-review/lib/load-error.test.ts » 400/422]

### MODIFIED community/hien-thi.md
#### Yêu cầu: Thanh tab bảng tin không che bài đầu
Thanh tab sticky dính sát mép vùng cuộn, không đè thẻ bài đầu và không để khoảng trống lớn trên composer.
- Kịch bản: khi mở bảng tin thì dòng tác giả của bài đầu không bị che [test: e2e/community-web/feed.cm.ts » cr120-handson-fixes · thanh tab sticky không che dòng tác giả của bài đầu]
