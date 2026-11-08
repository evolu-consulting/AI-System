---
id: cr125-manual-start-ui
lát: cr125-manual-start-ui
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-manual-start-engine
---
## Plan (ngắn)
Giao diện cho «bắt đầu quy trình bằng phiếu yêu cầu» (engine: `core.start-form`, `GET /processes/startable`, `POST /processes/start`).
1. admin-web: node «Phiếu yêu cầu» ở ĐẦU flow — bật bằng ô «Bắt đầu bằng phiếu yêu cầu» trong thẻ Bắt đầu khi (node không có ở menu «+»); panel sửa ô
   (nhãn, mã tự sinh, loại, bắt buộc, gợi ý), ai được bắt đầu (mọi người / nhóm), tên yêu cầu; node trên canvas «Phiếu yêu cầu · N ô»; `attachments` thêm vào panel chung.
2. workspace-web: mục «Tạo yêu cầu» (menu trái + lối tắt ở Tổng quan) → danh sách loại yêu cầu → phiếu dựng từ schema (tệp qua `POST /attachments`) → gửi với
   `request_id` sinh mỗi lần mở phiếu → trang yêu cầu (trạng thái, nội dung phiếu, các bước, nút Duyệt/Từ chối cho người được giao). Lỗi theo mã, nói nghiệp vụ.
3. e2e hành trình thật `e2e/journey-approval/cr125-manual-start.spec.ts`.

## Làm
- admin-web: `lib/start-form.ts` (+`-ops.ts`, test), `components/editor/StageStartForm.tsx`, nối ở `StageForm`/`FlowNodeBody`/`TriggerCard`/`FlowEditorBody`,
  `stage-convert` (`start_form` ⇄ `startForm`), `d2-validate` (kiểm tại chỗ), `modules/generic/fields.ts` (`attachments`), i18n `process.admin.startForm.*`.
- workspace-web: `features/requests/**`, route `/contracts/requests[/new/$flowKey|/$runId]`, nav `REQUESTS_NAV`, lối tắt Tổng quan, proxy `/processes /attachments
  /review-tasks /me/review-tasks` (rsbuild + `deploy/prod-sohoptac2/nginx.conf`), i18n `contracts.requests.*`.
- hub-api: `GET /processes/requests/:run_id` (`manual-request.service.ts`): quyền xem = `ViewService.get` (người gửi/người được giao/quản trị), trả thêm
  giá trị phiếu (nhãn theo phiếu của bản flow đã chạy). Cần cho «người duyệt thấy dữ liệu phiếu»; không đổi engine.

## Không làm / Chạm
- Không đổi engine/launch/settle, không migration. Ảnh xem của tệp đính kèm cho người duyệt: chỉ hiện số/tên tệp người gửi vừa tải; mở nội dung tệp của người khác
  theo quyền `/attachments` hiện có (chưa mở rộng).
- Trình sửa: chọn nhóm theo MÃ (đúng cho mẫu Thư viện lẫn bản công ty); trình sửa Thư viện (không công ty) chưa có danh sách nhóm để chọn.

## Test tối thiểu
- unit: `admin-web …/lib/start-form.test.ts` · `workspace-web …/requests/lib/request-form.test.ts` · `hub-api …/triggers/manual-request.test.ts` · `nav.test.ts`.
- tsc admin-web/workspace-web/hub-api 0 lỗi; biome sạch.
- e2e hành trình `cr125-manual-start.spec.ts` (journey-approval) trên evotest -Dirty.

## Quyết định trong lúc làm
- Bật phiếu ở thẻ «Bắt đầu khi» (không ở menu «+»): MỘT chỗ, gỡ cũng ở đó; thêm ở đầu flow bằng `insertStepAfter(-1)` + `remapStepRefs` (đích bước đánh lại).
- `workspace-web` không nạp chuỗi `process.*` ⇒ câu lỗi `START_*` chép đúng lời `process.run.startError.*` sang `contracts.requests.err.*`.
- Người/Phòng ban của phiếu lấy từ `/admin/org` (lỗi quyền ⇒ báo, không chọn được).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/manual-start-ui.md
#### Yêu cầu: Tạo yêu cầu từ phiếu ở workspace
Nhân viên mở «Tạo yêu cầu», chọn loại yêu cầu mà flow bắt đầu bằng phiếu cho phép mình, điền phiếu dựng từ cấu hình flow rồi gửi; hệ thống mở lượt
và đưa tới trang yêu cầu (trạng thái, nội dung phiếu, các bước). Người được giao duyệt thấy nội dung phiếu trên thẻ và Duyệt/Từ chối tại đó.
- Kịch bản: khi quản trị công ty bật phiếu ở flow, đặt ô và áp dụng, rồi nhân viên điền phiếu và gửi thì người duyệt thấy dữ liệu phiếu và duyệt xong thì yêu cầu hoàn tất [test: e2e/journey-approval/cr125-manual-start.spec.ts » 2 · nhân viên: Tạo yêu cầu → điền phiếu (tải file) → gửi → trang yêu cầu, người duyệt thấy dữ liệu phiếu → Duyệt → hoàn tất]
- Kịch bản: khi ô bắt buộc để trống hoặc tiền sai thì lỗi hiện cạnh ô và không gửi; lỗi API theo mã nói bằng lời nghiệp vụ [test: apps/workspace-web/src/features/requests/lib/request-form.test.ts » ô bắt buộc trống ⇒ lỗi theo ô, tiền sai ⇒ money, đủ ⇒ không lỗi]

#### Yêu cầu: Quản trị công ty dựng phiếu yêu cầu ở trình sửa flow
Thẻ «Bắt đầu khi» có ô «Bắt đầu bằng phiếu yêu cầu»: bật thì node «Phiếu yêu cầu» đứng đầu sơ đồ (các bước khác lùi một, đích bước được đánh lại), tắt thì gỡ;
panel node sửa ô (nhãn, loại gồm tệp đính kèm, bắt buộc, gợi ý; mã tự sinh từ nhãn), ai được bắt đầu và tên yêu cầu; kiểm ngay tại chỗ.
- Kịch bản: khi bật phiếu thì node phiếu đứng bước 0 và các bước còn lại lùi một; gỡ thì dồn lại [test: apps/admin-web/src/features/processes/lib/start-form.test.ts » thêm node phiếu ở ĐẦU flow đẩy các bước lùi một và đánh lại đích bước, gỡ thì dồn lại]
- Kịch bản: khi nhãn trống, mã trùng hoặc trùng mã hệ thống, mẫu tên trống thì báo lỗi theo ô [test: apps/admin-web/src/features/processes/lib/start-form.test.ts » kiểm tại chỗ: cần ≥ 1 ô, nhãn, mã không trùng/không phải mã hệ thống, mẫu tên, nhóm khi chọn nhóm]

#### Yêu cầu: Trang yêu cầu cho người được xem
`GET /processes/requests/:run_id` trả lượt (cùng quyền xem với `GET /process-runs/:id`) kèm giá trị phiếu có nhãn theo phiếu của bản flow đã chạy.
- Kịch bản: khi lượt có giá trị phiếu thì trả danh sách ô theo thứ tự phiếu, ô vắng bị bỏ [test: apps/hub-api/src/modules/processes/triggers/manual-request.test.ts » nhãn theo phiếu, tiền lấy từ value, ô vắng bỏ]

## Việc còn lại
- Chạy e2e hành trình trên evotest (xem kết quả cuối báo cáo lát) và gộp ảnh vào `docs/specs/cr125-manual-start-ui/`.
- Chưa có danh sách «Yêu cầu của tôi» (chỉ mở được qua liên kết sau khi gửi hoặc từ «Việc chờ tôi»).