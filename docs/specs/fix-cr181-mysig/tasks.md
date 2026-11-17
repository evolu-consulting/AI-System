---
id: fix-cr181-mysig
lát: fix-cr181-mysig
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s4-sig-gate
---
## Plan (ngắn)
Menu «Chữ ký của tôi» hiện Tổng quan: guard `bouncesHome` coi `/my-signature` là app lạ (`appKeyOf` ⇒ khoá «my-signature», `canOpen` fail-closed) rồi đẩy về home.

## Làm
- [x] `shared/kernel/app-path.ts`: `ACCOUNT_PATHS` (trang tài khoản dùng chung) ⇒ `appKeyOf` = null ⇒ module «public», mở được.
- [x] Test tái hiện `guard.test.ts` (tầng unit).

## Không làm / Chạm
Chạm: apps/workspace-web/src/shared/kernel/app-path.ts, features/auth/lib/guard.test.ts.

## Test tối thiểu
`bun test apps/workspace-web/src/features/auth/lib/guard.test.ts`

## Quyết định trong lúc làm
- Danh sách riêng `ACCOUNT_PATHS` thay vì thêm vào `PUBLIC_PATHS` (đường công khai không cần phiên).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED hub/chu-ky.md
#### Yêu cầu: Mở trang «Chữ ký của tôi» từ menu tài khoản
Bấm mục «Chữ ký của tôi» đưa tới trang `/my-signature`, không bị chuyển về Tổng quan.
- Kịch bản: khi mở /my-signature thì guard không đẩy về home [test: apps/workspace-web/src/features/auth/lib/guard.test.ts » mở được với nhân viên lẫn đối tác, không bị đẩy về home]

## Việc còn lại
