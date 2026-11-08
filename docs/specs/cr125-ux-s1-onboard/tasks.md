---
id: cr125-ux-s1-onboard
lát: cr125-ux-s1-onboard
cr: CR-125
làn: đầy đủ (phần quyền: Sonnet viết, Opus low soát diff vai)
migration: không
phụ thuộc:
---
## Plan (ngắn)
Nguồn: `docs/specs/CR-125/ux-review-ceo.md` C1, H3 và ý "Xem lại = danh sách việc thiếu".
- C1: bật app cho công ty bằng đường platform (`PUT /tenants/:id/packs/:k`, đường mà wizard bước 2 dùng) tự cho MỌI `tenant_admin` nội bộ của công ty vào Group Chủ gói `<k>-owner` (một câu SQL, idempotent). Người dùng thường không bao giờ được thêm. Bước Phân quyền bỏ qua được vì quản trị đã có quyền.
- Xem lại: `reviewChecklist` (luật thuần) → danh sách "Việc còn thiếu" với nút "Sửa": chưa bật app · app chưa ai có vai · chưa có người dùng ngoài quản trị · việc quy trình đang tắt (cùng nguồn dải "Cần xử lý").
- H3 (một phần): trong wizard, nút "Gán" của dải "Cần xử lý" mở hộp chọn mẫu ngay tại bước (dùng `AssignFlow` có kiểm "dùng được chưa" của template-readiness), không thoát sang tab Quy trình.

## Làm
- `packs.repo.addTenantAdminsToOwner` + `enablePack(…, { grantTenantAdmins })` (route bật cờ; importer/CLI giữ hành vi cũ).
- `lib/review-checklist.ts`, `ReviewChecklist.tsx`, `AssignFlowDialog.tsx`; `TenantFeaturesTab` nhận `inWizard`.
- i18n vi/en: `tenants.wizard.todo.*`, `peopleHint`, `companyFlows.assign.dialog*`.

## Không làm / Chạm
- Không đụng workspace-web (S2), canvas (S3), DLC.
- H3 chưa làm: lọc mẫu theo app/ẩn quy trình nội bộ khỏi danh sách chọn; sửa chữ "Chưa áp dụng… nhờ quản trị nền tảng" khi người xem là platform; "2/2 on" → "Đã bật 0/2 quy trình" (hàng chờ).
- `tenant-onboard` CLI (seed-niti) không tự thêm quản trị vào Chủ gói (đã có bước gán vai riêng).

## Test tối thiểu
- unit: `lib/review-checklist.test.ts`.
- int (quyền, viết trước): `modules/packs/packs.first-admin.int.test.ts` — quản trị vào Chủ gói, người thường không, công ty khác không, lặp lại không nhân đôi, không bật tuỳ chọn ⇒ hành vi cũ.
- e2e hành trình thật: `e2e/journey-approval/cr125-s1-onboard.spec.ts`.

## Quyết định trong lúc làm
- Đặt việc thêm quản trị trong `enablePack` (một nguồn, mọi đường bật gói của platform) thay vì chỉ trong wizard; tuỳ chọn mặc định tắt để importer/CLI/test cũ không đổi.
- Chỉ `role = 'tenant_admin'` và `kind = 'internal'`; vai Chủ gói = mức Quản trị, mức dùng thực tế vẫn bị trần công ty (entitlement) chặn như mọi vai.
- Không chặn nút Hoàn tất: danh sách thiếu chỉ nhắc (quản trị đã dùng được ngay).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/onboarding-cong-ty.md
#### Yêu cầu: Quản trị công ty đầu tiên dùng được mọi app đã bật ngay sau onboarding
Khi platform bật một app cho công ty (bước Ứng dụng của wizard), mọi quản trị công ty nội bộ của công ty đó tự vào vai Chủ gói của app; người dùng thường không được thêm. Bỏ qua bước Phân quyền không làm quản trị mất quyền.
- Kịch bản: khi platform bật app `pkdemo` cho công ty có quản trị `admin-a` và người dùng `lan` thì `admin-a` ở nhóm Chủ gói với đủ 3 mã gói còn `lan` không có vai nào [test: apps/admin-api/src/modules/packs/packs.first-admin.int.test.ts » C1 · bật app bằng đường wizard]
- Kịch bản: khi công ty B bật app thì quản trị công ty A không bị đổi [test: apps/admin-api/src/modules/packs/packs.first-admin.int.test.ts » C1 · công ty B bật app]
- Kịch bản: khi platform lập công ty mới, bật Sổ Hợp Tác, bỏ qua bước Phân quyền thì quản trị công ty vào Sổ Hợp Tác thấy danh sách hợp đồng, không gặp "chưa có quyền dùng gói Hợp đồng" [test: e2e/journey-approval/cr125-s1-onboard.spec.ts » platform admin lập công ty]

#### Yêu cầu: Bước Xem lại liệt kê việc còn thiếu kèm nút Sửa
Bước Xem lại của wizard hiện danh sách: chưa bật app nào; app chưa ai có vai; chưa có người dùng ngoài quản trị công ty; việc quy trình đang tắt của app đang dùng. Mỗi mục có liên kết "Sửa" tới đúng bước/tab. Không còn mục thì hiện "Công ty dùng được ngay".
- Kịch bản: khi chưa bật app thì chỉ có mục "chưa bật ứng dụng"; khi app đã bật mà chưa ai có vai thì có mục theo app đó; đủ trọn thì danh sách rỗng [test: apps/admin-web/src/features/tenants/lib/review-checklist.test.ts » reviewChecklist]
- Kịch bản: khi quản trị vừa lập công ty và bỏ qua phân quyền thì Xem lại báo chưa có người dùng khác nhưng không báo "chưa ai có vai" [test: e2e/journey-approval/cr125-s1-onboard.spec.ts » platform admin lập công ty]

#### Yêu cầu: Gán quy trình ngay trong wizard
Trong wizard, nút "Gán" ở dải "Cần xử lý" mở hộp chọn quy trình Thư viện (kèm kiểm dùng được ở công ty chưa) và gán xong ở lại bước, không thoát sang tab Quy trình.
- Kịch bản: khi bấm "Gán" trong wizard thì hộp "Gán quy trình cho công ty" mở tại bước [test: thủ công — UI hộp thoại tái dùng AssignFlow đã có e2e ở cr122-flows]

## Việc còn lại
- H3 phần còn lại (lọc mẫu theo app, ẩn quy trình nội bộ, chữ "nhờ quản trị nền tảng", "2/2 on").
- Opus low soát diff vai: `packs.repo.ts` (`addTenantAdminsToOwner`), `packs.service.ts`, `packs.routes.ts`.
