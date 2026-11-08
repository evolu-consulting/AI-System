---
id: cr120-flows-one-page
lát: cr120-flows-one-page
cr: CR-120
làn: nhanh
migration: không
phụ thuộc: cr120-single-source (đã gộp, gd0 06e5c576)
---
## Plan (ngắn)
Người dùng: "sao phải chia, khó hiểu, tùm lum thứ". Một trang `/processes` ("Quy trình") liệt kê MỌI quy trình công ty có, nhóm theo app; bỏ tab
"Của công ty / Mẫu · chạy thử" (mẫu vào "Tạo quy trình › Tạo từ mẫu"); mỗi thẻ app ở trang công ty (platform) chỉ còn MỘT khối "Quy trình".
Không đổi engine / migration / endpoint: gom client-side từ capabilities + routing mỗi khe + `/process-defs` (own + `kind=sample`) + `/admin/org`
(mỗi nguồn MỘT truy vấn; số truy vấn routing = số khe, không theo dòng; sơ đồ nạp khi bấm).

## Làm
- `lib/flows-view.ts` (thuần + test): dòng platform-cung-cấp (từ routing: tập gán, luật, current_def_id, dòng "đang dùng" ngoài tập) + dòng công ty-tạo,
  lọc chip app/nguồn/trạng thái, nhóm theo app (Sổ Hợp Tác, Community, … Chung cuối), mảnh câu "HĐ mua từ Phòng Kinh doanh".
- `hooks/use-flows-list.ts`, `components/flows/{FlowsList,FlowItem,FlowWhenText,FlowDiagram,RulesPanel,CreateDialog}.tsx` (chunk lười `flows-one-page`).
- `ProcessesPage/Header/use-processes-view`: tenant (và platform đã chọn công ty) ⇒ một danh sách, không tab; platform chưa chọn công ty giữ Thư viện/Mẫu như cũ.
- Khối "Quy trình" duy nhất trong thẻ app (`TenantProcessSlots`, `lib/engine-toggle.ts`): công tắc "Duyệt theo quy trình" = `contracts-approval-engine`
  (bỏ khỏi "Tính năng thêm"), tập gán + luật mở sẵn, "Mặc định" là một dòng; xoá ô chọn / Gán / Về mặc định cũ (API cũ còn, do cr120-single-source).
- workspace-web Cài đặt › Ứng dụng & quy trình: link "Xem tất cả quy trình" → trang này (SSO một lần).
- Tiêu đề trang + nav: "Quy trình"; mô tả: "Quy trình là chuỗi bước công ty dùng cho từng việc…" (vi/en).
- e2e (qc, relock): P-a admin-processes/admin-editor/admin-runs/tenant-routing/process-library/flag-off, P-b editor, P-b2 support+canvas, P-d admin-stage, pm admin-cr113-flow, deployed 20-flows-visible.

## Không làm / Chạm
Không đổi hub-api, contracts, migration, engine. Danh sách workspace-web SlotCard (`slot-process-*`) giữ (bộ sửa luật cần tên quy trình); chia sẻ logic qua `@ai/web-kit`, không chia sẻ component React giữa hai app.

## Test tối thiểu
Unit: `flows-view.test.ts`, `engine-toggle.test.ts`. typecheck admin-web + workspace-web, check:bundle, openspec:check. e2e chạy MỘT lần cuối đợt (điều phối).

## Quyết định trong lúc làm
- Trang tenant: sửa luật chọn ngay trong trang (cùng `RoutingRules` với trang công ty); API vốn cho tenant_admin sửa luật của chính công ty.
- Trạng thái dòng platform: "Đang dùng" khi là quy trình đang dùng của khe hoặc có luật trỏ tới, còn lại "Tắt".
- Tên việc của khe: chỉ `contracts.approval` có nhãn ("Duyệt hợp đồng"); khe khác hiện mã khe (tenant không đọc được nhãn khe).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Một trang Quy trình cho công ty
Trang `/processes` (admin-web) liệt kê mọi quy trình công ty có, nhóm theo app; mỗi dòng: tên, khi nào chạy (việc của khe + điều kiện luật), nguồn (Platform cung cấp / Công ty tạo), trạng thái (Đang dùng / Tắt), mở sơ đồ; không có tab; lọc bằng chip app/nguồn/trạng thái.
- Kịch bản: khi tenant_admin mở trang Quy trình thì thấy một danh sách, không tab, mẫu nằm trong "Tạo quy trình" và "Chép mẫu" tạo quy trình Công ty tạo mặc định Tắt [test: e2e/P-a/pf4/admin-processes.pa.ts » E-P15a]
- Kịch bản: khi tenant đã bật app thì trang Quy trình có ≥ 1 quy trình "Platform cung cấp" [test: e2e/deployed/20-flows-visible.ro.deployed.ts » demo-owner thấy ≥ 1 quy trình]
## Việc còn lại
- Chạy e2e MỘT lần cuối đợt (điều phối): `-Step e2e -All -Filter root,P-a`.
