---
id: cr125-m6b-canvas-registry
lát: cr125-m6b-canvas-registry
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: m6a (đã gộp)
---
## Plan (ngắn)
MOD-FR-06: canvas, menu "+", palette đọc node CHỈ từ `MODULES` (node module) và registry loại bước (`FE_NODES`, bước cơ bản); xoá mọi danh sách node cứng còn lại ở admin-web.

## Làm
1. Contracts: `AppNodeDecl.menu` (`{ section: business|advanced, order? }`, mặc định `advanced`/50) — Ký số 30, Thông báo chuông 40, Gửi email 50 khai ở `modules/**`; `AppSignalDecl.pick` đánh dấu tín hiệu ký số cho ô chọn "Chờ sự kiện".
2. admin-web: `lib/node-menu.ts` không còn `BUSINESS_*_KEYS` — nhóm + thứ tự đọc từ `menu` của node (module) / `FE_NODES[*].menu` (Duyệt 10, Nếu 20, Kết thúc 60; Điền thông tin / Agent / Công cụ / Ghi giá trị ở Nâng cao). `lib/flow-def.ts` `NODE_TABLE` cứng ⇒ dẫn xuất từ `FE_NODES`. `StageTimedWait` bỏ `SIGN_EVENTS` cứng, đọc `signals[pick]` của manifest app. `panel-registry` nhận `MODULES` tiêm vào (test fixture).
3. `module:new`: khung node.ts có `menu: { section: "business" }` ⇒ node mới hiện ở menu "+" cho công ty ngay khi điền stage mẫu, panel chung từ `configPort`, không sửa file nào khác.

## Không làm / Chạm
- Không đổi hành vi node hiện có (thứ tự + nhóm menu như cũ; `partner-send`, `show-post`, Hẹn giờ, Chờ khoảng vẫn Nâng cao). Không sửa CR-124 partner-send. Editor "Thư viện" theo khe (`FlowAddNodes`) là trình sửa cũ riêng, ngoài phạm vi.
- Ô "Chờ sự kiện" của app không khai `pick` hiện danh sách rỗng (chỉ còn "Sự kiện khác") — chỉ app Hợp đồng có tín hiệu ký số.

## Test tối thiểu
Unit `lib/m6b-registry.test.ts` (fixture module như `module:new demo sample`: vào menu "+", panel chung, thứ tự theo order), `lib/node-menu.test.ts`, `tools/scripts modules-tool.rules.test.ts`; e2e arrow-drag + palette-drop một lần trên evotest; tsc contracts + admin-web.

## Quyết định trong lúc làm
- Bước cơ bản (Duyệt/Nếu/Kết thúc/Điền thông tin/Agent/Công cụ/Ghi giá trị) lấy menu từ registry loại bước phía editor (đã là nguồn duy nhất của `executor`), không thêm node vào `core` (giữ nguyên MOD-FR-05).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Menu "+", palette và panel đọc node từ một nguồn khai báo (nguồn: CR-125 m6b)
Nhóm (nghiệp vụ / Nâng cao) và thứ tự của node trên menu "+" do chính node khai; thêm node mới bằng `module:new` thì có mặt ở menu với panel chung, không sửa file nào khác ở web.
- Kịch bản: khi có node mới chỉ khai báo ở module thì nó hiện ở menu "+" của công ty và panel chung dựng từ cổng cấu hình [test: apps/admin-web/src/features/processes/lib/m6b-registry.test.ts » menu '+' của công ty có node mới (nhóm nghiệp vụ), nhóm Nâng cao chỉ cho quản trị nền tảng]
- Kịch bản: khi node mới không có panel riêng thì dùng panel chung [test: apps/admin-web/src/features/processes/lib/m6b-registry.test.ts » panel chung dựng từ cổng cấu hình, không cần đăng ký panel riêng]
- Kịch bản: khi mở menu "+" của công ty thì thứ tự Duyệt, Nếu, Ký số, Thông báo, Kết thúc như cũ [test: apps/admin-web/src/features/processes/lib/node-menu.test.ts » công ty: Duyệt · Nếu · Ký số · Thông báo · Kết thúc, không có Nâng cao và không có 'Chờ ký xong' riêng]
- Kịch bản: khi thả node từ palette và kéo mũi tên trên flow thật thì hành vi như cũ [test: e2e/journey-approval/cr123-palette-drop.spec.ts » U4 · công ty sao chép flow, mở trình sửa, KÉO 'Thông báo' từ menu Thêm bước thả vào canvas ⇒ thêm một node, node mới nằm trong sơ đồ]

## Việc còn lại
- Không.
