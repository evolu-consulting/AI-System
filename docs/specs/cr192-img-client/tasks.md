---
id: cr192-img-client
lát: cr192-img-client
cr: CR-192
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Chọn ảnh đại diện/bìa ⇒ hộp cắt (kéo, phóng 1–3×, tròn / 3:1); máy người dùng thu nhỏ (400×400 ≤ 150 KB, 1200×400 ≤ 400 KB); chưa có bìa cá nhân ⇒ dải màu chuyển; không từ chối ảnh lớn.

## Làm
- [x] `shared/image-crop/crop.ts` (toạ độ cắt/phóng/kéo, `cropToDataUrl` vẽ + mã hoá + thu nhỏ dần), `encodeImage` (avatar-encode), `image.ts` (400 px, bỏ trần 2/3 MB ⇒ 40 MB).
- [x] `ui/profile/ImageCropDialog.tsx` (canvas thuần), `ImagePick` mở hộp cắt (cá nhân + công ty dùng chung), `image-file.ts`.
- [x] Dải màu chuyển cho bìa cá nhân chưa có ảnh (`profile.css`, token); i18n vi/en.
- [x] e2e `cr192-crop.cs.ts` (viết); cập nhật `cr147b-people.cs.ts` (thêm bước «Lưu ảnh» ở hộp cắt).

## Không làm / Chạm
Không ảnh nhỏ cho bài, cache, endpoint ảnh riêng (BR-192-5 hoãn). Chạm: `modules/community/{domain,ui/profile,ui/styles}`, i18n community, e2e community-web.

## Test tối thiểu
`crop.test.ts`, `image.test.ts`, `avatar-encode.test.ts`; tsc workspace-web.

## Quyết định trong lúc làm
- Máy chủ giữ nguyên giới hạn (đại diện 150 KB = 153 600 B ≤ 205 000 ký tự base64; bìa 3 MB) — kích thước mới đã lọt, không nới.
- Không có «Dùng ảnh mẫu» trong code (grep sạch) ⇒ không có gì để gỡ (BR-192-4 đã thoả).
- Chặn tệp gốc > 40 MB (nhãn «Ảnh tối đa 40 MB») để khỏi cạn bộ nhớ trình duyệt; dưới mức đó không từ chối.
- Điều phối thêm: `CoverField.tsx` (Cài đặt › Công ty) dùng chung hộp cắt qua `~/shared/image-crop` (nhãn truyền qua `labels`); bìa mặc định `accentGradient`. Chưa có e2e riêng cho trang này (ghi chú C3 trong cr192-crop).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED web/anh-ho-so-cat-anh.md
#### Yêu cầu: Cắt và thu nhỏ ảnh đại diện, ảnh bìa
Chọn ảnh đại diện hoặc ảnh bìa (cá nhân, công ty) mở hộp cắt: kéo chọn vùng, phóng 1–3×; đại diện khung tròn, bìa tỉ lệ 3:1. Máy người dùng thu nhỏ: đại diện 400×400 ≤ 150 KB, bìa 1200×400 ≤ 400 KB; ảnh lớn không bị từ chối.
- Kịch bản: khi chọn vùng và phóng thì toạ độ cắt nằm trong ảnh [test: apps/workspace-web/src/shared/image-crop/crop.test.ts » tâm ra ngoài ảnh ⇒ kẹp trong ảnh]
- Kịch bản: khi ảnh 6000×4000 thì đại diện vẫn ra 400×400 dưới 150 KB [test: apps/workspace-web/src/shared/image-crop/crop.test.ts » đại diện: ảnh 6000×4000 vẫn ra 400×400 dưới 150 KB]
- Kịch bản: khi ảnh bìa thì ra 1200×400 dưới 400 KB [test: apps/workspace-web/src/shared/image-crop/crop.test.ts » bìa: 1200×400 dưới 400 KB]
- Kịch bản: khi vẫn quá nặng thì thu nhỏ dần, không từ chối [test: apps/workspace-web/src/shared/image-crop/crop.test.ts » chất lượng nhỏ nhất vẫn quá nặng ⇒ thu nhỏ dần, không từ chối]
- Kịch bản: khi chọn ảnh qua hộp cắt thì bố cục hồ sơ không đổi [test: e2e/community-web/cr192-crop.cs.ts » C1 · đổi ảnh đại diện qua hộp cắt, bố cục hồ sơ không đổi]

#### Yêu cầu: Bìa mặc định
Chưa có ảnh bìa ⇒ dải màu chuyển theo màu chính, không chữ, đẹp cả sáng và tối; không có «Dùng ảnh mẫu».
- Kịch bản: khi chưa có bìa thì thấy dải màu trơn không chữ [test: e2e/community-web/cr192-crop.cs.ts » C2 · ảnh bìa 6000×4000: hộp cắt 3:1, ra 1200×400, huỷ không đổi]

## Việc còn lại
Không còn.
