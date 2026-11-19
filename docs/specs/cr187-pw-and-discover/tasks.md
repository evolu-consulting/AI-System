---
id: cr187-pw-and-discover
lát: cr187-pw-and-discover
cr: CR-187
làn: nhanh
migration: không
phụ thuộc: —
---
## Plan (ngắn)
BR-187-1: «Đổi mật khẩu» ở menu tài khoản Sổ Hợp Tác mở hộp thoại tại chỗ, gọi `POST /auth/change-password` nhánh `current_password` qua `AuthPort.changeOwnPassword`. Luật độ mạnh dời về web-kit (`password-strength.ts` + `ui/PasswordStrength.tsx`), admin-web + workspace-web cùng dùng.
BR-187-5: thẻ công tắc «Cho công ty khác tìm thấy công ty mình» ở trang Đối tác (một chỗ gắn ở `PartnersPage.tsx`), chỉ `tenant_admin`; API cũ `PUT /admin/tenants/:id/directory`; gỡ hàng công tắc khỏi admin-web `DirectoryCard` (giữ «Đã xác minh»).

## Làm
- [x] Dời strength về web-kit; admin-web chỉ gắn chuỗi i18n.
- [x] `AuthPort.changeOwnPassword` + adapter admin-api.
- [x] `ChangePasswordDialog` + `change-password.ts` + bus + host trong Shell; `AccountSection` mở hộp (2FA giữ `account-link.ts`).
- [x] `DiscoverableCard` + `discoverable.ts`; gỡ hàng `listed` ở admin-web (+ khoá i18n `tenants.directory.listed*`, `needProfile`).
- [x] e2e `cr187-password.cw.ts`, `cr187-discover.cw.ts` (chưa chạy).

## Không làm / Chạm
Không đổi API/contract. Không sắp lại trang Đối tác (CR-191). Chạm `PartnersPage.tsx` đúng 2 dòng (import + `<DiscoverableCard />` dưới `<InviteBanner />`) ⇒ báo agent CR-191.

## Test tối thiểu
unit: `packages/web-kit/src/password-strength.test.ts`, `features/shell/lib/change-password.test.ts`, `features/partners/lib/discoverable.test.ts`, admin `directory.test.ts`. e2e: `cr187-password`, `cr187-discover`.

## Quyết định trong lúc làm
- Hộp thoại dùng chung kiểm độ dài/khớp `newPasswordError` của platform/auth (G1), không chép luật.
- `PasswordStrength` ở web-kit nhận hàm nhãn (web-kit không giữ i18n); admin-web giữ vỏ mỏng gắn chuỗi.
- Phiên: giữ hành vi API (`selfChange` giữ phiên hiện tại, đăng xuất thiết bị khác); hộp chỉ báo «Đã đổi mật khẩu».
- Thẻ chỉ cho `tenant_admin` (platform_admin không bật hộ công ty, như `directoryView` cũ).
- `strength.test.ts` của admin-web dời sang web-kit (`password-strength.test.ts`, cùng nội dung) ⇒ `test:lock:write` ghi lại.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/doi-mat-khau-va-tim-thay.md
#### Yêu cầu: Đổi mật khẩu tại chỗ trong Sổ Hợp Tác
Menu tài khoản mở hộp thoại hiện tại / mới / nhập lại; độ mạnh hiện khi gõ.
- Kịch bản: khi nhập sai mật khẩu hiện tại thì lỗi hiện trong hộp [test: apps/workspace-web/src/features/shell/lib/change-password.test.ts » sai mật khẩu hiện tại (400 INVALID_CURRENT_PASSWORD) ⇒ lỗi ở ô hiện tại]
- Kịch bản: khi nhập đúng và khớp thì gọi API đổi mật khẩu một lần [test: apps/workspace-web/src/features/shell/lib/change-password.test.ts » hợp lệ ⇒ gọi API với (hiện tại, mới) và báo ok]
- Kịch bản: hành trình đổi mật khẩu trong trình duyệt [test: e2e/contracts-web/cr187-password.cw.ts » đổi mật khẩu tại chỗ: sai hiện tại ⇒ lỗi trong hộp, rồi đúng ⇒ đã đổi]
#### Yêu cầu: Công tắc «Cho công ty khác tìm thấy công ty mình» ở Đối tác
Chỉ quản trị công ty thấy; bật khi đủ tên pháp lý + MST, thiếu thì khoá và nói lý do; đã gỡ khỏi Admin.
- Kịch bản: khi vai khác quản trị công ty thì không thấy thẻ [test: apps/workspace-web/src/features/partners/lib/discoverable.test.ts » vai khác quản trị công ty không thấy thẻ]
- Kịch bản: khi thiếu MST thì công tắc khoá và báo lý do [test: apps/workspace-web/src/features/partners/lib/discoverable.test.ts » thiếu MST hoặc tên pháp lý ⇒ khoá + báo lý do]
- Kịch bản: hành trình bật công tắc [test: e2e/contracts-web/cr187-discover.cw.ts » quản trị công ty: bật công tắc ⇒ một PUT {listed:true}]

## Việc còn lại
Chạy e2e cuối đợt. Báo agent CR-191: `PartnersPage.tsx` có `<DiscoverableCard />` dưới `<InviteBanner />`.
