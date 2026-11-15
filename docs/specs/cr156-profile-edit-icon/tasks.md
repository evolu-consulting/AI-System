# CR-156 · Hồ sơ: nút đổi ảnh thành icon bút

Đọc: `modules/community/ui/profile/ImagePick.tsx`, `MyProfile.tsx`, `ProfileCover.tsx`, `styles/profile.css` (cuối file).

## Ghi chú
- Nút chữ «Đổi ảnh đại diện»/«Đổi ảnh bìa»/«Xoá ảnh…» ⇒ nút icon (bút/thùng rác), nhãn cũ giữ làm `aria-label` + `title` (i18n `community.me.*Change|*Remove`).
- Avatar: icon nằm trên avatar, chỉ hiện khi hover; ảnh bìa (cá nhân và công ty): icon canh giữa, chỉ hiện khi hover. Focus bàn phím (`:focus-within`) cũng hiện; thiết bị không hover luôn hiện. Chỉ render khi có quyền (luật cũ).
- Lỗi ảnh (`-err`) vẫn hiện thường trực. testid giữ nguyên (`*-file`, `*-remove`, `*-err`), thêm `*-change`.
- Sửa đỏ `no-hardcoded-vi`: `avatar-encode.ts`, `ImagePick.tsx` ⇒ log kỹ thuật tiếng Anh (không phải chuỗi người dùng thấy).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/ho-so-anh.md

#### Yêu cầu: Đổi ảnh đại diện và ảnh bìa bằng icon bút
- Kịch bản: khi rê chuột lên ảnh bìa cá nhân thì hiện icon bút canh giữa, có nhãn «Đổi ảnh bìa» [test: e2e/community-web/cr147b-people.cs.ts » P2 · ảnh bìa cá nhân: đổi, tải lại còn, tệp sai định dạng bị từ chối]
- Kịch bản: khi đổi và xoá ảnh đại diện bằng icon trên avatar thì ảnh cập nhật [test: e2e/community-web/cr147b-people.cs.ts » P1 · đổi + xoá ảnh đại diện ở hồ sơ cá nhân]

## Tasks
- [x] Icon + CSS hover/focus. [test: e2e/community-web/cr147b-people.cs.ts P2 (aria-label, opacity hover)]
- [x] Chuỗi VI sang i18n. [test: modules/community/i18n/no-hardcoded-vi.test.ts]
