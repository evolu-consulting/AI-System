# CR-122 · E6 · Xuất bản flow Thư viện có trigger

Lỗi qc: flow Thư viện theo sự kiện (có `trigger`, không khe) không xuất bản được — `IS_LIB` đòi `slot`, B2 đòi khe + nút hệ thống.
Làn nhanh (một agent). Migration 0110 đã nới CHECK; lát này đưa service/repo theo kịp.

## Quyết định
- Def Thư viện = `tenant_id NULL` và (`slot` hoặc `trigger`) — `IS_LIB`, danh sách Thư viện/mẫu/mẫu chạy thử, `visible`.
- Xuất bản/quay lại def không khe: `parseFlowDef` + `flowDefIssues(def, sự kiện của app)` (qua `flowDefPaths`) ⇒ 422 `PROCESS_DEF_INVALID` + `paths`; `flowEdgeIssues` ⇒ 422 `FLOW_EDGE_MISSING`. Không kiểm khe/nút hệ thống; không kiểm cấu hình node (Thư viện không có công ty). Def khe cũ giữ B2 cũ.
- Nhân bản def Thư viện chép thêm `trigger`, `app`. `impact` của flow theo sự kiện = số công ty đã gán (`company_flows`) + lượt đang chạy.
- Gán/chạy: `company_flows` + `libraryFlowDef` đã chạy từ bản phát hành mới nhất (không đổi).
- Perf: không chạm đường nóng (publish = thao tác quản trị; thêm 0 câu SQL cho đường khe, `impact` flow = 1 câu).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Xuất bản flow Thư viện theo sự kiện
Flow Thư viện có "Bắt đầu khi" (trigger) và không có khe xuất bản được như flow theo khe: lưu bản phát hành v+1 sau khi kiểm luật flow (bước Kết thúc, sự kiện/điều kiện của app, cạnh giữa các bước); không đòi khe hay nút hệ thống của khe. Flow sai luật ⇒ 422 kèm đường dẫn lỗi và không tạo bản phát hành. Flow đã xuất bản gán được cho công ty và chạy từ bản phát hành mới nhất.
- Kịch bản: khi xuất bản flow Thư viện có trigger rồi gán cho công ty thì sự kiện mở đúng một lượt chạy từ bản phát hành [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » tạo → xuất bản v1 → gán công ty → sự kiện mở đúng 1 lượt từ BẢN XUẤT BẢN; xuất bản lại ⇒ v2]
- Kịch bản: khi flow Thư viện sai luật thì xuất bản trả 422 kèm đường dẫn và không có bản phát hành [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » flow lỗi ⇒ 422 PROCESS_DEF_INVALID + paths, không tạo bản xuất bản]
- Kịch bản: khi xuất bản def theo khe cũ thì vẫn kiểm luật khe như trước [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » def theo khe cũ xuất bản như trước (luật khe + nút hệ thống)]
- Kịch bản: khi flow Thư viện có trigger chưa gán cho công ty thì tenant_admin không thấy, gán rồi thì mở xem được [test: apps/hub-api/src/modules/processes/library/library-flow-publish.int.test.ts » tenant_admin chỉ mở (chỉ đọc) def Thư viện có trigger khi ĐÃ gán cho công ty của mình]

#### Yêu cầu: Def theo khe đã backfill (M1) vẫn sửa được theo đường khe
Def khe có thêm node Kết thúc ở đuôi (hub 0111) vẫn dựng lại được body từ stages (canvas) và lưu theo đường khe; luật FlowDef không áp cho def khe / bản riêng lưu theo khe. Nhân bản def khe không chép trigger/app. Def mặc định của seed có `published_version` 2 vì M1 tạo release v+1 (test library.routes cập nhật theo).
- Kịch bản: khi sửa bản riêng chỉ gửi stages có node Kết thúc đuôi thì body dựng lại và lưu được [test: apps/hub-api/src/modules/processes/library/clone-for-company.int.test.ts » PUT bản riêng (chỉ gửi stages) ⇒ slot_body được dựng lại + giữ, slot vẫn null, nguồn/bản không đổi]

## Việc còn lại
- Không có (UI admin-web/e2e do vùng khác).
