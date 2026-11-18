---
id: cr185-settings
lát: cr185-settings
cr: CR-185
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Ý (2): sơ đồ Sổ Hợp Tác (SHT) vẽ đúng nút / cạnh như trang quản trị. Ý (3): bỏ mục Cài đặt › «Kết nối», điều kiện đối tác thành cảnh báo ở «Quy trình duyệt».

## Làm
- [x] So sánh MỘT quy trình thật ở hai bên (mẫu Thư viện «Duyệt 2 cấp», `FLOW_TEMPLATES` hub-api; dựng bằng test tạm, kết quả bên dưới).
- [x] `GET /approval-flow` `graph[]` thêm `node`, `exec`, `wait_branches`, `outcome` (chỉ ĐỌC dữ liệu lưu; contract chỉ thêm trường tuỳ chọn).
- [x] `@ai/flow-canvas` `layout/def-modules.ts`: gộp cụm node module (Gửi ký + Chờ ký = MỘT ô, cùng `moduleClusters` / sổ `MODULES` với admin) + cạnh đầu ra có tên (nét đứt, nhãn «Từ chối · Hết hạn»); `buildDefViewGraph` gọi.
- [x] Nút Kết thúc: «Kết thúc» + kết quả thật (Đã duyệt / Từ chối / Trả lại, lấy từ `outcomes` của sự kiện `contract.submitted`), cờ xanh — cùng kiểu admin.
- [x] Test khoá hai bên khớp: `apps/admin-web/src/features/processes/components/canvas/def-parity.test.ts` (cùng def ⇒ cùng tập nút + cạnh; 3 mẫu Thư viện + 3 mẫu đóng băng).
- [x] Bỏ khoá `sign`: types / section-key / SettingsNav / SectionPanes / SettingsDialog; `?sec=sign` ⇒ `flow`; xoá `SignPartnerPane`, `PartnerConfirmStatus`.
- [x] Cảnh báo đối tác: `lib/partner-warn.ts` + `PartnerWarn.tsx` (dòng vàng trong ô chọn Quy trình + trên quy trình đang xem; dòng đầu mục khi chưa có quy trình «Nhận HĐ»). Chỉ quản trị có dữ liệu (hook cũ `usePartnerConfirmStatus`, API `GET /admin/tenants/{id}/partner-confirm`).
- [x] i18n: bỏ `signPane`, `sec.sign(Hint)`; thêm `flow.current.partnerWarn.{send,receive}`, `canvas.finish`; mọi `{{path:sign}}` ⇒ `{{path:signature}}` (ký số), RECEIVE_NO_OWNER ⇒ `{{path:flow}}`.

## Chênh lệch tìm thấy (mẫu «Duyệt 2 cấp»; admin 7 ô, SHT 8 nút trước khi sửa)
| # | Loại | Trang quản trị | SHT trước khi sửa | Sau khi sửa |
|---|---|---|---|---|
| 1 | Nút | «Ký số» = MỘT ô (Gửi ký + Chờ ký gộp, đầu ra Ký xong / Từ chối / Hết hạn) | hai nút «Ký số», «Chờ ký xong» | một ô |
| 2 | Cạnh | Ký số ⇒ Kết thúc · Từ chối: nét đứt vàng nhãn «Từ chối · Hết hạn» | KHÔNG có ⇒ nút «Từ chối» đứng mồ côi | có (một cạnh, nhãn ghép) |
| 3 | Nút Kết thúc | «Kết thúc» + kết quả (Đã duyệt / Từ chối / Trả lại), cờ xanh | tên bước «Kết thúc · Từ chối» trong khung nét đứt xám | giống admin |
| 4 | Cạnh | Duyệt ⇒ Từ chối / Trả lại: admin KHÔNG vẽ cạnh (`reject_step`/`return_step` chỉ ở panel); «Trả lại» đứng riêng | giống | giữ giống (xem quyết định) |
| 5 | Nút tự sinh | không | không (SHT chỉ vẽ stage có thật; 3 nút kết thúc = 3 stage có `outcome` trong định nghĩa) | không đổi |

Cạnh còn lại (Bắt đầu → bước đầu, tiến theo cột, Đúng/Sai của Nếu, nhảy bước `next_step`): đã trùng từ CR-184, test parity xác nhận.

## Không làm / Chạm
- Không đổi trang quản trị (chỉ thêm test). Không vẽ thêm cạnh Từ chối / Trả lại cho bước Duyệt ở cả hai bên (xem quyết định).
- Chế độ «Danh sách» của SHT giữ nguyên (vẫn liệt kê Gửi ký và Chờ ký riêng).
- Chạm: `packages/flow-canvas`, `packages/contracts` (+4 trường tuỳ chọn), `packages/i18n`, `apps/hub-api` (đọc), `apps/workspace-web/src/features/settings`.

## Test tối thiểu
- unit: `packages/flow-canvas/src/layout/def-graph.test.ts`, `apps/admin-web/.../def-parity.test.ts`, `apps/workspace-web/.../partner-warn.test.ts` / `flow-view.test.ts` / `section-key.test.ts` / `SettingsNav.test.ts`, `apps/hub-api/.../event-flow-graph.rules.test.ts`.
- int: `approval-flow-current.int.test.ts` (evotest).

## Quyết định trong lúc làm
- Từ chối / Trả lại: admin chỉ thể hiện bằng NÚT Kết thúc + cạnh đầu ra của ô Ký số (Từ chối · Hết hạn); không vẽ cạnh từ bước Duyệt. Áp đúng như vậy cho SHT trong code chung (`def-modules.ts`), không thêm kiểu riêng.
- Gộp cụm dùng chung luật `moduleClusters` (@ai/contracts) + sổ `MODULES`; parity với `collapseModules` của admin do test khoá (admin chưa đổi sang hàm chung để không rủi ro cho editor).
- Nhiều đầu ra cùng một đích ⇒ SHT vẽ MỘT cạnh (admin vẽ hai cạnh chồng nhau, nhãn ghép ở cạnh đầu); parity so theo tập (nguồn, đích).
- Nhãn Kết thúc lấy từ manifest (`contract.submitted` outcomes), tiếng Việt như admin; mã kết quả lạ ⇒ dùng tên bước.
- Cảnh báo Gửi: chỉ điều kiện `need` = send/both còn `todo` (bỏ `send_flow`, `unknown`); hiện trên quy trình có bước Gửi đối tác. Cảnh báo Nhận: chỉ khi tính năng đã bật (`on`) mà `receive_flow` = todo (công ty không dùng đối tác thì không nhắc).
- `{{path:sign}}` trong câu hướng dẫn ký số vốn đã lỗi thời từ CR-184 (ký số dời sang «Chữ ký») ⇒ sửa trỏ `signature`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Cài đặt › Quy trình duyệt vẽ cùng nút và cạnh với trang quản trị (CR-185)
Sơ đồ chỉ xem của Sổ Hợp Tác vẽ ĐÚNG các nút trang quản trị vẽ: node module nhiều bước (Ký số = Gửi ký + Chờ ký) là MỘT ô; nút Kết thúc chỉ là bước có kết quả thật, ghi «Kết thúc» + kết quả (Đã duyệt / Từ chối / Trả lại), không tự sinh nút; Từ chối / Hết hạn của ô Ký số là một cạnh nét đứt có nhãn tới Kết thúc · Từ chối. `GET /approval-flow` `graph[]` thêm `node`, `exec`, `wait_branches`, `outcome` (tuỳ chọn).
- Kịch bản: khi cùng một định nghĩa thì sơ đồ Sổ Hợp Tác và trang quản trị ra cùng tập nút và cùng tập cạnh [test: apps/admin-web/src/features/processes/components/canvas/def-parity.test.ts » Duyệt 2 cấp: cùng một định nghĩa ra cùng tập nút và cùng tập cạnh ở hai bên]
- Kịch bản: khi bước Gửi ký và Chờ ký liền nhau thì sơ đồ chỉ có một ô Ký số, nút Kết thúc chỉ là bước có kết quả [test: packages/flow-canvas/src/layout/def-graph.test.ts » Gửi ký + Chờ ký là MỘT ô, nút Kết thúc chỉ là stage có kết quả (không tự thêm)]
- Kịch bản: khi Ký số bị từ chối hoặc hết hạn thì có một cạnh nét đứt có nhãn tới Kết thúc · Từ chối [test: packages/flow-canvas/src/layout/def-graph.test.ts » Từ chối · Hết hạn là MỘT cạnh nét đứt có nhãn tới Kết thúc · Từ chối, Trả lại không bị tự nối]
- Kịch bản: khi dựng chữ sơ đồ thì nút Kết thúc ghi «Kết thúc» và kết quả thật [test: apps/workspace-web/src/features/settings/lib/flow-view.test.ts » nút Kết thúc: «Kết thúc» + kết quả thật (Đã duyệt / Từ chối / Trả lại), không tự thêm nút]
- Kịch bản: khi đọc định nghĩa lưu thì graph có node, loại executor, nhánh chờ, mã kết quả [test: apps/hub-api/src/modules/packs/contracts/domain/event-flow-graph.rules.test.ts » CR-185 · node module + loại executor + nhánh chờ + mã kết quả của Kết thúc được trả để Sổ Hợp Tác vẽ như trang quản trị]
- Kịch bản: khi gọi `GET /approval-flow` thì Kết thúc có `outcome` [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » CR-185 · `graph` kèm mã kết quả của Kết thúc (outcome) + loại executor, để Sổ Hợp Tác vẽ nhãn Kết thúc như trang quản trị]

#### Yêu cầu: Bỏ mục Cài đặt › Kết nối; điều kiện đối tác là cảnh báo ở Quy trình duyệt (CR-185)
Cài đặt chỉ còn các mục Công ty, Điểm uy tín, Điểm kinh doanh, Dò giá, Quy trình duyệt (+ Chữ ký, Bảng tin). Link cũ `?sec=sign` mở «Quy trình duyệt». Quy trình có bước «Gửi đối tác xác nhận» mà thiếu điều kiện (MST / hồ sơ, kênh, tính năng…) hiện dòng cảnh báo vàng «còn thiếu: … · ai sửa» trong ô chọn Quy trình và trên quy trình đang xem. Công ty đã bật tính năng đối tác mà chưa có quy trình «Nhận HĐ» thì có một dòng cảnh báo đầu mục. Chỉ quản trị công ty thấy cảnh báo.
- Kịch bản: khi mở `?sec=sign` thì vào Quy trình duyệt [test: apps/workspace-web/src/features/settings/lib/section-key.test.ts » CR-185 · khoá cũ sign (mục «Kết nối» đã bỏ) ⇒ mục Quy trình duyệt]
- Kịch bản: khi chủ sở hữu mở Cài đặt thì không còn mục Kết nối [test: apps/workspace-web/src/features/settings/components/SettingsNav.test.ts » cả hai gói ⇒ hai nhóm có tiêu đề]
- Kịch bản: khi thiếu MST thì quy trình có bước Gửi đối tác có cảnh báo, quy trình khác không [test: apps/workspace-web/src/features/settings/lib/partner-warn.test.ts » thiếu MST ⇒ cảnh báo trên quy trình có bước Gửi đối tác, ghi điều thiếu + ai sửa]
- Kịch bản: khi tính năng bật mà chưa có quy trình Nhận HĐ thì cảnh báo đầu mục [test: apps/workspace-web/src/features/settings/lib/partner-warn.test.ts » tính năng bật mà chưa có quy trình Nhận HĐ ⇒ cảnh báo đầu mục]
- Kịch bản: khi người xem không phải quản trị thì không cảnh báo [test: apps/workspace-web/src/features/settings/lib/partner-warn.test.ts » không có dữ liệu (thành viên không phải quản trị) ⇒ không cảnh báo]
- Kịch bản: khi quản trị mở Quy trình duyệt thì thấy cảnh báo trong ô chọn [test: thủ công — qc thêm e2e vì cần dữ liệu đối tác thật trên evotest, unit đã phủ luật chọn cảnh báo]

## Việc còn lại
- qc sửa e2e KHOÁ (CR-185 bỏ mục «Kết nối»): `e2e/contracts-web/cr184-settings.cw.ts` ca «CR-184 · Kết nối chỉ còn «Gửi và nhận hợp đồng với đối tác», Ký số nằm ở Chữ ký» (bấm nút «Kết nối», `sign-partner-pane`, `sign-block-partner`); `e2e/smoke-journey/smoke-journey.smoke.ts` ca S4a/S4b/S5a/S5b (`?sec=sign`, `partner-confirm-status`, `partner-confirm-summary`, `partner-confirm-item-listed` — đổi sang kiểm «Quy trình duyệt» không có dòng cảnh báo `flow-partner-warn` / `flow-warn-<i>` / `flow-receive-warn` khi đủ điều kiện); `e2e/community-web/settings.cm.ts` (ẩn `sign`: vẫn xanh, chỉ bỏ "sign" khỏi danh sách cho gọn); `e2e/contracts-web/esign-anchor.cw.ts` dòng 1 (chỉ chú thích «Cài đặt › Kết nối»).
- Soát UI thật: sơ đồ «Duyệt 2 cấp» ở SHT sau khi gộp ô Ký số (ELK Dọc, 390px), dòng cảnh báo vàng trong ô chọn.
- `packages/i18n` có 2 test đỏ không liên quan (placeholders: `READINESS_ASSIGNEE_MISSING`, `orgEdit.removeConfirm`); `tsc` hub-api `pmsg-db.int.test.ts:412` và flow-canvas `vertical.test.ts:14` đỏ sẵn.
