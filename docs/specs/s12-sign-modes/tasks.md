---
id: s12-sign-modes
lát: s12-sign-modes
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s8, s11b
---
## Plan (ngắn)
Nối màn ký s11b với API: phiên ký, PUT chỗ ký, POST ký, chữ ký của tôi. Route `/contracts/sign/$id` (cùng khoang `contracts` như `c/$id`). `mode` lấy từ phiên.

## Làm
- [x] `features/doc-sign/api.ts` + `hooks/use-doc-sign.ts` (session, `/me/signature`, PATCH cần ký, PUT chỗ ký, POST ký, POST chữ ký)
- [x] `lib/session-map.ts` (dựng mục từ phiên, body PUT/POST, đếm chỗ chưa ký, tổng hợp xác nhận, tự đặt, readiness), `lib/pdf-anchors.ts` (getTextContent + đổi toạ độ trang xoay + `findAnchors`), `lib/errors.ts`
- [x] `pages/SignScreen.tsx` + `pages/SignBody.tsx`, `components/SignDialogs.tsx`, `components/CreateSignatureDialog.tsx`, route `routes/_authed/contracts/sign/$id.tsx` (+ `routeTree.gen.ts`)
- [x] Prep: khay «Chỗ ký», nút «Tự đặt theo «ĐẠI DIỆN BÊN A/B»», Lưu chỗ ký ⇒ tệp kế ⇒ hộp kiểm tra readiness. Sign: bấm ô, kéo chữ ký, chép sang mọi trang, Ký bằng, «Lưu (còn n chỗ chưa ký)», hộp xác nhận
- [x] i18n `contracts.docsign.*` thêm khoá; test `doc-sign-api.test.tsx`; e2e `e2e/cr181/sign-prep-and-sign.spec.ts` (chưa chạy)

## Không làm / Chạm
Không: nút trên trang HĐ (s13), xem bản đã ký (s14). Chạm s11b tối thiểu: `SignWorkspace` (effect đổi tệp khi tệp hiện tại bị gỡ, nút tự đặt, `signImageUrl`), `types.ts` (3 prop), `use-sign-items` (`fill`, `append`), `SignItem` (+`fieldId`, `initials`).

## Test tối thiểu
`bun test apps/workspace-web/src/features/doc-sign` xanh; `tsc --noEmit` workspace-web sạch; `i18n:check` xanh.

## Quyết định trong lúc làm
- Route `/contracts/sign/$id` (không phải `/contracts/:id/sign`): `contracts/c/$id` là lá, thêm `$id/sign` sẽ biến nó thành layout.
- Mỗi ô giữ `signerKind` + `signerRef` (từ phiên, khay, «Đổi người»); PUT gửi đúng hai giá trị đó, không tra theo tên.
- Không có endpoint «signers» riêng: danh sách người ký lấy từ phiên (`signers`).
- Chữ ký tắt riêng (`initials = own`): máy chủ chọn ảnh theo `placement: initials`; màn chỉ vẽ ảnh chính thu nhỏ (chưa vẽ ảnh tắt riêng).
- `POST /me/signature`: body `{kind, method, png}` (png base64 thuần) parse bằng `CreateSignatureBodySchema` trước khi gửi.
- Sau Lưu một tệp: bỏ tệp đó khỏi danh sách (tab kế tự mở); hết tệp ⇒ prep hiện readiness rồi thoát, sign thoát và làm mới HĐ.
- Tải PDF: `latest.version_id` null ⇒ `/content` bản gốc, ngược lại `/versions/:vid/content`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Ký trên tài liệu nối API
Màn ký mở từ phiên ký; chế độ do máy chủ quyết; Lưu gửi vị trí chữ ký, không gửi ảnh.
- Kịch bản: khi lưu chữ ký thì body POST có placement field/free/seam/initials và không chứa ảnh [test: apps/workspace-web/src/features/doc-sign/doc-sign-api.test.tsx » body POST: field / free / seam / initials, không gửi ảnh]
- Kịch bản: khi bấm ô của mình thì ô thành chữ ký, giữ vị trí [test: apps/workspace-web/src/features/doc-sign/doc-sign-api.test.tsx » bấm ô của mình ⇒ thành chữ ký, giữ parts và fieldId]
- Kịch bản: khi tự đặt theo «ĐẠI DIỆN BÊN A/B» thì ô được đặt đúng trang và gắn đúng người ký [test: apps/workspace-web/src/features/doc-sign/doc-sign-api.test.tsx » tự đặt dùng anchors: ô cho mỗi bên tìm thấy, PUT gắn người ký đúng]
- Kịch bản: khi còn ô chưa ký thì nút ghi «Lưu (còn n chỗ chưa ký)» [test: apps/workspace-web/src/features/doc-sign/doc-sign-api.test.tsx » «Lưu (còn n chỗ)»: đếm ô của mình chưa ký, bấm ô thì giảm]
- Kịch bản: khi Lưu thì hộp xác nhận ghi số chữ ký, giáp lai, số trang [test: apps/workspace-web/src/features/doc-sign/doc-sign-api.test.tsx » tổng hợp hộp xác nhận: n chữ ký, m giáp lai, số trang]
- Kịch bản: khi chữ ký số chưa bật thì mục khoá kèm lý do từ phiên [test: apps/workspace-web/src/features/doc-sign/doc-sign-api.test.tsx » mục «Chữ ký số» khoá kèm lý do từ phiên]
- Kịch bản: khi lưu xong chỗ ký thì hiện danh sách thiếu chỗ ký theo từng tệp [test: apps/workspace-web/src/features/doc-sign/doc-sign-api.test.tsx » readiness ⇒ dòng kiểm tra]
- Kịch bản: hành trình soạn đặt chỗ ký rồi người khác ký [test: e2e/cr181/sign-prep-and-sign.spec.ts » người ký (khác người soạn): bấm ô «Bấm để ký», xác nhận, Lưu]

## Việc còn lại
- e2e chưa chạy; chưa kiểm bằng trình duyệt thật. Ảnh chữ ký tắt riêng chưa vẽ.
