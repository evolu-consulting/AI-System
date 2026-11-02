---
id: cr110-settings
lát: cr110-settings
cr: CR-110
làn: nhanh
migration: không
phụ thuộc: cr110-shell, cr110-sht-sec, cr110-ports, cr110-sso (openContracts)
---
## Plan (ngắn)
Hộp thoại Cài đặt chung (COM-FR-38..42): nav 3 nhóm theo quyền, mô hình thuần `lib/settings-sections.ts`.
Cá nhân (thông báo + ngôn ngữ vi/en), Công ty (màu chủ đạo của công ty, chỉ Admin chủ quản), Sổ Hợp Tác (deep-link
`${contractsUrl}/settings?sec=co|rep|biz|scout|flow`, chỉ khi `caps.contracts`). D8: bỏ accent theo người dùng.

## Làm
- [x] `lib/settings-sections.ts` + test; `ui/SettingsDialog.tsx` + `ui/settings/*`; xoá `ui/Settings.tsx`.
- [x] Trạng thái: không có quyền (`settings-no-perm`), lỗi tải + Thử lại (`settings-load-error`).
- [x] Server: `PUT /settings` nhận `accent` cũ (CommunitySettingsInputSchema) nhưng bỏ qua; `GET` chỉ trả `notify`.
- [x] i18n `community.settings.*` một khối; e2e `e2e/community-web/settings.cm.ts` (viết, chưa chạy).

## Không làm / Chạm
Không chạm feed/profile/sso. Cột `community.settings.accent` giữ nguyên (không migration), không còn ghi/đọc.

## Test tối thiểu
unit `settings-sections.test.ts`; int `community.routes.int.test.ts` (accent cũ bị bỏ qua).

## Quyết định trong lúc làm
- Đổi màu công ty: contracts-web `?sec=co` là nơi ghi duy nhất (chưa có endpoint ghi brand ở community); mục Công ty hiển thị màu hiện tại + link.
- Ngôn ngữ chỉ lưu `community.lang` (như lát i18n; chưa có API ghi `/me`).
- `void openContracts(path, url, { allowed: viewer.caps.contracts })` (async, cr110-sso).
- Tiêu đề "Áp dụng cho cả công ty" (Q12) chỉ ở nhóm Công ty / Sổ Hợp Tác.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/hien-thi.md
#### Yêu cầu: Hộp thoại Cài đặt theo quyền
Nav 3 nhóm: Cá nhân (thông báo, ngôn ngữ), Công ty (màu chủ đạo, chỉ Admin chủ quản), Sổ Hợp Tác (deep-link contracts-web, chỉ khi có quyền contracts).
- Kịch bản: khi đối tác mở Cài đặt thì chỉ có nhóm Cá nhân [test: apps/community-web/src/lib/settings-sections.test.ts » đối tác: chỉ Cá nhân (không Công ty, không SHT) dù server lỡ cấp caps]
- Kịch bản: khi Admin có quyền contracts thì có 5 mục SHT với sec=co|rep|biz|scout|flow, flow chỉ xem [test: apps/community-web/src/lib/settings-sections.test.ts » Admin có quyền contracts: Cá nhân + Công ty + SHT với 5 mục deep-link, flow chỉ xem]
#### Yêu cầu: Màu chủ đạo thuộc công ty
Không còn màu theo người dùng; server nhận `accent` cũ nhưng bỏ qua.
- Kịch bản: khi client cũ PUT /settings kèm accent thì 200 và accent không được lưu/trả lại [test: apps/hub-api/src/modules/packs/community/adapters/community.routes.int.test.ts]

## Việc còn lại
Chạy e2e `settings.cm.ts` cuối đợt; bỏ ép kiểu `openContracts` sau rebase.
