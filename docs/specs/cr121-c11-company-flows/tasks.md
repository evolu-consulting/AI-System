---
id: cr121-c11-company-flows
lát: cr121-c11-company-flows
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c, c9, c9b, c10, c16
---
## Plan (ngắn)
Tab "Quy trình" (key MỚI `processes`) của trang công ty = nơi DUY NHẤT gán quy trình. Artboard: `CompanyFlows.dc.html` (bảng app → việc → quy trình) + `Tpl-Detail.dc.html` (ngăn chi tiết). Spec: `docs/specs/cr121-c/spec.md` R4, Q1, Q8, Q9, Q11, D6.

## Làm
- `features/tenants/flows/**` (mới): `lib/flow-rows.ts` (hàng việc, trạng thái + lý do, nhóm app, `withDefault`), `api.ts`, hooks `use-company-flows` (1 đọc năng lực + luật theo việc + thân quy trình đang dùng), `use-flow-assign`, components `CompanyFlowsTab` · `JobRow` · `StepChips` · `FlowDrawer` · `DrawerSteps` (canvas/danh sách + Sao chép/Mở trình sửa) · `DrawerAssign` · `DrawerRunning`.
- Chuyển `SlotRouting`/`RoutingRules`/`useSlotRoutingActions`/`slot-candidates` về `tenants/flows/**`; gỡ `TenantProcessSlots` + `use-tenant-slots` (không còn ai đọc).
- `features/processes/lib/view-mode.ts` (+ hook `use-view-mode`): canvas mặc định, khoá `processView`, lỗi ⇒ canvas. `FlowRowsView` thêm prop `view` (canvas | list; vắng = cả hai như cũ).
- Tab: `workspace-tabs.ts` thêm `processes` (platform_admin + tenant_admin), nhãn `tenants.tab.processes`; i18n `tenants.flows.*` vi+en.
- e2e: viết `e2e/cr121-c-flows.spec.ts` (D5, không chạy); sửa gán qua tab Quy trình: `_kit/ui.ts` (`openJobDrawer`), `journey-approval/_journey.ts` (`openProcessPanel`, thay `processBlock`/`openContractsCard`), `cr121-d-journey.spec.ts`, `cr121-d6b-notify.spec.ts`, `community-web/flows.cs.ts`, `P-a/pf4/tenant-routing.pa.ts`.

## Không làm / Chạm
Không: Ứng dụng (c12), gỡ chỗ gán 3/4 (c13: tab Quy trình + ngăn Công ty của `/apps/$appKey`, `flowsMode`), 5 tab (c14), API hub-api. `AppCard` còn prop `slots` không ai truyền (c12 gỡ).

## Test tối thiểu
- unit: `tenants/flows/lib/flow-rows.test.ts` (hàng việc, tắt + lý do, nhóm/tóm tắt, đổi mặc định), `processes/lib/view-mode.test.ts`, `tenants/lib/workspace-tabs.test.ts` (tab `processes`).
- e2e (viết, chưa chạy): `e2e/cr121-c-flows.spec.ts`.

## Quyết định trong lúc làm
- Trạng thái "Đang tắt" lấy lý do từ `active=false`/không có quy trình (`chưa gán quy trình`), `unavailable` của luật mặc định (`đã bị xoá` / `chưa xuất bản`).
- Phân biệt bản thư viện / bản riêng bằng `GET /tenants/:tid/process-library/:id` (422 `NOT_LIBRARY_DEF` ⇒ bản riêng ⇒ sửa thẳng); thân/ chip bước đọc qua `process-routing/:slot/processes/:defId` (cả hai vai).
- tenant_admin Đổi = PUT luật (đổi luật Mặc định trong tập quy trình công ty đã có, gồm bản sao); platform_admin dùng `SlotRouting` cũ (gán thư viện, bỏ gán, luật) trong ngăn.
- Perf: số lần gọi = 1 (năng lực) + số việc đăng ký (luật) + số việc có quy trình (thân quy trình, PK read); lượt đang chạy chỉ gọi khi mở ngăn (1 lần theo việc). Không chạm đường nóng.

## Khác biệt so với artboard (chưa chụp ảnh — điều phối chụp ở UAT)
- Chip bước hiện TÊN bước nối mũi tên, tối đa 4 + `+N` (tooltip đủ); chưa có icon theo loại bước.
- Nút chế độ xem dùng lucide `Network`/`List` + nhãn/tooltip Sơ đồ/Danh sách.
- Luật định tuyến: bảng ĐỌC (điều kiện bằng lời nghiệp vụ → quy trình, thứ tự, dòng Mặc định cuối) + nút `Sửa luật` mở form `RoutingRules` cũ. Còn khác: chưa kéo-thả đổi thứ tự trên bảng, chưa chip bước trong cột quy trình của bảng luật, sửa vẫn bằng form.
- `Đang chạy` nằm trong ngăn của việc; tóm tắt lượt chạy chưa có nhãn bản ghi (HĐ) ⇒ hiện tên việc + giờ bắt đầu + bước hiện tại + người gửi (không id thô). Còn thiếu: mã HĐ — cần API thêm `record_label` vào tóm tắt lượt chạy.
- Ngăn dùng `DetailDrawer` chung; dòng tóm tắt "x/y việc có quy trình" đặt trong tab (khung công ty chung ở c14).
- Bản thư viện chỉ xem: sơ đồ + ghi chú + nút "Sao chép cho công ty này"; trang trình sửa chỉ-xem đầy đủ để c17.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/cong-ty-quy-trinh.md
#### Yêu cầu: Tab Quy trình của công ty là nơi duy nhất gán quy trình
Trang công ty có tab "Quy trình" liệt kê theo ứng dụng → việc → quy trình đang gán (chip bước, Đang bật/Đang tắt kèm lý do, số luật, nút Đổi/Gán); việc chưa gán hiện "Đang tắt · chưa gán quy trình"; gán xong là "Đang bật" ngay, không công tắc nào khác. Quản trị nền tảng và quản trị công ty (công ty mình) đều thấy tab.
- Kịch bản: việc chưa gán ⇒ Đang tắt kèm lý do chưa gán quy trình; có quy trình ⇒ Đang bật; mặc định đã xoá/chưa xuất bản ⇒ tắt với lý do tương ứng [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » jobOf]
- Kịch bản: việc xếp theo ứng dụng (Hợp đồng trước), số luật không tính Mặc định, tóm tắt "x/y việc có quy trình" [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » groupJobs / summaryOf]
- Kịch bản: quản trị công ty đổi quy trình mặc định trong tập quy trình công ty, luật điều kiện giữ nguyên [test: apps/admin-web/src/features/tenants/flows/lib/flow-rows.test.ts » withDefault (tenant_admin đổi quy trình)]
- Kịch bản: tab `processes` có cho platform_admin và tenant_admin [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts » tenant_admin thấy profile/features/processes]
- Kịch bản: platform_admin gán từ đầu rồi tenant_admin Sao chép + Đổi (hành trình thật) [test: e2e/cr121-c-flows.spec.ts » tenant_admin công ty mình: bản thư viện chỉ xem]

#### Yêu cầu: Xem quy trình mặc định dạng sơ đồ và nhớ lựa chọn
Chỗ xem quy trình mở ở chế độ sơ đồ (canvas); danh sách bước là chế độ phụ, nhớ theo trình duyệt; không đọc được bộ nhớ thì về sơ đồ.
- Kịch bản: chưa lưu/giá trị lạ/lỗi lưu trữ ⇒ canvas; chọn danh sách ⇒ đọc lại ra danh sách [test: apps/admin-web/src/features/processes/lib/view-mode.test.ts » nhớ lựa chọn danh sách rồi đọc lại]

### MODIFIED admin/cau-hinh-app.md
#### Yêu cầu: Khối gán quy trình nằm trong thẻ app (ADM-FR-84) (nguồn: cr118-app-config)
Thẻ app ở tab Ứng dụng của công ty không còn khối gán quy trình; gán quy trình cho công ty chỉ làm ở tab Quy trình (một nơi duy nhất). Chỗ gán ở tab Quy trình và ngăn Công ty của trang app gỡ ở c13.
- Kịch bản: khi mở thẻ app ở tab Ứng dụng thì không còn khối gán quy trình, việc gán nằm ở tab Quy trình của công ty [test: e2e/cr121-c-flows.spec.ts » platform_admin gán từ đầu]

## Việc còn lại
- Chỗ đọc `TenantProcessSlots` (đã gỡ hết): `TenantFeaturesTab.tsx` (import + prop `slots`); chỉ còn nhắc trong comment `apps/pages/AppDetailPage.tsx:2`. Chỗ gán cũ còn lại tạm: `processes/components/flows/RulesPanel.tsx` (import `RoutingRules` vị trí mới), tab Quy trình + ngăn Công ty `/apps/$appKey`, `flowsMode` — gỡ ở c13.
- c12: bỏ prop `slots` của `AppCard`; c13: dọn comment AppDetailPage.
- Bẫy: `GET /process-runs?slot=` trả lượt theo snapshot (lượt trước CR-118 không lọt); tóm tắt lượt chạy chưa có nhãn HĐ.
