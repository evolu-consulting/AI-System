---
id: s3-sig-create
lát: s3-sig-create
cr: CR-181
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Component thuần UI tạo chữ ký (vẽ / tải ảnh / gõ họ tên) + khung xem trước; chưa gọi API (s4 nối).

## Làm
- [x] `features/my-signature/lib/signature-image.ts`: trim, xoá nền, nét đen (Q18), thu nhỏ PNG ≤ 204800 B, recolor, captionText.
- [x] `features/my-signature/components/SignatureCreator.tsx` (props methods/ink/caption/person/allowLater/step/onSave/onLater).
- [x] Phông Dancing Script (OFL) tự host `public/fonts/` + `OFL.txt`; nạp bằng `FontFace` khi mở «Gõ họ tên».
- [x] i18n `contracts.mySig.*` (vi + en) trong `docframe.*.json`.

## Không làm / Chạm
Không làm màn chặn sau đăng nhập, trang «Chữ ký của tôi», API (s4), Cài đặt (s5). Chạm: apps/workspace-web, packages/i18n/locales.

## Test tối thiểu
`bun test apps/workspace-web/src/features/my-signature` (11 ca).

## Quyết định trong lúc làm
- Khoá i18n đặt thành nhánh `contracts.mySig` trong `docframe.{vi,en}.json` (gộp nông, không phải thêm tệp vào loader).
- Phông là bản biến thiên `DancingScript.ttf` (weight 400–700) từ google/fonts; không thêm gói npm.
- Nét vẽ lưu đen `#000`; màu mực chỉ áp ở xem trước (`recolor`).
- «Làm sau» gọi `onLater` do chỗ dùng cấp; component không tự điều hướng.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/hub/chu-ky.md
#### Yêu cầu: Tạo chữ ký bằng vẽ, tải ảnh hoặc gõ họ tên
Màn tạo chữ ký chỉ hiện các cách công ty cho phép; ảnh lưu là PNG nét đen nền trong suốt, ≤ 200 KB; có khung xem trước theo màu mực và dòng dưới chữ ký.
- Kịch bản: khi công ty chỉ cho Vẽ và Gõ họ tên thì không hiện cách Tải ảnh [test: apps/workspace-web/src/features/my-signature/my-signature.test.tsx » chỉ hiện cách được phép]
- Kịch bản: khi chữ ký bắt buộc thì không có nút «Làm sau» [test: apps/workspace-web/src/features/my-signature/my-signature.test.tsx » «Làm sau» ẩn khi bắt buộc, hiện khi cho phép]
- Kịch bản: khi bấm Lưu mà chưa có chữ ký thì báo lỗi ngay tại chỗ [test: apps/workspace-web/src/features/my-signature/my-signature.test.tsx » báo lỗi theo cách đang chọn]
- Kịch bản: khi ảnh PNG vượt 200 KB thì thu nhỏ dần tới khi vừa [test: apps/workspace-web/src/features/my-signature/my-signature.test.tsx » ảnh vượt 200 KB được thu nhỏ dần]
- Kịch bản: khi tải ảnh chụp thì điểm sáng thành trong suốt [test: apps/workspace-web/src/features/my-signature/my-signature.test.tsx » xoá nền: điểm sáng thành trong suốt, điểm tối giữ nét]

#### Yêu cầu: Dòng dưới chữ ký theo định dạng
- Kịch bản: khi bật nhiều dòng thì thứ tự là Họ tên · Chức danh · Ngày · Giờ [test: apps/workspace-web/src/features/my-signature/my-signature.test.tsx » thứ tự Họ tên · Chức danh · Ngày · Giờ]

## Việc còn lại
- s4 nối API + màn chặn; kiểm bằng mắt trên trình duyệt thật (vẽ bằng ngón tay, phông) — chưa chạy được ở lát này.
