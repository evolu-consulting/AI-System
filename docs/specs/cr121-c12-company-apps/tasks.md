---
id: cr121-c12-company-apps
lát: cr121-c12-company-apps
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c, c11, c18
---
## Plan (ngắn)
Tab "Ứng dụng" của công ty: BẢNG thay lưới `AppCard`. Artboard `Company.dc.html` (tab Ứng dụng + 4 ô số) + ghi chú người dùng (chữ tràn khi thu gọn; "Quản trị/Xem/Sửa" khó hiểu). Spec: `docs/specs/cr121-c/spec.md` R3, Q3, Q4, Q5.

## Làm
- `features/tenants/apps/**` (mới): `lib/apps-table.ts` (`isAppOn`, `flowCounts` "x bật · y tắt", `attentionOf`, `rowStatus` + lý do), components `AppsTable` (+ `AttentionStrip`, `StatTiles`), `AppRow`, `LevelControl` (chuyển từ `components/features`; nhãn `truncate` + `title`) + `LevelHelp` ⓘ.
- `TenantFeaturesTab` viết lại thành bảng: Ứng dụng · Quyền truy cập · Trạng thái (+ lý do) · Thành viên · Quy trình (link sang tab Quy trình); chi tiết (tính năng thêm + gói/vai/đối tác) mở dưới hàng. Giữ đường lưu một lượt, hộp xác nhận, `onlyApp`/`onDraft` (trang app, gỡ ở c13) và wizard.
- Dải "Cần xử lý": việc đang tắt của app đang bật; nút Gán ⇒ `?tab=processes&job=<việc>` mở ngăn Gán ở tab Quy trình (`CompanyFlowsTab initialJob`, `WorkspaceSearch.job`). Không bật tại dải.
- 4 ô số chỉ xem (Người dùng · Ứng dụng đang bật x / y · Chạy cùng lúc · Gói) + nút "Mở Quy trình".
- Gỡ: `AppCard` (+ prop `slots`), khoá thô `f.key` trong `AddonList`, lối tắt "Mở cấu hình app" trong thẻ. Khối Mã/Múi giờ/Chạy cùng lúc/Gói trùng: không còn ở tab Ứng dụng (chỉ ở tab Cài đặt). App đọc từ cột `app` (`groupByApp`, c18).
- i18n `tenants.apps.*` vi+en (`levelHelp`, `col`, `status`, `reason`, `tile`, …); nhãn mức dùng lại `tenants.features.level.*`.

## Không làm / Chạm
Không: gỡ chỗ gán 3/4 và `/apps/$appKey` (c13), 5 tab (c14). Không đổi API.

## Test tối thiểu
- unit: `tenants/apps/components/LevelControl.test.tsx` (cắt + tooltip, khoá mức, ⓘ), `tenants/apps/lib/apps-table.test.ts` ("x bật · y tắt", Cần xử lý, trạng thái + lý do).
- e2e (qc sửa, không chạy): `e2e/app-config.spec.ts`, `e2e/feature-ui.spec.ts` (hàng `apps-row-<app>`, radio mức, "Chi tiết").

## Quyết định trong lúc làm
- Trạng thái hàng: Cơ bản "Đang bật · luôn bật"; app Tắt "Đang tắt · quyền truy cập đang Tắt"; quyền không chuẩn "Quyền không chuẩn"; còn việc chưa gán quy trình "Cần xử lý · <việc> chưa bật".
- "Gói" ở ô số = hạn mức lượt/tháng của công ty (hoặc "Không giới hạn"); hệ thống chưa có khái niệm gói thương mại riêng.
- Số lần gọi thêm: dùng lại dữ liệu tab Quy trình (năng lực + luật theo việc, đã cache chung) và tổng quan; không truy vấn theo hàng.

## Khác biệt so với artboard (chưa chụp ảnh — điều phối chụp ở UAT)
- Cột Thành viên hiện SỐ thành viên (không có chip avatar).
- Dải Cần xử lý: nút "Gán" mở ngăn Gán (đúng Q5); artboard cũ ghi "Bật" tại dải, đã thay theo quyết định Q5; chưa có "Hoàn tác".
- 4 ô số nằm dưới bảng cùng tab Ứng dụng (artboard để ở tab Tổng quan, spec R3 yêu cầu dưới bảng); không có thanh tiến độ nhỏ.
- Chi tiết mở dưới hàng ("Chi tiết") chứa tính năng thêm + thông tin gói; artboard không có (giữ để không mất chức năng).
- ⓘ giải nghĩa mức đặt ở tiêu đề cột "Quyền truy cập" bằng tooltip `title`.
- Bỏ lối tắt "Mở cấu hình app" (c13 xử lý `/apps/$appKey`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED admin/cau-hinh-app.md
#### Yêu cầu: Khối gán quy trình nằm trong thẻ app (ADM-FR-84) (nguồn: cr118-app-config)
Tab Ứng dụng của công ty là bảng mỗi hàng một ứng dụng (Quyền truy cập, Trạng thái kèm lý do, Thành viên, Quy trình "x bật · y tắt"); không còn thẻ app và khối gán quy trình. Dải "Cần xử lý" mở ngăn Gán ở tab Quy trình; nhãn mức không tràn khi thu gọn (cắt + tooltip) và có ⓘ giải nghĩa.
- Kịch bản: nhãn mức cắt chữ và có tooltip đầy đủ, ⓘ nêu Xem = chỉ đọc · Sửa = tạo và sửa · Quản trị = thêm cài đặt app và người dùng [test: apps/admin-web/src/features/tenants/apps/components/LevelControl.test.tsx » mỗi mức cắt chữ (truncate) và có tooltip đầy đủ (title), không tràn khi thu gọn]
- Kịch bản: cột Quy trình ghi "x bật · y tắt" theo app [test: apps/admin-web/src/features/tenants/apps/lib/apps-table.test.ts » flowCounts]
- Kịch bản: Community chưa gán Duyệt bài ⇒ dải Cần xử lý 1 dòng, app tắt thì ẩn, gán xong thì hết [test: apps/admin-web/src/features/tenants/apps/lib/apps-table.test.ts » attentionOf (dải Cần xử lý, Q5)]
- Kịch bản: trạng thái hàng kèm lý do (luôn bật, đang tắt, quyền không chuẩn, việc chưa bật) [test: apps/admin-web/src/features/tenants/apps/lib/apps-table.test.ts » rowStatus]
- Kịch bản: bảng ứng dụng đổi mức và lưu một lượt như trước [test: e2e/feature-ui.spec.ts » CR-112 · tab Ứng dụng & Gói của acme]

## Việc còn lại
- c13: gỡ `onlyApp`/`onDraft` khi bỏ ngăn Công ty của `/apps/$appKey`; dọn comment AppDetailPage.
- Cột Thành viên chip avatar, "Hoàn tác" ở dải Cần xử lý: chưa làm.
