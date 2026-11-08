---
id: cr110-profile-ui
lát: cr110-profile-ui
cr: CR-110
fr: [COM-FR-35, COM-FR-36, COM-FR-37]
làn: nhanh
migration: không
phụ thuộc: cr110-shell, cr110-profile-api
---
## Plan (ngắn)
Hồ sơ kiểu Facebook: hero + hstats + hàng tab theo registry `lib/profile-sections.ts` (`canView` false ⇒ không render). Chủ quản 4 tab,
đối tác 3 tab (D6/Q7). Nội dung mỗi mục ở `ui/profile/sections.tsx`; client thêm `getProfileMedia` + `listPartners({rep})`.

## Làm
- [x] Registry + resolveSection (section lạ ⇒ Bài đăng) + `friendsStat`/`hasReputation`
- [x] Giới thiệu (thẻ Hoạt động, không câu SHT), Bài đăng (Composer chỉ hồ sơ của mình), Đối tác (bảng; cột Uy tín khi có reputation), Ảnh & tệp (lưới + Xem thêm + rỗng)
- [x] Mock media + uy tín; i18n `community.profile.*`; CSS responsive; unit + e2e `e2e/community-web/profile.cm.ts` (viết, chưa chạy)

## Không làm / Chạm
Không đổi server/contract, không sửa feed/settings/sso, không sửa e2e khoá.

## Test tối thiểu
Unit `lib/profile-sections.test.ts`; e2e mới (chưa chạy).

## Quyết định trong lúc làm
- Tab Đối tác hiện ở mọi hồ sơ khi người xem là chủ quản (dùng `/partners?rep=1`, danh sách bạn bè công ty).
- Chuyển tab = đổi hash `#/profile/<orgId>/<section>` (hồ sơ của mình dùng orgId của viewer).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED community/hien-thi.md
#### Yêu cầu: Hồ sơ công ty kiểu Facebook — hero, số liệu, tab theo section
Hồ sơ có hero (cover, logo, tên, dòng phụ), số liệu, hàng tab theo registry section. Chủ quản thấy 4 tab (Giới thiệu, Bài đăng, Đối tác, Ảnh & tệp); đối tác 3 tab, không tab Đối tác, không số Bạn bè, không câu về Sổ Hợp Tác. Section lạ về Bài đăng.
- Kịch bản: khi đối tác mở hồ sơ thì chỉ có 3 tab và không có số Bạn bè [test: apps/workspace-web/src/modules/community/domain/profile-sections.test.ts » registry hồ sơ]
- Kịch bản: khi `#/profile/<id>/zzz` thì về Bài đăng, `files` mở Ảnh & tệp [test: apps/workspace-web/src/modules/community/domain/profile-sections.test.ts » registry hồ sơ]
- Kịch bản: khi chủ quản có quyền contracts mở tab Đối tác thì có cột Uy tín [test: apps/workspace-web/src/modules/community/domain/profile-sections.test.ts » mock hồ sơ]
- Kịch bản: khi mở Ảnh & tệp thì lưới phân trang con trỏ, "Xem thêm" [test: apps/workspace-web/src/modules/community/domain/profile-sections.test.ts » mock hồ sơ]

## Việc còn lại
Chạy e2e `profile.cm.ts` một lần cuối đợt.
