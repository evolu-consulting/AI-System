---
id: s14-sign-viewer
lát: s14-sign-viewer
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s8-sign-api, s11b-sign-canvas, s12-sign-modes
---
## Plan (ngắn)
Route chỉ-đọc `/contracts/signed/$id?file=&v=` trong `features/doc-sign`, dùng lại `PageStage`/`PageRail`; không API mới (dùng `GET .../versions` và `.../content` của s8).

## Làm
- [x] Route `routes/_authed/contracts/signed/$id.tsx` (+ routeTree.gen), `SignedScreen` (chọn tệp, bản, quay lại)
- [x] Thanh trên: ← Quay lại · «Xem bản đã ký» · ô chọn bản (Bản gốc / Sau khi <người> ký · <giờ> / (đã bỏ)) · Tải về đúng bản
- [x] Tab tệp có trạng thái Đã ký đủ / n/m / Chưa ký; cột trang chấm màu theo bên
- [x] Khung phải «Chữ ký trong bản này» + «Chỗ ký còn chờ»; bấm ⇒ nhảy + viền vàng nhấp nháy từng phần (giáp lai: mọi trang)
- [x] Ô chờ mờ «Chờ <người> ký» trên trang; điện thoại: ẩn cột trang + khung phải, nút mở sheet
- [x] Khoá i18n `contracts.docsign.viewer.*` (vi + en); unit `components/signed-viewer.test.tsx`; e2e `e2e/cr181/signed-viewer.spec.ts` (viết, chưa chạy)

## Không làm / Chạm
Không làm trang HĐ (s13), Hồ sơ duyệt (s10). Chạm `api.ts` (thêm `fetchVersions`, `fetchPdfAt`), `routeTree.gen.ts` (thêm tay: không có bộ sinh trong lát).

## Test tối thiểu
`bun test apps/workspace-web/src/features/doc-sign` — mặc định bản mới nhất, nhãn bản, danh sách chữ ký đúng bản, giáp lai nhảy mọi trang, Tải về đúng URL, không nút sửa.

## Quyết định trong lúc làm
- Mặc định = bản mới nhất CHƯA bị bỏ; nếu mọi bản đều bị bỏ thì bản mới nhất.
- «Chỗ ký còn chờ» chỉ hiện khi đang xem bản mới nhất (bản cũ không biết chỗ nào ký sau đó).
- Tải về = nút lấy blob qua `apiResponse` (cần token), `data-href` giữ đường dẫn bản để test.
- Chấm cột trang: bên A/B lấy từ ô (`field_id`) trong phiên; chữ ký không thuộc ô ⇒ chấm màu chính.
- Giờ ở khung phải = `signed_at` của bản (API không trả giờ riêng từng dấu).
- Thêm `/contracts/signed/$id` vào các union của routeTree.gen để `navigate` của s13 có kiểu.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Xem bản đã ký (chỉ đọc)
Màn toàn màn hình `/contracts/signed/:id?file=&v=`: chọn bản, xem PDF của bản, liệt kê chữ ký và chỗ ký còn chờ; không sửa được gì (BR-X1, Q7, Q12).
- Kịch bản: khi mở màn không có v thì xem bản mới nhất chưa bị bỏ [test: apps/workspace-web/src/features/doc-sign/components/signed-viewer.test.tsx » mặc định bản mới nhất, v không có thật ⇒ cũng bản mới nhất, v có thật ⇒ bản đó]
- Kịch bản: khi bản bị Trả lại thì không là mặc định [test: apps/workspace-web/src/features/doc-sign/components/signed-viewer.test.tsx » bản bị bỏ (Trả lại) không là mặc định]
- Kịch bản: khi xem nhãn bản thì là Bản gốc hoặc Sau khi người ký · giờ, ghi (đã bỏ) nếu bị bỏ, không dùng chữ Phiên bản [test: apps/workspace-web/src/features/doc-sign/components/signed-viewer.test.tsx » nhãn bản: gốc / sau khi <người> ký · <giờ>]
- Kịch bản: khi chọn một bản thì khung phải chỉ liệt kê chữ ký của bản đó với kiểu và loại chữ ký nội bộ [test: apps/workspace-web/src/features/doc-sign/components/signed-viewer.test.tsx » liệt kê đúng chữ ký của bản đang chọn, kèm kiểu và loại nội bộ]
- Kịch bản: khi bấm chữ ký giáp lai thì nhảy tới trang đầu và viền vàng mọi trang của chữ ký [test: apps/workspace-web/src/features/doc-sign/components/signed-viewer.test.tsx » giáp lai: bấm ⇒ nhảy tới trang đầu và viền mọi trang của chữ ký]
- Kịch bản: khi bấm Tải về thì tải đúng PDF của bản đang xem [test: apps/workspace-web/src/features/doc-sign/components/signed-viewer.test.tsx » Tải về trỏ đúng URL của bản đang xem]
- Kịch bản: khi mở màn thì chỉ có Quay lại và Tải về, không có nút sửa [test: apps/workspace-web/src/features/doc-sign/components/signed-viewer.test.tsx » chỉ xem: có Quay lại và Tải về, không nút Lưu/Xoá/Ký, không chữ «Phiên bản»]
- Kịch bản: khi xem trên điện thoại thì ẩn khung phải và có nút mở danh sách chữ ký [test: e2e/cr181/signed-viewer.spec.ts » điện thoại 390px: ẩn khung phải, nút mở danh sách chữ ký]

## Việc còn lại
Chạy e2e `e2e/cr181/signed-viewer.spec.ts` cuối đợt (điều phối). Soát UI thủ công trên staging.
