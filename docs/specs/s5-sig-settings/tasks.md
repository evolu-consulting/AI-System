---
id: s5-sig-settings
lát: s5-sig-settings
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s2-sig-api, s3-sig-create, s4-sig-gate
---
## Plan (ngắn)
Mục «Chữ ký» trong nhóm mới «Chung» của hộp thoại Cài đặt (khoá `signature`): form định dạng 6 thiết lập + công tắc «Ký trên tài liệu», xem trước, thẻ «Chữ ký số» khoá, khối «Yêu cầu đổi chữ ký». Mọi thành viên xem; chỉ quản trị (`can_edit` từ API, Q15) sửa.

## Làm
- [x] `features/settings/api-signature.ts` + `hooks/use-signature-settings.ts`: GET/PUT `/company/signature-settings`, GET `/company/signature-change-requests`, POST `/company/signature-change-grants`.
- [x] `lib/signature-form.ts` (bật/tắt cách tạo, chặn bỏ hết, thân PUT đúng schema) · `components/SignaturePane.tsx` · `SignatureOptions.tsx` · `SignatureAside.tsx` (xem trước, chữ ký số, yêu cầu đổi).
- [x] Nối `SectionId`/`SettingsNavId` + `navFromKey`/`pickNav` + nhóm «Chung» trong `SettingsNav` + `SettingsBody`; `/settings/signature` → `/contracts/settings?sec=signature` (legacy-routes).
- [x] i18n `contracts.settings.signature.*`, `group.common`, `sec.signature*` (vi + en).
- [x] e2e viết (chưa chạy): `e2e/cr181/signature-settings.spec.ts`.

## Không làm / Chạm
Không làm Quy trình duyệt / Kết nối (đợt 2), màn ký. Chạm: apps/workspace-web (settings, legacy-routes), packages/i18n/locales/contracts/v2l.*, e2e/cr181.

## Test tối thiểu
`bun test apps/workspace-web/src/features/settings apps/workspace-web/src/features/my-signature`

## Quyết định trong lúc làm
- Hộp thoại Cài đặt mở bằng cơ chế sẵn có `?sec=`: `/settings/signature` (đích của chuông) được chuyển hướng sang `/contracts/settings?sec=signature` qua `LEGACY_EXACT`, không thêm route mới.
- Nhóm «Chung» luôn có ⇒ mọi nhóm trong menu đều có tiêu đề (trước đây chỉ khi có hai nhóm). `pickNav("signature")` không phụ thuộc gói/quyền chủ sở hữu.
- Mục tự lưu bằng «Lưu định dạng» (không dùng thanh Lưu chung). Công tắc «Ký trên tài liệu» nằm cùng bản nháp; bật ⇒ hộp xác nhận, chỉ ghi khi bấm «Lưu định dạng»; tắt ⇒ không hỏi.
- Quyền sửa lấy từ `can_edit` của API, không từ `owner` của pack. Khối yêu cầu đổi chỉ gọi API khi `can_edit`, ẩn khi không có yêu cầu chưa cho phép.
- Nút «Bật chữ ký số» luôn khoá (Q12, đợt 1).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED hub/chu-ky.md
#### Yêu cầu: Định dạng chữ ký nội bộ do quản trị công ty cấu hình
Sáu thiết lập: cách tạo được phép (ít nhất một), tạo lần đầu (bắt buộc / cho «Làm sau»), dòng dưới chữ ký, màu mực, chữ ký nháy, đổi chữ ký. Công tắc «Ký trên tài liệu» có hộp xác nhận khi bật. Đổi chỉ áp dụng cho lần ký sau.
- Kịch bản: khi bỏ hết cách tạo thì bị chặn và giữ nguyên [test: apps/workspace-web/src/features/settings/signature-settings.test.tsx » bỏ hết cách tạo ⇒ bị chặn, giữ nguyên]
- Kịch bản: khi lưu thì thân PUT đúng schema chữ ký [test: apps/workspace-web/src/features/settings/signature-settings.test.tsx » đúng schema strict, đủ khoá]
- Kịch bản: quản trị bật ký trên tài liệu, đổi màu mực rồi lưu [test: e2e/cr181/signature-settings.spec.ts » Quản trị bật ký trên tài liệu, đổi màu mực, lưu]

#### Yêu cầu: Chỉ quản trị sửa, mọi thành viên xem
- Kịch bản: khi là người thường thì form khoá kèm câu «Chỉ quản trị công ty sửa» [test: apps/workspace-web/src/features/settings/signature-settings.test.tsx » form khoá + câu «Chỉ quản trị công ty sửa»]
- Kịch bản: nhân viên thấy form khoá ở màn thật [test: e2e/cr181/signature-settings.spec.ts » Nhân viên thấy form khoá «Chỉ quản trị công ty sửa»]

#### Yêu cầu: Chữ ký số chưa bật
- Kịch bản: thẻ «Chữ ký số» có huy hiệu «Chưa bật» và nút «Bật chữ ký số» khoá [test: apps/workspace-web/src/features/settings/signature-settings.test.tsx » huy hiệu «Chưa bật» + nút khoá]

#### Yêu cầu: Yêu cầu đổi chữ ký
Khối chỉ quản trị thấy, chỉ hiện khi có yêu cầu chưa cho phép: người, lúc, nút «Cho phép». URL `/settings/signature` mở thẳng mục này.
- Kịch bản: khi có yêu cầu thì quản trị thấy tên và nút «Cho phép» [test: apps/workspace-web/src/features/settings/signature-settings.test.tsx » quản trị thấy tên + nút «Cho phép»]
- Kịch bản: người thường không thấy khối yêu cầu [test: apps/workspace-web/src/features/settings/signature-settings.test.tsx » người thường không thấy khối]

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Nhóm «Chung» trong hộp thoại Cài đặt
Hộp thoại Cài đặt có thêm nhóm «Chung» với mục «Chữ ký» (khoá `signature`), mọi thành viên thấy kể cả không phải chủ sở hữu hợp đồng; các mục Sổ Hợp Tác giữ nguyên quyền.
- Kịch bản: khi mở Cài đặt thì nhóm «Chung» có mục «Chữ ký» với mọi vai [test: apps/workspace-web/src/features/settings/signature-settings.test.tsx » có mục «Chữ ký», mọi thành viên thấy (kể cả không phải chủ sở hữu)]
- Kịch bản: khoá signature mở thẳng mục và không phụ thuộc quyền [test: apps/workspace-web/src/features/settings/signature-settings.test.tsx » khoá signature mở thẳng mục, không phụ thuộc quyền]

## Việc còn lại
- Chạy e2e `e2e/cr181/signature-settings.spec.ts` cuối đợt; soát UI thủ công (form 2 cột, 390px).
