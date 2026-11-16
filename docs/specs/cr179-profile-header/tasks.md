---
id: cr179-profile-header
lát: cr179-profile-header
cr: CR-179
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Làm lại đầu trang `/community/me` theo phương án A: bìa 88px, avatar đè mép bìa, hàng tên + chip vai, «chức vụ · phòng ban», công ty (logo tròn + tên, bấm ⇒ trang công ty), email + nút sao chép. Sửa lỗi tên bị đè.

## Làm
- [x] `ui/MyProfileHeader.tsx` (mới) + `MyProfile.tsx` gọi; CSS `.mecover/.mehero*` trong `styles/profile.css`.
- [x] `domain/me-profile.ts` `meSubtitle` + unit test.
- [x] Kit `icons.ts`: thêm khái niệm `email`, `person`. i18n vi/en: `emailCopy`, `emailCopied`; bỏ khoá không còn dùng.
- [x] e2e `e2e/community-web/cr147-feed.cm.ts` (chưa chạy).

## Không làm / Chạm
Không đổi API. Không có dải số liệu (số bài/đã lưu trữ do FeedList giữ và đã hiện ở thẻ lọc ngay dưới; lấy ra ngoài cần nâng state ⇒ Việc còn lại). Không nút «Sửa hồ sơ» (trang chưa có lối sửa hồ sơ).

## Test tối thiểu
Unit `me-profile.test.ts`; e2e `cr147-feed.cm.ts`.

## Quyết định trong lúc làm
- Nguyên nhân tên bị che: khối bìa `position: relative` (ImagePick) vẽ ĐÈ lên khối `.phero` không có vị trí, mà `.phero` kéo lên -36px và canh đáy nên h1 nằm trong vùng bìa. Sửa: `.mehero` có `position: relative; z-index: 1` và cột thông tin đẩy xuống dưới mép bìa.
- Nút đổi ảnh bìa vẫn chỉ hiện khi rê chuột (giữ e2e cr147b), nhưng đặt ở góc phải trên của bìa.
- `me-job-title` nay là dòng gộp «chức vụ · phòng ban»; `me-department` bỏ (e2e không dùng).
- Màu bìa mặc định: `--cm-accent-soft` (theo màu chính công ty).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/ho-so-ca-nhan.md
#### Yêu cầu: Đầu trang hồ sơ cá nhân
Tên người dùng luôn hiện, không bị ảnh bìa đè; kèm chip vai trò, «chức vụ · phòng ban» (thiếu phần nào bỏ phần đó), công ty (logo tròn cùng hàng tên, bấm mở trang công ty) và email có nút sao chép.
- Kịch bản: thiếu phòng ban hoặc chức vụ ⇒ dòng phụ không có «·» thừa [test: apps/workspace-web/src/modules/community/domain/me-profile.test.ts » CR-179 dòng phụ chức vụ · phòng ban: thiếu phần nào bỏ phần đó]
- Kịch bản: mở /community/me ⇒ tên hiện, không bị phần tử khác đè, có chip vai [test: e2e/community-web/cr147-feed.cm.ts » CR-179: /community/me — tên hiện, không bị phần tử khác đè, có chip vai trò]
- Kịch bản: logo công ty tròn cùng hàng tên công ty [test: e2e/community-web/cr147-feed.cm.ts » CR-179: /community/me — logo công ty tròn, cùng hàng với tên công ty]

## Việc còn lại
- Dải số liệu (bài đăng, đã lưu trữ, đối tác) cần nâng dữ liệu ra khỏi FeedList.
- Nút «Sửa hồ sơ» khi trang có lối sửa hồ sơ.
