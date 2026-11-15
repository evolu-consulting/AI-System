# diag-s12-s18 — chẩn đoán smoke bản test S12 / S18 (CR-161 / CR-169)

## Plan
Bài smoke-journey trên bản test: S12 «Chọn đối tác» không thấy Smoke B dù S17 đã kết nối A↔B; S18 nhân viên B không thấy cuộc nhắn của nhân viên A.
Tái hiện bằng `smoke-journey.ps1 -Env test -Keep` (giữ smoke-a/smoke-b) rồi đọc DB (chỉ đọc).

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 1 | Cờ `-Keep` cho bài smoke (bỏ purge cuối, lần chạy thường kế tiếp tự dọn) | `deploy/smoke/smoke-journey.ps1` | [x] |
| 2 | Int đỏ trước: công ty đã kết nối (chưa HĐ, không có trong sổ đối tác) phải có trong lựa chọn `company_partners` và gửi được; mới mời thì không | `apps/hub-api/src/modules/packs/contracts/partner-pick-connected.int.test.ts` | [x] |
| 3 | Sửa: `partners()` + `isPartner()` gộp sổ đối tác với `hub.cc_links('connected')` (một câu mỗi hàm) | `apps/hub-api/src/modules/packs/contracts/adapters/partner-send.repo.ts` | [x] |
| 4 | Sửa bài S18: chờ chip bật + dòng kết quả đúng «Nhân viên Smoke B» rồi mới bấm; kiểm `chat-company` | `e2e/smoke-journey/smoke-journey.smoke.ts` | [x] |

## Chẩn đoán (bằng chứng: bản test, lượt -Keep 20261115-234951)
- S12 = lỗi sản phẩm. `hub.partner_links` smoke-a↔smoke-b cả hai chiều `accepted`; `contracts.partner_roles` của smoke-a: 0 dòng. Nguồn lựa chọn `company_partners` (`partner-send.repo.ts partners()`) chỉ đọc `partner_roles` ⇒ công ty kết nối qua «Tìm công ty» mà chưa có HĐ không chọn được (trái CR-161 spec.md:11 «Đã kết nối: hiện trong Đối tác, gửi HĐ đi thẳng»). flows3 FL3-4 xanh vì `_flows3-stack.ts:121-122` chèn `partner_roles` bằng SQL.
- S18 = lỗi bài. `hub.pmsg_threads` cho smoke-*: 0 dòng; `contracts.msg_conversations` smoke-a có 1 cuộc `direct` thành viên smoke-a-nv + smoke-a-gd. Bài bấm `person-row.first()` ngay sau khi gõ (chưa chờ kết quả lọc theo công ty B) ⇒ chọn nhầm đồng nghiệp A; e2e cr169 chờ `aria-pressed` + dòng có tên nên xanh.

## Quyết định trong lúc làm
- Gộp công ty đã kết nối ở tầng repo (một nguồn: `hub.cc_links`, hàm DEFINER sẵn có cấp cho `contracts_rw`), không ghi thêm dòng `partner_roles` khi đồng ý kết nối (tránh hai nguồn, G1). Trần 101 công ty kết nối theo trần của `cc_links`.
- Trùng MST giữa sổ đối tác và công ty kết nối ⇒ giữ tên trong sổ đối tác.

## Soát Opus (quyền)
- `apps/hub-api/src/modules/packs/contracts/adapters/partner-send.repo.ts` — `isPartner()` (kiểm chặn PARTNER_NOT_IN_COMPANY của tool gửi) nay nhận thêm công ty đã kết nối; `partners()` lộ thêm tên + MST công ty đã kết nối cho người được giao bước chọn đối tác (cùng thông tin đã hiện ở trang Đối tác).

## Việc còn lại
- Bản test đang chạy 075fed936 (chưa có sửa S12) ⇒ S12 vẫn đỏ trên bản test tới khi deploy bản có commit sửa.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/gui-doi-tac-xac-nhan.md
#### Yêu cầu: Công ty đã kết nối chọn được ở bước «Chọn đối tác & người nhận»
Danh sách đối tác của bước «Chọn đối tác & người nhận» gồm đối tác có MST trong sổ đối tác của công ty và mọi công ty đã kết nối có MST (kể cả chưa có hợp đồng). Gửi tới công ty đã kết nối không bị chặn «không phải đối tác của công ty». Công ty mới được mời, chưa đồng ý, không có trong danh sách.
- Kịch bản: khi hai công ty đã kết nối mà chưa có hợp đồng thì công ty kia có trong danh sách chọn, công ty mới mời thì không [test: apps/hub-api/src/modules/packs/contracts/partner-pick-connected.int.test.ts » lựa chọn `company_partners` có công ty đã kết nối]
- Kịch bản: khi gửi tới MST công ty đã kết nối thì được coi là đối tác của công ty, MST công ty mới mời thì không [test: apps/hub-api/src/modules/packs/contracts/partner-pick-connected.int.test.ts » gửi: MST công ty đã kết nối là đối tác của công ty]
