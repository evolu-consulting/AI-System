# flow bridge

Cập nhật: 2026-11-08 · Nguồn: cr122-n2-bridge-ai. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Nối hai node lệch giao diện: kiểm tất định khi lưu và gợi ý cầu nối bằng AI (FLOW2-FR-26)
Mỗi cạnh của flow được kiểm tất định (không AI): bước sau thiếu trường bắt buộc mà bước trước không có ⇒ chặn lưu 422 `FLOW_EDGE_MISSING`; chỉ sai kiểu ⇒ lưu được kèm `warnings`. `POST /process-defs/bridge-suggest` nhờ AI (qua Agent Hub) đề xuất chèn node Ghi giá trị làm cầu nối; kết quả đã kiểm lại, không lưu gì, AI chỉ thấy tên/kiểu trường.
- Kịch bản: khi bước sau cần trường bắt buộc mà bước trước không có thì cạnh bị báo thiếu, có đủ thì sạch [test: packages/contracts/src/hub-admin/process-flow-edges.test.ts » bước sau (Ký số) cần contract_id mà bước trước không có ⇒ missing, có đủ ⇒ sạch]
- Kịch bản: khi giữa hai node có node Chờ thì dữ liệu bước trước đi qua [test: packages/contracts/src/hub-admin/process-flow-edges.test.ts » node điều khiển (Chờ khoảng) trong suốt: dữ liệu của bước trước đi qua]
- Kịch bản: khi chèn cầu nối vào một cạnh thì số bước và tham chiếu bước dời đúng [test: packages/contracts/src/hub-admin/process-flow-edges.test.ts » chèn vào cạnh a→b: cầu nối ở bước 1, b/c dời +1, nhánh goto cập nhật, hết lệch]
- Kịch bản: khi lưu flow thiếu trường bắt buộc thì 422 FLOW_EDGE_MISSING và không ghi [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » thiếu trường BẮT BUỘC ⇒ 422 FLOW_EDGE_MISSING nêu cạnh + trường, không ghi, đủ trường ⇒ lưu, không warnings]
- Kịch bản: khi chỉ lệch kiểu thì vẫn lưu và trả warnings [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » sai kiểu (field `date` là chuỗi, Hẹn giờ cần date) ⇒ vẫn lưu, response có warnings]
- Kịch bản: khi gợi ý cầu nối hợp lệ thì trả stage set + giải thích vi/en, AI chỉ nhận tên/kiểu trường [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » đề xuất hợp lệ ⇒ stage set (bước 1), giải thích vi+en, qua Agent Hub, prompt chỉ có tên/kiểu trường]
- Kịch bản: khi hai bước đã khớp thì không gọi AI [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » hai bước đã khớp ⇒ ok:false, không gọi AI, cạnh không có thật ⇒ 400]
- Kịch bản: khi AI không map được hoặc trả sai thì ok:false kèm lý do [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » AI nói không map được ⇒ giữ lý do, AI trả sai hình / map sai kiểu / lỗi / hết trần ⇒ ok:false]
- Kịch bản: khi người dùng không phải admin, khác công ty, hoặc gọi quá nhanh thì bị từ chối [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » vai + tenant: member 403, tenant_admin sang tenant khác 404, platform_admin chọn tenant, tần suất 10/phút ⇒ 429]

#### Yêu cầu: Chạy tay một quy trình kiểm tính năng của node như đường mở lượt từ sự kiện (FLOW2-FR-25)
`POST /process-defs/:id/run` từ chối 422 `FLOW_NODE_FEATURE_OFF` khi một node của quy trình thuộc tính năng đã tắt cho công ty.
- Kịch bản: khi chạy tay quy trình có node của tính năng đã tắt thì 422 và không mở lượt [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » chạy tay: node của tính năng đã tắt ⇒ 422 FLOW_NODE_FEATURE_OFF, không mở lượt]
