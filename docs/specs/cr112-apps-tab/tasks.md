---
id: cr112-apps-tab
lát: cr112-apps-tab
cr: CR-112
fr: ADM-FR-78
làn: nhanh
migration: không
phụ thuộc: cr112-app-roles (GET packs role_count/member_count, GET app-roles), CR-111
---
## Plan (ngắn)
Gộp tab Feature (CR-111) + tab Gói thành MỘT tab "Ứng dụng & Gói" (cùng file `components/features/TenantFeaturesTab.tsx` để workspace không đổi import).
Mỗi app một thẻ CR-111; thanh mức Tắt/Xem/Sửa/Quản trị điều khiển CẢ gói (endpoint packs có sẵn) lẫn entitlement (PUT/DELETE từng feature có sẵn), một nút Lưu, một hộp xác nhận.
Luật thuần `lib/apps-plan.ts`: `planChanges` (ý định gói theo app + diff entitlement) và `runPlan` (phase: bật gói → cấp/thu hồi → tắt gói; dừng ở phase lỗi đầu tiên, báo số bước đã áp dụng).

## Làm
- [x] `lib/apps-plan.ts` + `apps-confirm.ts` (cảnh báo tắt gói kèm số người, danh sách thu hồi theo tên) + test đơn vị.
- [x] `hooks/use-apps-tab.ts`, `api-apps.ts` (GET app-roles), thẻ có dòng gói: trạng thái gói · số vai · số người · "n vai không hiệu lực" (tính theo mức đang chọn) · lối tắt "Phân quyền" (`?tab=access`); cảnh báo Community (đối tác); ghi chú Knowledge.
- [x] tenant_admin: chỉ xem (khoá điều khiển, ẩn thanh lưu); khối quy trình (slot) giữ như tab Gói cũ.
- [x] Gỡ tab Gói (`TenantPacksTab`, `use-tenant-packs`); `?tab=packs` chuyển về tab gộp (`activeTab`). Nhãn tab "Ứng dụng & Gói".
- [x] e2e: `feature-ui.spec.ts`, `tenant-packs.spec.ts` (+ `support/fake-packs.ts`) — chạy xanh.

## Không làm / Chạm
Không đổi API/contract/migration. Không đụng nav/route (chỉ gỡ `packs` khỏi danh sách tab + 1 dòng chuyển hướng trong `workspace-tabs.ts`, bỏ `TabsContent packs` trong `TenantDetailPage`).
`tenants.spec.ts:114` (tab "Feature" → "Chưa khả dụng") và `e2e/stg/smoke.stg.ts` đã lỗi thời từ CR-111/nav — thuộc lát nav.

## Test tối thiểu
- unit `apps/admin-web/src/features/tenants/lib/apps-plan.test.ts`, `workspace-tabs.test.ts`
- e2e `e2e/feature-ui.spec.ts`, `e2e/tenant-packs.spec.ts`

## Quyết định trong lúc làm
- Bật gói (server) tự cấp cả 3 entitlement mức ⇒ khi chọn mức < Quản trị lúc bật gói, kế hoạch thu hồi phần thừa SAU khi bật; cấp luôn theo trạng thái thật (PUT idempotent) nên không phụ thuộc gói có tự cấp hay không. Phần thu hồi "ảo" không đưa vào hộp xác nhận.
- Gói chỉ đổi theo "ý định" ghi khi người dùng bấm mức (về đúng mức ban đầu ⇒ bỏ ý định): bộ cũ có quyền mà gói chưa bật không tự bật gói khi chỉ mở tab; thử lại sau lỗi từng phần vẫn đúng.
- Lỗi từng phần: dừng ở phase lỗi; entitlement lỗi ⇒ KHÔNG tắt gói (người dùng chưa mất quyền); bản nháp giữ để Lưu lại tiếp.
- "Không hiệu lực" tính phía client từ danh sách vai (≤ 500) theo mức đang chọn (xem trước khi lưu).
- Community: luôn nhắc kiểm cách ly đối tác khi bật; thêm câu về số đối tác khi mức < Sửa (đối tác giữ 2 mức tĩnh).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED admin/ghi-chu.md
#### Yêu cầu: Tab Ứng dụng & Gói hợp nhất (Feature + Gói)
Chi tiết công ty có một tab "Ứng dụng & Gói": mỗi app một thẻ chọn mức Tắt/Xem/Sửa/Quản trị. Tắt ⇒ tắt gói; mức khác ⇒ bật gói + cấp entitlement theo mức (trần công ty). Lưu một lượt theo thứ tự bật gói → cấp/thu hồi → tắt gói; tắt gói hoặc thu hồi ⇒ hộp xác nhận nêu số người mất quyền và liệt kê quyền thu hồi. Thẻ hiện số vai, số người, số vai không hiệu lực và lối tắt Phân quyền; bật Community hiện cảnh báo đối tác. tenant_admin chỉ xem. Tab Gói cũ không còn, URL `?tab=packs` mở tab gộp.
- Kịch bản: khi đặt mức Sửa cho app chưa bật gói thì kế hoạch bật gói, cấp Xem+Sửa và thu hồi mức Quản trị thừa do gói cấp sẵn [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts]
- Kịch bản: khi đặt Tắt thì kế hoạch tắt gói và thu hồi mức + tính năng thêm [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » AC2: Sửa → Tắt ⇒ tắt gói, thu hồi mức và tính năng thêm]
- Kịch bản: khi chạy kế hoạch thì bật gói trước khi cấp và thu hồi trước khi tắt gói [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » bật gói TRƯỚC khi cấp, thu hồi TRƯỚC khi tắt gói]
- Kịch bản: khi entitlement lỗi giữa chừng thì không tắt gói và báo các bước đã áp dụng [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » entitlement lỗi ⇒ gói đã bật được ghi nhận, KHÔNG tắt gói (người dùng chưa mất quyền)]
- Kịch bản: khi tắt gói thì hộp xác nhận cảnh báo mất quyền kèm số người [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » tắt gói ⇒ cảnh báo mất quyền kèm số người + liệt kê thu hồi theo tên]
- Kịch bản: khi mức công ty hạ thì vai có mức cao hơn được đếm là không hiệu lực [test: apps/admin-web/src/features/tenants/lib/apps-plan.test.ts » mức Sửa ⇒ vai Quản trị không hiệu lực, Tắt ⇒ mọi vai, app khác không lẫn]
- Kịch bản: khi platform_admin chọn Sửa rồi Tắt ở tab thì gói bật rồi tắt có xác nhận và entitlement khớp [test: e2e/tenant-packs.spec.ts » ADM-FR-78 · đặt mức Sửa ⇒ bật gói + entitlement Xem/Sửa (gỡ mức Quản trị do gói cấp sẵn), Tắt ⇒ hỏi xác nhận rồi tắt gói]
- Kịch bản: khi mở ?tab=packs thì tab Ứng dụng & Gói được chọn và không còn tab Gói [test: e2e/feature-ui.spec.ts » CR-112 · URL cũ ?tab=packs mở tab Ứng dụng & Gói, tab Gói không còn]
- Kịch bản: khi tenant_admin mở workspace thì không thấy tab Gói trong danh sách [test: apps/admin-web/src/features/tenants/lib/workspace-tabs.test.ts]

## Việc còn lại
- Cắm tab vào `visibleTabs` của tenant_admin (read-only đã sẵn trong component) do lát nav quyết định; nếu tab key Phân quyền khác `access` thì sửa hằng `ACCESS_TAB`.
- Gộp nhãn i18n `tenants.tab.features` / bỏ `tenants.tab.packs` khi merge với nav (conflict nhỏ ở vi/en.json, workspace-tabs.ts, TenantDetailPage.tsx).
- `e2e/tenants.spec.ts:114` và `e2e/stg/smoke.stg.ts:164` còn gọi tab "Feature".
