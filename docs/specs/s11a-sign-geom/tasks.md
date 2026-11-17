# Tasks · s11a-sign-geom [CR-181]

Lát: thư viện hình học thuần cho «Ký trên tài liệu» (không React/DOM/API/pdf.js). Hợp đồng `SignPart`: `packages/contracts/src/pack-contracts/doc-sign.ts`.

- [x] `features/doc-sign/lib/geometry.ts` — `partsOf`, `rectFromParts`, `toN`/`toPx`, lỗi `too_many_pages`
- [x] `lib/snap.ts` — `seamsOf`, `snapToSeams` (16px)
- [x] `lib/actions.ts` — `nudge` (4px), `resizeKeepAspect` (≥30px), `copyToAllPages`, `labelFor`, `clampToStage`
- [x] `lib/anchors.ts` — `findAnchors` (ĐẠI DIỆN BÊN A/B, từ trang cuối ngược lên)
- [x] `lib/doc-sign-lib.test.ts` — 16 ca; lệnh xong: `bun test apps/workspace-web/src/features/doc-sign/lib`

## Delta

### ADDED docs/current/pack-contracts/ky-tren-tai-lieu.md

#### Yêu cầu: Đặt chữ ký, giáp lai, ký nháy
Chữ ký đặt trên tài liệu quy ra các phần `SignPart` theo điểm PDF (gốc dưới-trái, trang đã xoay). Chữ ký vắt qua khe giữa hai trang ở chế độ «Từng trang» thành giáp lai (2..5 trang, mỗi trang giao ≥ 1px); tâm chữ ký cách khe < 16px thì hít vào khe. Ô chỗ ký tỉ lệ 2,4:1, rộng tối thiểu 30px, mũi tên nhích 4px. «Chép sang mọi trang» đặt bản cùng vị trí ở mọi trang trừ trang nguồn, cỡ 40% (hoặc 100% khi dùng chữ ký tắt riêng). «Tự đặt chỗ ký» tìm «ĐẠI DIỆN BÊN A/B» từ trang cuối ngược lên và đặt ô ngay dưới chữ.

- Kịch bản: quy đổi px↔điểm khứ hồi sai số < 0,5pt [test: apps/workspace-web/src/features/doc-sign/lib/doc-sign-lib.test.ts "khứ hồi px↔điểm"]
- Kịch bản: giáp lai qua khe hai trang ra 2 phần đúng [test: doc-sign-lib.test.ts "giáp lai qua khe"]
- Kịch bản: vượt 5 trang báo lỗi `too_many_pages` [test: doc-sign-lib.test.ts "vượt 5 trang"]
- Kịch bản: hít khe trong 16px, ngoài 16px giữ nguyên [test: doc-sign-lib.test.ts describe "snap"]
- Kịch bản: chép sang mọi trang bỏ trang nguồn, cỡ 0,4 [test: doc-sign-lib.test.ts "chép sang mọi trang"]
- Kịch bản: cụm bị tách item / không có cụm / trang cuối ưu tiên [test: doc-sign-lib.test.ts describe "findAnchors"]

## Quyết định trong lúc làm
- `partsOf` dùng `ptWidth/width` từng trang (không hằng PW/PH) — trang khác cỡ vẫn đúng. Chế độ «xoè quạt» của bản mẫu (vùng lộ `visible`) không làm: đợt 1 chỉ «Từng trang»/dọc theo yêu cầu lát.
- `resizeKeepAspect` bỏ tham số dy (bản mẫu chỉ dùng dx).
- Anchor: ghép item bỏ khoảng trắng rồi tìm; vị trí = item chứa ký tự đầu cụm; item giả định trang không xoay (nơi gọi đổi toạ độ nếu `/Rotate`≠0).
- `labelFor` trả chuỗi VI như bản mẫu; lớp component bọc i18n.

## Việc còn lại
- Xoè quạt (fan) và trang xoay trong anchors nếu đợt sau cần.
