---
id: fix-cr182-final
lát: fix-cr182-final
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa lỗi lượt soát cuối đợt CR-182 + CR-184 (#1 #2 #4 #6 #7 #8 #9; #3 thuộc lát khác).

## Làm
| # | Sửa | Test |
|---|---|---|
| 1 | `partner-sign-mail.ts`: prod (APP_ENV ≠ development/test) chỉ ghi `link_id`; resend trả `url` khi thư chưa gửi được; nút «Sao chép link» ở `PartnerLinkInfo` | `partner-sign-mail.test.ts`, `partner-sign-safety.int.test.ts`, `partner-link-view.test.ts` |
| 2 | `receive-flow.repo.ts`: giải vai (`withRoles` + giao việc + `on_doc` cùng câu SQL) ⇒ `isSigner`, danh sách uỷ quyền, `receive-signers` cùng một nguồn | `receive-flow.int.test.ts` |
| 4 | `lock_timeout` hub 0158, pack 0122, 0123; 0123: CHECK/FK trên bảng có sẵn `NOT VALID` + `VALIDATE` riêng | chạy migration trong `cloneDb("full")` |
| 6 | `role-unassigned-bell.ts`: `signer_role_label` trước tên bước; ưu tiên quy trình Bật của công ty | `roles-migrate.int.test.ts` |
| 7 | `partner-sign-save.ts`: `counts` (a_done) trước `render` | `partner-sign-safety.int.test.ts` |
| 8 | `quick-image.ts`: khoá sessionStorage = SHA-256(token) | `quick-image.test.ts` |
| 9 | `roles.repo.ts` `restoreProvider`; def không có `provider` ⇒ TECH-DEBT #298 | `roles-restore-provider.test.ts`, `roles.int.test.ts` |

## Không làm / Chạm
Không đụng `esign-node.usecase.ts` `checkNode`, `esign-node.validator` (#3). Không đổi `when` journal.

## Test tối thiểu
unit + int các file trên; tsc hub-api / workspace-web / contracts; biome; check:size.

## Quyết định trong lúc làm
- #1: bật log link chỉ khi `APP_ENV` là `development`/`test` (fail-closed: không rõ môi trường ⇒ không ghi). Mount truyền `appEnv` qua `partnerSignMailer.set(email, baseUrl, appEnv)`.
- #1: «Sao chép link» = gọi `POST …/partner-sign/resend` (tạo link mới, thu hồi cũ) vì DB chỉ giữ băm; `url` chỉ có khi `sent=false` và chỉ người tải lên/quản trị gọi được.
- #2: không import `processes` (cruiser cấm gói → module hub): lặp truy vấn giao việc trong câu `receiveFlowOf` (cùng khuôn `EVENT_FLOW_SQL`), giải vai bằng `withRoles` thuần.
- #4: hub 0158 KHÔNG dùng CONCURRENTLY (migrator bọc một tx, repo chưa có khuôn CONCURRENTLY: 0066/0098/0129); chỉ mục một phần `via='delegated'`; giữ `lock_timeout 5s`.
- #6: «def của lượt» không có trong tham số hook `notLaunched` (cổng kit) ⇒ ưu tiên def đang Bật trong `company_flows` của công ty, không đổi cổng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Link ký của đối tác không lộ ở log prod; người tải lên sao chép được link khi thư chưa gửi
Khi thông báo tắt (`HUB_NOTIFY_MODE=off`) ở bản chạy thật chỉ ghi mã link, không ghi link hay email; bản dev/test vẫn ghi link để kiểm. Thư mời chưa gửi được thì trang hợp đồng báo «Chưa gửi được thư mời — sao chép link để gửi đối tác» kèm nút «Sao chép link» cho người tải lên hoặc quản trị; nút tạo link mới (cũ không còn dùng được) và chép link gốc.
- Kịch bản: khi tắt thông báo ở prod thì log không có link, người tải lên lấy được link dùng được, người khác không lấy được [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign-safety.int.test.ts » soát #1 · tắt thông báo ở prod: log KHÔNG có link/token, chỉ link_id, «Sao chép link» (gửi lại) trả link gốc dùng được cho người tải lên]
- Kịch bản: khi bản chạy thật tắt thông báo thì không ghi link ra log [test: apps/hub-api/src/modules/packs/contracts/application/partner-sign-mail.test.ts » prod: chỉ ghi link_id, tuyệt không có token/link/email]
- Kịch bản: khi link còn chờ mà chưa gửi được thì hiện nút sao chép [test: apps/workspace-web/src/features/doc-sign/lib/partner-link-view.test.ts » sao chép link: chỉ khi link còn chờ mà thư chưa gửi được]

#### Yêu cầu: Bên A chưa ký đủ thì đối tác không Lưu được (không in PDF)
- Kịch bản: khi Bên A chưa ký đủ thì Lưu trả 409 ngay, không in, không ghi tệp [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign-safety.int.test.ts » soát #7 · Bên A chưa ký đủ ⇒ 409 NGAY, không in PDF, không ghi tệp]

#### Yêu cầu: Link ký không nằm trong bộ nhớ phiên trình duyệt
Ảnh chữ ký nhanh của đối tác nhớ theo băm SHA-256 của link, không theo link.
- Kịch bản: khi nhớ ảnh thì khoá là băm, không chứa token [test: apps/workspace-web/src/features/partner-sign/lib/quick-image.test.ts » SHA-256 hex, ổn định, không chứa token]

### ADDED sht/uy-quyen-ky-theo-vai.md
#### Yêu cầu: Người ký theo vai là người được giao việc (uỷ quyền «Ký hợp đồng», danh sách người ký bên nhận)
Bước Ký dùng vai thì người ký là người/nhóm được giao vai ấy (giải vai như lúc chạy); người ký cấu hình cũ trước khi giao việc không còn là người ký. Vai chưa giao mà còn cấu hình cũ thì giữ như trước.
- Kịch bản: khi vai «Người ký hợp đồng» giao nhóm X thì thành viên X là người ký, người ký cũ thì không [test: apps/hub-api/src/modules/packs/contracts/adapters/receive-flow.int.test.ts » soát #2 · bước Ký theo VAI: giải vai như lúc chạy ⇒ người ký = người được giao (isSigner + danh sách uỷ quyền), người ký cũ thì không]

#### Yêu cầu: Chuông «Chưa giao người» dùng nhãn vai Ký đã đặt
- Kịch bản: khi vai Ký có nhãn thì chuông ghi nhãn đó, ưu tiên quy trình đang Bật [test: apps/hub-api/src/modules/processes/roles/roles-migrate.int.test.ts » đọc `signer_role_label` trước tên bước, cùng khoá ở nhiều quy trình ⇒ lấy quy trình đang Bật của công ty]

#### Yêu cầu: Tắt «ký trên tài liệu» giữa lượt thì bước Ký chưa mở trở lại cách ký của quy trình
- Kịch bản: khi tắt giữa lượt thì mở bước khôi phục provider của quy trình [test: apps/hub-api/src/modules/processes/roles/roles.int.test.ts » soát #9: công ty tắt «ký trên tài liệu» giữa lượt, bản chụp còn provider=ondoc ⇒ mở bước khôi phục provider của def]

## Việc còn lại
