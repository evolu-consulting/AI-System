---
id: s4-sig-gate
lát: s4-sig-gate
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s2-sig-api, s3-sig-create
---
## Plan (ngắn)
Màn chặn «Tạo chữ ký của bạn» trước app (một chỗ chung: ShellFeatured) + trang «Chữ ký của tôi» + mục menu. Dùng `SignatureCreator` (s3) và API `/me/signature` (s2).

## Làm
- [x] `features/my-signature/api.ts` + `hooks/use-my-signature.ts`: GET/POST `/me/signature`, POST `/me/signature/change-request`.
- [x] `lib/gate.ts` (luật chặn thuần) · `components/CreateFlow.tsx` (chính ⇒ chữ ký tắt nếu `initials = own`) · `components/FirstLoginGate.tsx` (màn chặn; API lỗi ⇒ cho vào + log; «Làm sau» nhớ trong phiên, chỉ khi không bắt buộc).
- [x] Gắn vào `pack-state/pages/ShellFeatured.tsx` (mọi module qua; bản mock/dev bỏ qua).
- [x] Trang `/my-signature` (`routes/_authed/my-signature.tsx`, `pages/MySignaturePage.tsx`, `components/MySignatureCards.tsx`): thẻ đang dùng, lịch sử, chữ ký tắt, hộp thoại «Tạo chữ ký mới», khoá + «Xin đổi chữ ký», thẻ «Chữ ký số» (Q12).
- [x] Mục menu «Chữ ký của tôi» (`MySignatureMenuItem` trong `UserMenu`), chỉ khi công ty bật.
- [x] i18n `contracts.mySig.gate.*` / `page.*` (vi + en); `SignatureCreator` thêm prop `saveLabel`.
- [x] e2e viết (chưa chạy): `e2e/cr181/first-login-signature.spec.ts`.

## Không làm / Chạm
Không làm Cài đặt › Chữ ký và trang cho phép đổi (s5), màn ký. Chạm: apps/workspace-web, packages/i18n/locales, routeTree.gen.ts (sửa tay: không có `tsr`), e2e/cr181.

## Test tối thiểu
`bun test apps/workspace-web/src/features/my-signature` (19 ca).

## Quyết định trong lúc làm
- Màn chặn render `null` trong lúc chờ một lượt GET đầu để không loé app; API lỗi ⇒ vào app, `console.warn`.
- Hộp thoại «Tạo chữ ký mới» luôn bắt đầu ở bước chính (không dùng bản cũ); `initials = own` ⇒ thêm bước chữ ký tắt.
- Chữ ký số: `digital.enabled` ⇒ câu «đã bật nhưng chưa gán»; huy hiệu luôn «Chưa được gán» (đợt 1).
- `routeTree.gen.ts` sửa tay đúng khuôn file sinh; lần build kế sẽ tự sinh lại giống hệt.
- e2e giả định giám đốc `e2e-giamdoc` là quản trị công ty để gọi `PUT /company/signature-settings`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED hub/chu-ky.md
#### Yêu cầu: Màn «Tạo chữ ký của bạn» sau đăng nhập
Khi công ty bật ký trên tài liệu và người dùng cần tạo chữ ký, một màn toàn màn hình chắn trước khi vào app; lưu xong mới vào.
- Kịch bản: khi API báo cần tạo chữ ký thì hiện màn chặn [test: apps/workspace-web/src/features/my-signature/gate.test.tsx » needs_create ⇒ chặn và hiện màn]
- Kịch bản: khi công ty tắt hoặc API lỗi thì không chặn [test: apps/workspace-web/src/features/my-signature/gate.test.tsx » công ty tắt / chưa tải / API lỗi ⇒ không chặn]
- Kịch bản: khi bắt buộc thì không có «Làm sau», khi không bắt buộc thì có và nhớ trong phiên [test: apps/workspace-web/src/features/my-signature/gate.test.tsx » bắt buộc ⇒ không có «Làm sau», không bắt buộc ⇒ có, và nhớ thì không chặn]
- Kịch bản: khi chữ ký tắt tự tạo thì sau chữ ký chính có bước chữ ký tắt [test: apps/workspace-web/src/features/my-signature/gate.test.tsx » initials = own: đã có chữ ký chính ⇒ vào thẳng bước chữ ký tắt]
- Kịch bản: đăng nhập lần đầu, tạo chữ ký rồi vào app thấy chữ ký ở «Chữ ký của tôi» [test: e2e/cr181/first-login-signature.spec.ts » Lần đầu đăng nhập ⇒ tạo chữ ký ⇒ vào app ⇒ «Chữ ký của tôi»]

#### Yêu cầu: Trang «Chữ ký của tôi»
Thẻ chữ ký đang dùng (ảnh, ngày dùng từ, cách tạo, lịch sử, chữ ký tắt), nút «Tạo chữ ký mới», thẻ «Chữ ký số» chưa được gán. Mục menu chỉ hiện khi công ty bật.
- Kịch bản: khi phải quản trị cho phép thì nút tạo mới khoá, có lý do và nút «Xin đổi chữ ký» [test: apps/workspace-web/src/features/my-signature/gate.test.tsx » can_change = false ⇒ nút khoá + lý do + «Xin đổi chữ ký»]
- Kịch bản: khi đã xin đổi thì báo chờ quản trị [test: apps/workspace-web/src/features/my-signature/gate.test.tsx » đã xin ⇒ báo chờ, không còn nút xin, can_change ⇒ không khoá]
- Kịch bản: thẻ chữ ký số hiện «Chưa được gán» [test: apps/workspace-web/src/features/my-signature/gate.test.tsx » thẻ chữ ký số: «Chưa được gán»]
- Kịch bản: mục menu chỉ hiện khi công ty bật [test: apps/workspace-web/src/features/my-signature/gate.test.tsx » menu chỉ hiện khi công ty bật]
- Kịch bản: ở điện thoại 390px các thẻ xếp một cột, nút ≥ 44px [test: e2e/cr181/first-login-signature.spec.ts » Điện thoại 390px: một cột, nút Tạo chữ ký mới ≥ 44px]

## Việc còn lại
- Chạy e2e `e2e/cr181/first-login-signature.spec.ts` cuối đợt; soát UI thủ công màn chặn và 390px.
