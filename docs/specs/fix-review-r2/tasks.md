# fix-review-r2 — sửa theo soát Opus vòng 2 (CR-146 / CR-150 / CR-151) + seed UAT

## Plan
Sửa 9 điểm soát vòng 2 (người phụ trách HĐ nhận, test route respond, thoát `%_` khi tìm thành viên, ngưỡng mặc định, Word, nợ kỹ thuật) và để seed UAT chạy được trên bản test chưa có công ty `evolu`. Mỗi lỗi có test.

## Làm
| # | Việc | Trạng thái |
|---|---|---|
| 10 | Seed UAT: bản test chưa có công ty `evolu` ⇒ TẠO «Evolu» + gói Hợp đồng + quản trị `uat-nhan-admin`; có sẵn ⇒ chỉ thêm (`seed-demo-partner*.ts`) | xong (unit) |
| 12 | Seed: ghi rõ bật «cho phép tìm thấy» + flow_triggers; `ensureFlow` thấy quy trình trùng tên mà sơ đồ trống ⇒ dựng lại | xong (unit) |
| 1 | `trigger.params.owner_user_id` khi LƯU: người nội bộ, hoạt động, không khoá, đúng công ty ⇒ 422 `PROCESS_DEF_INVALID` theo trường; lúc nhận HĐ người không còn dùng được ⇒ `owner_user_id = null` (`flow-check.ts`, `receive-flow.repo.ts`) | xong (unit; int chờ chạy lần 2) |
| 3 | Tìm thành viên có `_`/`%` thoát đúng (`org.service.ts` dùng `likeArg`) | xong (int) |
| 2 | Int `POST /contracts/:id/sign-session/respond` đủ ca (`sign-session-respond.int.test.ts`) | xong (int) |
| 4 | Ngưỡng «Rất quan trọng > Quan trọng» kiểm cả khi một bên dùng mặc định (`schedule.rules.ts`) | xong (unit) |
| 5 | Đọc người ký trong cùng tx với accept | không làm (xem Quyết định) |
| 6 | Quy trình Thư viện lấy trigger từ bản xuất bản | không làm được (xem Quyết định; TECH-DEBT #270) |
| 7 | Hàm hub 0143 khi chưa đặt `app.tenant_id` | ghi lý do (Quyết định) |
| 8 | Word: `allow-popups allow-popups-to-escape-sandbox` + styles chỉ lấy văn bản `<style>` (`DocxFrame.tsx`, `docx-safe.ts`) | xong (unit) |
| 9 | Cắt `?limit` trong bộ nhớ ở danh sách đối tác cộng đồng | TECH-DEBT #269 |

## Không làm / Chạm
Không đụng contract-new / contract-review / contract-detail (cr152b), partners + Scoring/Rep/Crit (cr152c), community flows + ledger + requests + chat-web inbox + admin-web tenants (cr151b).

## Test tối thiểu
- unit: `seed-demo-partner.data.test.ts`, `schedule.rules.test.ts`, `receive-flow.repo.test.ts`, `docx-safe.test.tsx`.
- int (evotest): `org.service.int.test.ts`, `flow-check.int.test.ts`, `sign-session-respond.int.test.ts`.

## Quyết định trong lúc làm
- (10) `stg-test` chỉ có `demo` + `platform`: tạo công ty qua `POST /admin/tenants` (cùng đường màn Công ty), rồi `PUT /admin/tenants/:id/packs/contracts` (tạo nhóm `contracts-owner/editor`, quản trị công ty vào nhóm). Mật khẩu `uat-nhan-admin` = `UAT_EVOLU_PW` (file `UAT_EVOLU.pw`) đặt bằng một câu SQL như người UAT khác; mật khẩu tạm của API không dùng, không in. Guard `partnerGuard` vẫn chỉ cho stack `stg-test`.
- (12) Seed bật trên evolu: «cho phép tìm thấy» (danh bạ) và `flow_triggers` (chỉ bật, không tắt); đã ghi ở `tasks.md` này + `docs/uat/hop-dong-2-cong-ty.md` mục 0.
- (1) Kiểm lúc LƯU chỉ khi lần lưu có gửi `trigger` (lưu phần khác không bị chặn vì người cũ vừa nghỉ); chỉ def công ty (tenant có), không kiểm def Thư viện. Người nhận HĐ: `receiveOwnerOf(đã đặt, actor)`: đã đặt mà `actor` khác ⇒ null — KHÔNG lặng lẽ đổi sang quản trị; chưa đặt ⇒ quản trị công ty như cũ (spec §3 #9b). Luồng sự kiện vẫn do `actor` (quản trị) gây.
- (4) Mặc định 500/2000 triệu chuyển thành hằng `FLOW_RECEIVE_DEFAULT_*_M` ở `packages/contracts` (một nguồn cho luật lưu + bên nhận).
- (5) Không đổi: người ký chọn được tính qua `receiveSignerMembers` (đọc `hub.*` + `admin.*` bằng `db` hub); tx gói chạy bằng role `contracts_rw` không đọc được hai schema đó, nên KHÔNG gộp vào cùng tx. Cửa sổ lệch rất nhỏ (người bị gỡ khỏi bước Ký đúng lúc bấm Đồng ý) và hàm DEFINER `hub.sign_session_accept` chỉ ghi tên người ký, không cấp quyền; chấp nhận.
- (6) `hub.process_def_releases` KHÔNG có cột `trigger` (chỉ stages/slot_body) ⇒ không có «trigger của bản phát hành» để đọc; thêm cột cần migration hub + backfill, ngoài phạm vi lát nhỏ ⇒ TECH-DEBT #270.
- (7) Hàm `hub.contract_received_params` (0143, SECURITY DEFINER): khi `app.tenant_id` CHƯA đặt (`v_tid` null) hàm trả tham số của `p_tid` bất kỳ. Cố ý: bộ chuyển hộp thư / vòng nhận HĐ là worker NHIỀU công ty, chạy scope hệ thống rồi gọi theo từng `tid`; có đặt `app.tenant_id` (request của người dùng/gói) thì chỉ đọc công ty của mình. Chỉ trả jsonb `trigger.params` (ngưỡng + id người phụ trách), không lộ dữ liệu khác; EXECUTE chỉ cho `contracts_rw`/`hub_rw`. Không sửa migration đã gộp.
- (1) Int cho kiểm lúc lưu gọi thẳng `receiveOwnerCheck` (scope user của hub, DB thật) thay vì qua HTTP `PUT /process-defs`: dựng FlowDef `contract.received` hợp lệ cần đủ 3 kết quả + nhóm; `defs-flow.int.test.ts` hiện đỏ sẵn (tenant_admin ghi bị 403 `FORBIDDEN_TENANT_ADMIN_WRITE` do `tenantAdminReadOnly`, từ commit 4b88899b4 — NGOÀI phạm vi, báo QC).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/gui-doi-tac-q4.md

#### Yêu cầu: Người phụ trách hợp đồng nhận phải là người dùng được
Khi LƯU quy trình «Nhận HĐ từ đối tác», người phụ trách phải là người nội bộ của công ty, đang hoạt động, không bị khoá; sai ⇒ 422 theo trường `trigger.params.owner_user_id`. Lúc nhận hợp đồng mà người phụ trách đã không còn dùng được thì hợp đồng vẫn vào, chưa có người phụ trách (quản trị thấy «chưa có người phụ trách»).
- Kịch bản: khi lưu quy trình với người phụ trách là người công ty khác, bên ngoài, đã vô hiệu, bị khoá hoặc không tồn tại thì bị từ chối theo trường [test: apps/hub-api/src/modules/processes/defs/flow-check.int.test.ts » người công ty khác / bên ngoài / vô hiệu / bị khoá / không tồn tại ⇒ 422 PROCESS_DEF_INVALID, đường trigger.params.owner_user_id]
- Kịch bản: khi người phụ trách đã nghỉ lúc nhận hợp đồng thì hợp đồng vào với người phụ trách trống, không đổi sang quản trị [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-session-respond.int.test.ts » người phụ trách đã nghỉ ⇒ owner_user_id = null (HĐ vẫn vào), KHÔNG đổi sang quản trị]
- Kịch bản: khi người phụ trách đã đặt nhưng không còn dùng được thì chỉ ghi trống, chưa đặt thì dùng quản trị công ty [test: apps/hub-api/src/modules/packs/contracts/adapters/receive-flow.repo.test.ts » người đã đặt KHÔNG còn dùng được ⇒ null (kể cả khi có quản trị làm actor): HĐ vẫn vào, quản trị thấy «chưa có người phụ trách»]

#### Yêu cầu: Ngưỡng Rất quan trọng luôn lớn hơn Quan trọng, kể cả khi dùng mặc định
Ngưỡng bỏ trống dùng mặc định 500 triệu (Quan trọng) và 2 tỷ (Rất quan trọng); lưu ngưỡng làm «Rất quan trọng» không lớn hơn «Quan trọng» (kể cả so với mặc định) bị từ chối ở ngưỡng «Rất quan trọng».
- Kịch bản: khi chỉ nhập Rất quan trọng = 400 triệu (thấp hơn mặc định 500) thì bị từ chối, nhập 600 triệu thì được [test: apps/hub-api/src/modules/processes/triggers/schedule.rules.test.ts » fix-review-r2 · một bên dùng mặc định (500 triệu / 2 tỷ) vẫn phải giữ Rất quan trọng > Quan trọng]

#### Yêu cầu: Trả lời đề nghị ký cùng lúc đúng người, đúng người ký
Bên nhận chọn người ký trong bước Ký của quy trình Nhận HĐ; chỉ người phụ trách hợp đồng hoặc quản trị trả lời được.
- Kịch bản: khi chọn người ngoài bước Ký thì 422 SIGNER_NOT_IN_GROUP [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-session-respond.int.test.ts » người ký không nằm trong bước Ký của quy trình Nhận HĐ ⇒ 422 SIGNER_NOT_IN_GROUP]
- Kịch bản: khi quy trình Nhận HĐ không có bước Ký thì 422 NO_SIGN_NODE [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-session-respond.int.test.ts » quy trình Nhận HĐ không có bước Ký ⇒ 422 NO_SIGN_NODE]
- Kịch bản: khi người không phải phụ trách hợp đồng hoặc quản trị trả lời thì 403 và phiên không đổi [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-session-respond.int.test.ts » người không phải phụ trách HĐ / quản trị ⇒ 403 FORBIDDEN, phiên không đổi]
- Kịch bản: khi người ký được giao khác người tạo hợp đồng và khác người bấm trả lời thì Đồng ý được [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-session-respond.int.test.ts » N2 · người ký được giao (khác người tạo HĐ, khác người bấm trả lời) ⇒ Đồng ý được]

### MODIFIED pack-contracts/tai-lieu-kem.md

#### Yêu cầu: Xem tệp Word mở được liên kết https ở tab mới, phần kiểu dáng cũng sạch
Khung xem Word là iframe sandbox chỉ cho mở cửa sổ mới (không script, không cùng origin); liên kết https mở tab mới. Phần kiểu dáng của tài liệu chỉ lấy văn bản của thẻ style, ký tự `<` bị thoát nên không thể chèn HTML.
- Kịch bản: khi mở tệp Word thì khung có allow-popups, không allow-scripts, không allow-same-origin [test: apps/workspace-web/src/components/shared/file-viewer/docx-safe.test.tsx » iframe sandbox chỉ allow-popups (+ escape): không allow-scripts, không allow-same-origin]
- Kịch bản: khi kiểu dáng của tài liệu cố đóng thẻ style để chèn script thì bị thoát [test: apps/workspace-web/src/components/shared/file-viewer/docx-safe.test.tsx » CSS cố đóng thẻ để chèn HTML/script: mọi `<` bị thoát ⇒ không thể thoát khỏi <style>]

### MODIFIED admin/danh-sach.md

#### Yêu cầu: Tìm thành viên theo tên có dấu gạch dưới hoặc phần trăm
Ô tìm thành viên trong Cơ cấu khớp đúng ký tự `_` và `%` người dùng gõ, không coi là ký tự đại diện.
- Kịch bản: khi tìm "a_b" thì chỉ thấy tên có đúng "a_b", không thấy "axb" [test: apps/admin-api/src/modules/org/org.service.int.test.ts » fix-review-r2 · tìm tên có `_` và `%` khớp ĐÚNG ký tự đó (không là ký tự đại diện)]

### MODIFIED sht/gui-doi-tac-giao-dien.md

#### Yêu cầu: Seed UAT chạy được trên bản test chưa có công ty evolu
Bản test chỉ có demo và platform: seed tạo công ty «Evolu» (mã `evolu`) + gói Hợp đồng + quản trị `uat-nhan-admin` (mật khẩu ở file `UAT_EVOLU.pw`, không in); có sẵn thì chỉ thêm. Seed bật «cho phép tìm thấy» và chạy quy trình theo sự kiện ở evolu; quy trình trùng tên mà sơ đồ trống được dựng lại.
- Kịch bản: khi công ty evolu chưa có thì kế hoạch có bước tạo, có sẵn thì không [test: tools/scripts/src/seed-demo-partner.data.test.ts » thiếu công ty ⇒ có bước tạo + đặt mật khẩu quản trị + bật gói Hợp đồng]
- Kịch bản: khi quy trình trùng tên có sơ đồ trống thì dựng lại [test: tools/scripts/src/seed-demo-partner.data.test.ts » sơ đồ quy trình trống ⇒ dựng lại]

## Việc còn lại
- Chạy `bash seed-demo.sh --partner-only` trên máy chủ bản test (điều phối) để xác nhận bước tạo công ty (chưa chạy thật, chỉ có unit kế hoạch).
- QC: `defs-flow.int.test.ts` đỏ sẵn (tenant_admin ghi quy trình bị 403 do `tenantAdminReadOnly`) — không thuộc lát này.
