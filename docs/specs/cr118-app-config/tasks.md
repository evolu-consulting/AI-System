---
id: cr118-app-config
lát: cr118-app-config
cr: CR-118
làn: nhanh
migration: không
phụ thuộc: không (manifest dữ liệu `AppManifest` tự thêm tối thiểu — chưa lát nào khác có)
---
## Plan (ngắn)
Trang cấu hình MỘT app trong ai-admin (`/apps/$appKey`, chỉ platform_admin) theo intake CR-118 PHẦN C (câu 18–21, luồng F1–F4):
5 tab Tổng quan · Tính năng · Quy trình · Công ty · Xem trước. Hai cửa vào (theo app, theo công ty) dùng CHUNG một `AppCard`, một khối khe
quy trình (`TenantProcessSlots`) và một đường lưu (`useAppsTab` + `AppsSaveBar`). Xem trước là hàm thuần `previewApp` đặt trong `@ai/contracts`
(web gộp dùng lại cùng manifest để dựng menu).

## Làm
- [x] `@ai/contracts` `app-manifest/`: `AppManifest` (dữ liệu: mức ↔ feature, tính năng thêm, mục menu + hành động + điều kiện, khe quy trình), manifest `contracts` + `community`, hàm thuần `previewApp(manifest, tenantFeatures, roles, slots)` cho 3 vai (Quản trị công ty / Thành viên / Đối tác), nhận bản nháp chưa lưu.
- [x] admin-web `features/apps`: `AppDetailPage` + 5 tab; `lib/app-config.ts` (tab, nhóm app, khe, bảng công ty, cảnh báo, chặn chuyển công ty khi đang sửa dở); hooks `use-app-companies` (entitlement theo feature), `use-app-processes` (khe + thư viện CR-105), `use-company-preview`.
- [x] Gộp, không nhân đôi: `AppCard` nhận `slots`/`headerAction`; khối "Gán quy trình" dời VÀO thẻ app tương ứng (lọc khe theo tiền tố `<app>.`) ở trang công ty; ngăn tab Công ty = `TenantFeaturesTab onlyApp` (cùng thẻ, cùng thanh lưu, cùng hộp xác nhận); bản nháp báo lên trang qua `onDraft` và sống khi đổi tab.
- [x] Liên kết qua lại: `/apps` → trang app; `/features` nhóm app → "Mở cấu hình app"; thẻ app ở trang công ty → "Mở cấu hình app"; sửa quy trình luôn mở `ProcessEditorPage`, nhân bản dùng `useCloneFlow`/`CloneDialog`, đổi mặc định dùng `setSlotDefault`.
- [x] i18n `appcfg.*` (vi + en), chữ nghiệp vụ, trạng thái rỗng có hướng dẫn, key kỹ thuật mờ.

## Không làm / Chạm
- Không thêm endpoint gộp `GET /admin/apps/:key/tenants` (làn đầy đủ): tab Công ty dùng API sẵn có (số lời gọi = số feature của app, ≤ 8, không theo số công ty; tối đa 200 công ty/feature).
- Sơ đồ chỉ-đọc trong tab Quy trình là component riêng của admin-web (CSS + bảng bước, đọc `slot_body`), không import FlowCanvas của contracts-web (khác app); "Xem sơ đồ" vẫn mở `/processes/$id`. Chưa có HĐ mẫu (loại/giá trị) trong Xem trước: dùng `PreviewDialog` thư viện ở editor.
- F4 phía web gộp (Cài đặt › Ứng dụng & quy trình) thuộc lát `cr118-tenant-settings`; ở đây chỉ giữ tab chỉ-xem của tenant_admin trong ai-admin (câu 20).
- Không đổi hành vi lưu của tab công ty; không đụng DLC, không đụng frozen, không migration.

## Test tối thiểu
- unit: `packages/contracts/src/app-manifest/preview.test.ts`, `apps/admin-web/src/features/apps/lib/app-config.test.ts`.
- e2e (viết, chạy MỘT lần trên evotest job admin): `e2e/app-config.spec.ts` (F1–F4; F2 chỉ phần không-Hub vì root e2e không có Hub).

## Quyết định trong lúc làm
- Thư mục manifest tên `app-manifest/` (không phải `apps/`): luật depcruise `contracts-pure` cấm đường dẫn chứa `apps/` trong packages/contracts.
- Ngăn "Công ty" là cột bên phải (không phải overlay modal) và tab Công ty giữ mount khi đổi tab ⇒ bản nháp chưa lưu không mất khi bấm "Xem trước"; đang sửa dở thì không chuyển sang công ty khác (có thông báo).
- Thành viên: nếu công ty đã có vai cho app mà không vai nào đủ mức thì mục ẩn với lý do "chưa có vai nào đủ mức"; chưa có vai nào ⇒ theo mức công ty. Đối tác chỉ thấy mục đánh dấu `partner` (Community: Bảng tin, Bài của tôi); không bao giờ thấy khe quy trình.
- Khe chỉ "đang chạy" khi đủ mức + tính năng thêm (`contracts.approval` cần "Duyệt hợp đồng bằng quy trình"); thiếu ⇒ xem trước ghi "dùng cách duyệt mặc định cũ" và Tổng quan cảnh báo công ty đã gán quy trình riêng mà chưa bật tính năng.
- Toast lưu của tab Ứng dụng & Gói thêm câu "Công ty sẽ thấy thay đổi trong vòng 1 phút" (F1).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/cau-hinh-app.md
#### Yêu cầu: Trang cấu hình app theo 5 tab (ADM-FR-84)
Quản trị nền tảng mở một app ở `/apps/<key>` và thấy 5 phần Tổng quan, Tính năng, Quy trình, Công ty, Xem trước; sửa theo công ty và theo app dùng cùng một thẻ app, cùng khối gán quy trình trong thẻ và cùng một lần lưu. Công ty đang sửa dở không bị bỏ khi chuyển tab.
- Kịch bản: khi mở `?tab=` lạ thì trang rơi về Tổng quan và thứ tự 5 tab đúng wireframe [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » 5 tab theo thứ tự wireframe, giá trị lạ ⇒ undefined]
- Kịch bản: khi một công ty có các feature mức đọc, ghi, quản trị và tính năng thêm thì bảng Công ty hiện đúng mức cao nhất, số tính năng thêm và số người [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » mức = mức cao nhất, tính năng thêm chỉ tính khi app bật, người = max entitlement]
- Kịch bản: khi đang sửa dở một công ty thì không chuyển sang công ty khác, và bản nháp chỉ chọn được khi có nháp thật [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » đang sửa dở ⇒ không chuyển sang công ty khác, sạch ⇒ chuyển tự do]
- Kịch bản: khi app thiếu địa chỉ hoặc công ty được gán quy trình riêng nhưng chưa bật tính năng của khe thì Tổng quan cảnh báo [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » công ty được gán quy trình riêng nhưng chưa bật tính năng thêm của khe]
- Kịch bản: khi platform_admin chọn công ty ở tab Công ty, đặt mức Sửa, xem trước bản nháp rồi lưu thì bảng và trang công ty phản ánh mức Sửa [test: e2e/app-config.spec.ts » CR-118 · F1 · /apps → Sổ Hợp Tác: 5 tab, tab Công ty → acme → mức Sửa → Xem trước bản nháp (quản trị công ty thấy 'Tạo và sửa hợp đồng') → quay lại Lưu ⇒ bảng phản ánh]
- Kịch bản: khi chưa có Hub thì tab Quy trình nêu rõ chưa cấu hình và Tổng quan vẫn đếm công ty theo mức [test: e2e/app-config.spec.ts » CR-118 · F2 · tab Quy trình: không có Hub ⇒ trạng thái rỗng có hướng dẫn, tab Tổng quan nêu số công ty theo mức]
- Kịch bản: khi tenant_admin xem thẻ app ở công ty mình thì chỉ đọc, không có nút Lưu hay liên kết cấu hình, và không vào được trang cấu hình app [test: e2e/app-config.spec.ts » CR-118 · F4 · tenant_admin (binh) xem thẻ app chỉ-đọc ở trang công ty mình: không có nút Lưu/liên kết cấu hình, /apps/contracts báo chỉ dành cho quản trị nền tảng]

#### Yêu cầu: Xem trước công ty thấy gì theo vai (ADM-FR-85)
Hàm thuần `previewApp` ghép manifest dữ liệu của app, feature của công ty (bản đang lưu hoặc bản nháp chưa lưu), vai của công ty và quy trình đang gán để cho biết, với Quản trị công ty, Thành viên và Đối tác, menu nào hiện, mục nào ẩn kèm lý do, hành động nào làm được và khe quy trình nào đang chạy quy trình nào. Đối tác không bao giờ thấy nhóm Sổ Hợp Tác hay quy trình của công ty.
- Kịch bản: khi công ty có app mức Xem thì thành viên thấy Bảng tin, Bài của tôi, không thấy Duyệt bài và không có hành động đăng bài [test: packages/contracts/src/app-manifest/preview.test.ts » mức Xem: thành viên thấy Bảng tin + Bài của tôi, không thấy Duyệt bài, không có hành động Đăng bài]
- Kịch bản: khi app Tắt thì không vai nào thấy nhóm app [test: packages/contracts/src/app-manifest/preview.test.ts » app Tắt: không vai nào thấy nhóm app, lý do app_off]
- Kịch bản: khi công ty bật Sổ Hợp Tác ở mức Quản trị thì đối tác vẫn không thấy nhóm Sổ Hợp Tác và khe quy trình [test: packages/contracts/src/app-manifest/preview.test.ts » đối tác không bao giờ thấy nhóm Sổ Hợp Tác (dù công ty bật Quản trị)]
- Kịch bản: khi thiếu tính năng thêm thì hành động duyệt theo quy trình ẩn kèm tên dễ hiểu của tính năng và khe không chạy [test: packages/contracts/src/app-manifest/preview.test.ts » thiếu tính năng thêm: hành động duyệt theo quy trình ẩn, nêu tên dễ hiểu, khe không chạy]
- Kịch bản: khi bản nháp bật thêm tính năng thì khe chạy quy trình đang gán còn bản lưu thì chưa [test: packages/contracts/src/app-manifest/preview.test.ts » khe chạy khi đủ mức + tính năng thêm, kèm quy trình đang gán (bản nháp khác bản lưu cho kết quả khác)]
- Kịch bản: khi công ty đã có vai nhưng không vai nào đủ mức thì thành viên bị ẩn hành động ghi còn quản trị công ty thì không [test: packages/contracts/src/app-manifest/preview.test.ts » thành viên: công ty đã có vai nhưng không vai nào đủ mức Sửa ⇒ ẩn mục Cài đặt/hành động ghi (no_role)]
- Kịch bản: khi xem trước acme ở vai đối tác thì không có mục nào hiện, vai thành viên hiện mục theo mức và nêu lý do ẩn [test: e2e/app-config.spec.ts » CR-118 · F3 · Xem trước acme: đối tác không thấy nhóm Sổ Hợp Tác, thành viên thấy mục theo mức Sửa, 'Duyệt theo quy trình' cần tính năng thêm]

#### Yêu cầu: Khối gán quy trình nằm trong thẻ app (ADM-FR-84)
Ở tab Ứng dụng & Gói của công ty, các khe quy trình của một app hiện ngay trong thẻ app đó (không còn khối riêng cuối tab); app không có khe thì thẻ không hiện khối này.
- Kịch bản: khi lọc khe theo app thì chỉ giữ khe có tiền tố của app đó [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » lọc khe theo tiền tố app]

#### Yêu cầu: Sơ đồ và bảng bước chỉ đọc trong tab Quy trình (ADM-FR-84)
Thẻ khe hiện sơ đồ Bắt đầu → các bước → Ghi Đã duyệt (nút hệ thống khoá) và bảng bước (tên, người làm, hạn và nhắc, điều kiện) của quy trình mặc định, chỉ đọc; nút "Xem sơ đồ" vẫn mở trình soạn. Khe có dạng thân lạ thì mời mở trình soạn.
- Kịch bản: khi quy trình mặc định có bước duyệt, ký số và tự động thì bảng nêu đúng người làm, hạn, nhắc và điều kiện bằng lời [test: apps/admin-web/src/features/apps/lib/flow-view.test.ts » dạng bọc {steps}: dòng bước đủ người làm, hạn/nhắc và điều kiện bằng lời]
- Kịch bản: khi thân quy trình có dạng lạ thì không vẽ và mời mở trình soạn [test: apps/admin-web/src/features/apps/lib/flow-view.test.ts » mảng trần cũng đọc được, dạng lạ hoặc loại bước lạ ⇒ null (UI mời mở trình soạn)]

#### Yêu cầu: Danh sách quy trình lọc theo app (ADM-FR-84)
Từ thẻ khe có link tới `/processes?app=<key>`: thư viện chỉ hiện quy trình của khe thuộc app đó, có dòng nói rõ đang lọc, link về trang app và nút bỏ lọc.
- Kịch bản: khi lọc theo app thì chỉ giữ khe có tiền tố của app đó [test: apps/admin-web/src/features/apps/lib/app-config.test.ts » lọc khe theo tiền tố app]

## Việc còn lại
- e2e đã chạy MỘT lần trên evotest (`-Step e2e -Filter root`): F1, F2 xanh; F3 đỏ do selector trùng hai chỗ (đã sửa, chưa chạy lại); F4 bị bỏ qua vì serial sau F3 ⇒ chưa chạy lần nào, chạy ở lượt root cuối đợt. Đỏ mới ngoài lát (không phải của lát này): `cr052-login.spec.ts` showcase, `m4-2fa.spec.ts` D11. `tests/.lock` đã ghi lại.
- Chưa có: HĐ mẫu (loại/giá trị) trong Xem trước, endpoint gộp `GET /admin/apps/:key/tenants`. Sơ đồ nhúng + lọc `/processes?app=` cần Hub nên chỉ kiểm bằng unit + thủ công (root e2e không có Hub). Luồng F2 đầy đủ (nhân bản → sửa → xuất bản → gán) cần job có Hub.
- Cập nhật `docs/current/admin/*` (MODIFIED) khi gộp đợt.
