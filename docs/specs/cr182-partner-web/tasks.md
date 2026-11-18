---
id: cr182-partner-web
lát: cr182-partner-web
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: cr182-partner-api
---
## Plan (ngắn)
Web công khai `/ky/<token>` của «Đối tác ký qua link riêng» (decisions.md R5) + khối trạng thái link ở trang HĐ phía công ty. Route ngoài `_authed`, không gọi API cần đăng nhập, không khung app. Màn ký dùng lại `SignWorkspace` (chế độ ký); nguồn dữ liệu qua cổng `PartnerSignPort` (`features/partner-sign/ports.ts`, adapter `api.ts`).

## Làm
- [x] Route `routes/ky.$token.tsx` + `features/partner-sign/` (api, ports, hooks, lib, components, pages); `<meta name="referrer" content="no-referrer">` + noindex gắn khi trang mở; proxy `/sign-link` → hub trong `rsbuild.config.ts` (dev + preview).
- [x] Trang mời ký (`PartnerInvite`): công ty Bên A, «mời bạn ký <tên HĐ>», số tệp, chỗ ký của bạn, hạn; «Xem và ký», «Từ chối ký» (hộp lý do).
- [x] Trạng thái: «Bạn đã ký xong» + «Xem bản đã ký» / «Tải về» từng tệp; đã từ chối; hết hạn/thu hồi (410); link sai (404); quá nhiều lần (429); lỗi mạng + «Tải lại».
- [x] Lần đầu «Xem và ký» ⇒ hộp «Tạo chữ ký của bạn» (Gõ họ tên | Vẽ, mực xanh) dùng lại `SignatureCreator`; `POST quick-signature`; ảnh xanh nhớ trong `sessionStorage` theo link.
- [x] Màn ký đối tác `PartnerSignBody` (dùng `SignWorkspace`): chỉ tệp còn chỗ ký; ô Bên B «Bấm để ký»; tự đặt thêm dấu từ khay (giáp lai, xoè quạt); Lưu ⇒ `POST sign` chỉ vị trí; xong hết tệp ⇒ tải lại trạng thái ⇒ «Bạn đã ký xong».
- [x] `SignTopBar` ẩn nhóm «Ký bằng» khi chỉ có một kiểu (đối tác chỉ ký nội bộ).
- [x] Trang HĐ: `PartnerLinkInfo` trong khối «Chờ đối tác ký» (đã gửi lúc, đã mở lúc, hạn, từ chối + lý do) + nút «Gửi lại link» ⇒ `POST partner-sign/resend` ⇒ toast; câu `partnerWait` bỏ ý «bản sau».
- [x] i18n `contracts.psign.*` (vi + en) trong `docsignc.{vi,en}.json`.
- [x] e2e (chưa chạy) `e2e/cr181/partner-sign-link.spec.ts`.

## Không làm / Chạm
Không đổi contract / backend. Ô Bên A «mờ Đã ký / Chờ…» KHÔNG vẽ riêng: API link chỉ trả ô Bên B, chữ ký Bên A đã in sẵn trong PDF của bản mới nhất. Chạm `SignTopBar` (dùng chung với màn ký công ty) và khối «Chờ đối tác ký» của `PartnerWaitCard`.

## Test tối thiểu
- unit: `bun test apps/workspace-web/src/features/partner-sign apps/workspace-web/src/features/doc-sign/lib/partner-link-view.test.ts`.
- e2e (điều phối chạy cuối đợt, cần `E2E_HUB_LOG` hoặc `E2E_PARTNER_LINK`): `e2e/cr181/partner-sign-link.spec.ts`.

## Quyết định trong lúc làm
- «Port» = `PartnerSignPort` cho nguồn link; `SignWorkspace` vốn chỉ nhận props nên không đổi, `SignBody` (API công ty) giữ nguyên.
- API link không có đường lấy lại ảnh chữ ký nhanh: ảnh nhớ ở `sessionStorage` (khoá theo token); mở link ở trình duyệt khác khi `has_quick_signature` đã true ⇒ tạo lại (tối đa 20 lần mỗi link, máy chủ giới hạn).
- 410 của máy chủ không kèm tên công ty ⇒ câu «Liên hệ công ty đã mời bạn ký để được gửi lại» (không nêu tên). Đề xuất backend-lead: thêm `company_name` vào thân 410.
- Nút «Gửi lại link» hiện khi người xem có `can_prep` trên một tệp (người tải lên / quản trị); máy chủ vẫn kiểm, 403 ⇒ toast «Chỉ người tải lên hoặc quản trị gửi lại được».
- Nhãn kiểu tạo chữ ký giữ «Gõ họ tên | Vẽ» (nhãn sẵn của `SignatureCreator`), không «Gõ tên» như bản mẫu.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Trang ký công khai của đối tác không cần tài khoản
Đường dẫn `/ky/<token>` mở được khi chưa đăng nhập và không có khung ứng dụng; trang không gửi Referer. Trang mời ký nói công ty nào mời ký hợp đồng nào, số tệp cần ký, số chỗ ký của đối tác và hạn ký, có «Xem và ký» và «Từ chối ký» (bắt buộc nhập lý do). Đã ký thì hiện «Bạn đã ký xong» kèm «Xem bản đã ký» và «Tải về»; đã từ chối thì ghi rõ; hết hạn hoặc thu hồi thì nói liên hệ công ty để được gửi lại; link sai thì «Không tìm thấy trang ký này».
- Kịch bản: khi mở link thì trạng thái trang theo dữ liệu và mã lỗi của máy chủ [test: apps/workspace-web/src/features/partner-sign/partner-sign.test.tsx » link mở ⇒ mời ký, đã ký / từ chối theo state]
- Kịch bản: khi máy chủ trả 410, 404, 429 thì trang hiện đúng trạng thái [test: apps/workspace-web/src/features/partner-sign/partner-sign.test.tsx » 410 ⇒ hết hạn/thu hồi, 404 ⇒ sai link, 429 ⇒ quá nhiều lần, khác ⇒ lỗi]
- Kịch bản: khi thao tác lỗi thì báo bằng câu nghiệp vụ, không lộ mã kỹ thuật [test: apps/workspace-web/src/features/partner-sign/partner-sign.test.tsx » mã lỗi thao tác ⇒ khoá i18n nghiệp vụ, mã lạ ⇒ câu chung]
- Kịch bản: khi mở trang mời ký thì thấy công ty, tên hợp đồng, số chỗ ký, hạn và hai nút [test: apps/workspace-web/src/features/partner-sign/partner-sign.test.tsx » trang mời ký: ai mời, ký gì, số tệp cần ký, chỗ ký của bạn, hạn, hai nút]
- Kịch bản: khi đã ký thì có «Xem bản đã ký» và «Tải về» cho từng tệp [test: apps/workspace-web/src/features/partner-sign/partner-sign.test.tsx » đã ký: «Bạn đã ký xong» + «Xem bản đã ký» / «Tải về» cho từng tệp có bản]
- Kịch bản: khi bị từ chối hoặc hết hạn thì nói rõ và chỉ cách liên hệ [test: apps/workspace-web/src/features/partner-sign/partner-sign.test.tsx » từ chối: ghi rõ + lý do, hết hạn: nói liên hệ công ty để được gửi lại]
- Kịch bản: khi hết hạn hoặc sai link thì câu báo rõ ràng và không có nút ký [test: e2e/cr181/partner-sign-link.spec.ts » link hết hạn ⇒ câu báo rõ ràng, không có nút ký, link sai ⇒ không tìm thấy]
- Kịch bản: khi dùng điện thoại 390px thì trang mời ký không tràn ngang [test: e2e/cr181/partner-sign-link.spec.ts » điện thoại 390px: trang mời ký dùng được, nút ≥ 44px]

#### Yêu cầu: Đối tác tạo chữ ký nhanh và ký ô Bên B trên màn ký dùng chung
Lần đầu bấm «Xem và ký», đối tác tạo chữ ký của mình (gõ họ tên hoặc vẽ) rồi mới vào màn ký. Màn ký là màn ký chung của công ty ở chế độ ký: chỉ các tệp còn chỗ ký của đối tác, ô Bên B «Bấm để ký», tự đặt thêm chữ ký từ khay (cả giáp lai). Lưu chỉ gửi vị trí, không gửi ảnh; ký hết các tệp thì hiện «Bạn đã ký xong».
- Kịch bản: khi dựng màn ký thì chỉ tệp còn chỗ ký và chỉ ô Bên B chưa ký vào màn [test: apps/workspace-web/src/features/partner-sign/partner-sign.test.tsx » đếm chỗ chưa ký và chỉ lấy tệp còn chỗ ký]
- Kịch bản: khi dựng mục ban đầu thì ô Bên B chưa ký là ô của đối tác [test: apps/workspace-web/src/features/partner-sign/partner-sign.test.tsx » mục ban đầu: mỗi ô chưa ký là ô «mine» Bên B giữ id chỗ ký, ô đã ký không vào]
- Kịch bản: khi bấm Lưu thì thân gửi chỉ có vị trí, không có ảnh [test: apps/workspace-web/src/features/partner-sign/partner-sign.test.tsx » body Lưu chỉ có vị trí + file_id, không ảnh, chưa ký ô nào ⇒ null]
- Kịch bản: khi gọi API link thì token được mã hoá trong đường dẫn [test: apps/workspace-web/src/features/partner-sign/partner-sign.test.tsx » đường dẫn mã hoá token và id]
- Kịch bản: khi hiện ngày thì theo giờ Việt Nam [test: apps/workspace-web/src/features/partner-sign/partner-sign.test.tsx » ngày theo giờ Việt Nam]
- Kịch bản: khi đối tác mở link, tạo chữ ký nhanh và ký ô Bên B thì thấy «Bạn đã ký xong», HĐ thành «Đã ký» [test: e2e/cr181/partner-sign-link.spec.ts » đối tác (không đăng nhập): mở link → tạo chữ ký nhanh → ký ô Bên B ⇒ «Bạn đã ký xong»]
- Kịch bản: khi đối tác ký xong thì công ty thấy HĐ «Đã ký» [test: e2e/cr181/partner-sign-link.spec.ts » công ty: HĐ «Đã ký» sau khi đối tác ký]

#### Yêu cầu: Trang hợp đồng thấy trạng thái link ký và gửi lại được
Khối «Chờ đối tác ký» ở trang hợp đồng hiện đã gửi lúc, đã mở lúc (hoặc «Chưa mở»), hạn ký và, khi đối tác từ chối, cả lý do. Người tải lên hoặc quản trị bấm «Gửi lại link» để thu hồi link cũ và gửi link mới; thành công có thông báo, thất bại nói chỉ người tải lên hoặc quản trị gửi lại được. Link đã ký thì không còn nút gửi lại.
- Kịch bản: khi link đang chờ thì hiện đã gửi lúc, chưa mở, hạn [test: apps/workspace-web/src/features/doc-sign/lib/partner-link-view.test.ts » đang chờ: đã gửi lúc, chưa mở, hạn]
- Kịch bản: khi link đã mở hoặc không còn chờ thì hiện giờ mở và bỏ hạn [test: apps/workspace-web/src/features/doc-sign/lib/partner-link-view.test.ts » đã mở: có giờ mở, không còn chờ ⇒ không hiện hạn]
- Kịch bản: khi xét nút gửi lại thì mọi trạng thái trừ đã ký [test: apps/workspace-web/src/features/doc-sign/lib/partner-link-view.test.ts » gửi lại: mọi trạng thái trừ «đã ký», chưa gửi link ⇒ không có nút]
- Kịch bản: khi Bên A ký đủ thì trang HĐ chờ đối tác kèm trạng thái link và nút gửi lại [test: e2e/cr181/partner-sign-link.spec.ts » công ty: sale tạo → trưởng phòng duyệt → giám đốc ký ⇒ HĐ chờ đối tác (Bên A đủ), có link ký]
