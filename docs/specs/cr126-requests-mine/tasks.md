---
id: cr126-requests-mine
lát: cr126-requests-mine
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Trang «Yêu cầu»: thêm khối «Đã gửi của tôi» (endpoint mới `GET /processes/requests/mine`) và thay «N ô» bằng dòng mô tả quy trình.

## Làm
- hub-api: `my-requests.service.ts` (một SQL, scope user, ≤ 50, lượt gốc bắt đầu bằng phiếu, loại lượt thử) + route đặt TRƯỚC `:run_id`; `requestWord` thuần.
- contracts: `MyRequestItem`, `StartableFlow.description`.
- workspace-web: `MyRequests.tsx`, `RequestsPage` (bỏ «N ô», hiện `description`), i18n vi/en.

## Không làm / Chạm
Không chạm inbox, RequestPage, RequestStepsTree, RunStepActions, NewRequestPage. Không migration: index `process_runs_started_by_idx (started_by, started_at desc)` đã có (hub 0019).

## Test tối thiểu
- unit `my-requests.test.ts`; int `my-requests.int.test.ts` (đường chính + chặn đọc chéo người/công ty).

## Quyết định trong lúc làm
- Endpoint `GET /process-runs?scope=mine` có sẵn nhưng lẫn lượt con/chat/chạy tay và không có «chờ ai» ⇒ thêm endpoint riêng.
- Nhóm trạng thái: đang chạy ⇒ Đang chờ (kèm tên người/nhóm của task mở); done ⇒ Đã hoàn tất (trừ khi quyết âm gần nhất là reject); kết thúc khác: Trả lại (fail) ⇒ Bị trả lại, còn lại ⇒ Từ chối.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/manual-start-ui.md
#### Yêu cầu: Trang «Yêu cầu» liệt kê yêu cầu mình đã gửi và mô tả loại yêu cầu (nguồn: cr126-requests-mine)
Dưới danh sách loại yêu cầu có khối «Đã gửi của tôi» (tên, ngày gửi, một nhóm trạng thái: Đang chờ <ai> / Đã hoàn tất / Bị trả lại / Từ chối; bấm mở trang yêu cầu). Mỗi loại yêu cầu hiện dòng mô tả quy trình (không có thì không hiện), không còn số ô.
- Kịch bản: khi người dùng đã gửi yêu cầu thì `GET /processes/requests/mine` chỉ trả yêu cầu phiếu của chính họ, người khác và công ty khác không thấy [test: apps/hub-api/src/modules/processes/triggers/my-requests.int.test.ts » chặn đọc chéo: người khác cùng công ty và công ty khác không thấy yêu cầu của A]
- Kịch bản: khi lượt đang chạy / xong / bị trả lại / bị từ chối thì hiện đúng một nhóm trạng thái [test: apps/hub-api/src/modules/processes/triggers/my-requests.test.ts » kết thúc không xong: Trả lại ⇒ returned, còn lại ⇒ rejected]

## Việc còn lại
- e2e hành trình (gửi yêu cầu → thấy ở «Đã gửi của tôi») gộp vào lượt e2e cuối đợt.
