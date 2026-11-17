---
id: s13-sign-contract-ui
lát: s13-sign-contract-ui
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s8-sign-api, s12-sign-modes, s4-sig-gate (đã gộp); s9 (backend: submit_block ký, SIGN_REQUIRED, máy chủ gắn chữ ký) đang làm
---
## Plan (ngắn)
Đưa ký trên tài liệu vào trang hợp đồng. Mọi thứ chỉ hiện khi `session.enabled` (công ty bật); tắt ⇒ giao diện y như cũ.
Nguồn dữ liệu: `GET /contracts/:id/doc-sign-session` (hook `useContractSign`, một query dùng chung bảng tệp, dải người ký, thẻ duyệt).

## Làm
- [x] Bảng «Tài liệu kèm» (`SignFilesList`): Cần ký (công tắc), Chỗ ký (● n · ● m / «Chưa đặt»), Tình trạng (Tham khảo / Chưa ký / n/m / Chờ đối tác / Đã ký đủ), «Xem» / «Xem bản đã ký» (liên kết `/contracts/signed/$id?file=`; trang do s14). Tệp chính dòng đầu «Hợp đồng chính». Công tắc khoá + tooltip lý do (không phải người tải lên / HĐ đã khoá / không phải PDF). Lỗi Word, >50 trang, có mật khẩu ⇒ câu nghiệp vụ.
- [x] Đầu trang: dải người ký (`SignersStrip`): tên · bên · «n chỗ ký» / «Chưa có chỗ ký» / «Đã ký».
- [x] Thẻ người tải lên (`PrepCard`): danh sách kiểm tra từ `readiness` + «Chuẩn bị chỗ ký» → `/contracts/sign/$id`; `head-rule` mở rộng `submitBlock` (`sign_no_files`, `sign_missing_fields`) ⇒ nút Gửi duyệt / Gửi lại khoá kèm câu lý do; nút «Xác nhận» của thẻ duyệt cũng khoá cùng lý do.
- [x] Thẻ duyệt: khung «Ký trên tài liệu» (`ApproverSignBox`) thay ô vẽ tay; tệp tuỳ chọn; ô Ý kiến giữ; «Đạt» khoá tới khi ký đủ (tính từ session); 409 `SIGN_REQUIRED` hiện câu lỗi. Lượt bước Ký (`turn.step = "sign"`): thẻ «Ký hợp đồng» (`SignTurnCard`) chỉ có «Mở và ký».
- [x] Q4: công ty bật ⇒ `docSignRule` bỏ ô vẽ tay ở mọi `EvidenceAsk` của thẻ duyệt HĐ (máy chủ gắn «Chữ ký của tôi»).
- [x] Nhãn lỗi i18n (VI/EN, `contracts.docsignc.err.*`): `SIGN_NOT_READY`, `SIGN_REQUIRED`, `DIGITAL_SIGN_NOT_ENABLED`, `SIGNATURE_MISSING`, `SIGN_VERSION_STALE`, `SIGN_NOT_PDF`, `SIGN_PDF_ENCRYPTED`, `SIGN_PDF_INVALID`, `SIGN_TOO_MANY_PAGES`; nối vào `approval-error`, `api-exec`, `claim.ts`.
- [x] e2e viết sẵn (chưa chạy): `e2e/cr181/contract-page-sign.spec.ts`.

## Không làm / Chạm
Không làm: trang Xem bản đã ký (s14), Hồ sơ duyệt (s10), màn ký.
Chạm: `features/contract-files/**`, `features/contract-review/{components/ContractBody.tsx,lib/head-rule.ts,api-exec.ts}`, `features/contract-approval/**`, `features/doc-sign/{lib/contract-view.ts,hooks/use-contract-sign.ts,components/contract/**}`, `platform/flow/{ui/EvidenceAsk,ui/EvidenceInput,lib/evidence,lib/claim}`, `packages/i18n` (`docsignc.*.json`, `contracts-locales.ts`).

## Test tối thiểu
- `bun test` (apps/workspace-web): `doc-sign/lib/contract-view.test.ts`, `contract-files/components/sign-files.test.tsx`, `contract-review/lib/head-rule.test.ts`.
- `tsc --noEmit` workspace-web, biome file đổi, `check:ui-kit`, `i18n:check`.

## Quyết định trong lúc làm
- Khoá i18n `contracts.docsignc.*` (không `contracts.docsign.c.*`): các tệp chuỗi gộp NÔNG ở nhánh thứ hai nên `docsign.c` ghi đè `docsign`; thêm `docsignc` vào `contracts-locales.ts` (kiểu `Parts` +1).
- Bên A = công ty, Bên B = đối tác. Tình trạng n/m đếm chỗ ký Bên A; «Chờ đối tác» = Bên A xong, còn Bên B chưa ký (Q6, không chặn).
- Công tắc khoá khi `session.locked` hoặc `!can_prep`; tệp không PDF chưa bật ⇒ khoá «chỉ PDF» (Q13). Lỗi PDF khác (mật khẩu, >50 trang) do máy chủ trả 422 ⇒ câu nghiệp vụ.
- Tệp xem được: PDF qua `…/sign-docs/:fileId/content` (bản mới nhất); không PDF qua link tệp gắn như cũ.
- Dòng quyết định ở Việc của tôi (`InboxDecisionRow`) vốn KHÔNG có ô vẽ tay (RULE `files:false`, `signature:false`) và là HĐ đối tác gửi tới, không thuộc bước ký ⇒ không đổi; ô vẽ chỉ còn ở thẻ duyệt trang HĐ (đã xử lý bằng `docSignRule`).
- `head-rule`: `submitBlock` nhận cả mã lạ ⇒ coi như không chặn (không đoán). Lý do chặn ký ⇒ khoá `contracts.docsignc.block.*`.
- Liên kết tới `/contracts/sign/$id` ép kiểu (`as never`): `routeTree.gen.ts` ở HEAD thiếu route này trong union `fullPaths/to` (ghi chú trong `SignBox.tsx`); gỡ ép kiểu khi sinh lại cây route. «Xem bản đã ký» là thẻ `<a href>` (route do s14).
- Thẻ duyệt: khung ký chỉ hiện khi có chỗ ký của MÌNH trên tệp cần ký; không có ⇒ không khoá «Đạt».

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tai-lieu-kem.md
#### Yêu cầu: Một khối «Tài liệu kèm» cho mọi tệp ngoài file chính
Hai nhóm trong một chỗ: tệp gắn thẳng vào HĐ (Word, Excel, ảnh… theo danh sách nhận được; thêm/gỡ/xem/tải) và tệp kèm các bước duyệt (chỉ đọc, ghi rõ khi nào được kèm). Công ty bật ký trên tài liệu thì bảng có thêm tệp chính (dòng đầu «Hợp đồng chính») và các cột Cần ký, Chỗ ký, Tình trạng; công ty tắt thì giữ như cũ.
- Kịch bản: thêm .docx ⇒ hiện trong khối, có link tải, rồi gỡ [test: apps/hub-api/src/modules/packs/contracts/adapters/contract-files.int.test.ts » thêm → liệt kê hai nhóm → link tải → gỡ]
- Kịch bản: gom hai nhóm và tính quyền gỡ từng dòng [test: apps/hub-api/src/modules/packs/contracts/domain/contract-files.rules.test.ts » hai nhóm trong một khối]
- Kịch bản: e2e thêm .docx thấy trong khối và tải được [test: thủ công — e2e/contract-files/contract-files.spec.ts viết sẵn, chạy một lần cuối đợt]
- Kịch bản: khi bật ký thì tệp chính là dòng đầu «Hợp đồng chính» [test: apps/workspace-web/src/features/contract-files/components/sign-files.test.tsx » tệp chính là dòng đầu, nhãn «Hợp đồng chính»]
- Kịch bản: khi người dùng không phải người tải lên thì công tắc Cần ký khoá kèm lý do, chỗ ký hiện «Chưa đặt» [test: apps/workspace-web/src/features/contract-files/components/sign-files.test.tsx » công tắc khoá với người không tải lên, chỗ ký «Chưa đặt»]
- Kịch bản: khi tệp đã ký thì hiện «Xem bản đã ký» trỏ tới trang bản đã ký [test: apps/workspace-web/src/features/contract-files/components/sign-files.test.tsx » tệp đã ký ⇒ «Xem bản đã ký» trỏ /contracts/signed/…?file=]
- Kịch bản: tình trạng tệp đúng 5 trạng thái [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » Chưa ký (chưa đặt chỗ / chưa ai ký)]
- Kịch bản: khi bật ký, người tải lên bấm được công tắc, người khác thì không [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » khoá với người không tải lên]
- Kịch bản: dải người ký ghi Đã ký / n chỗ / Chưa có chỗ [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » chip: Đã ký / n chỗ / Chưa có chỗ]
- Kịch bản: Gửi duyệt khoá kèm lý do khi thiếu tệp cần ký hoặc chỗ ký [test: apps/workspace-web/src/features/contract-review/lib/head-rule.test.ts » nút chính khoá kèm câu lý do ký]
- Kịch bản: hành trình sale chuẩn bị chỗ ký, gửi, người khác ký rồi duyệt [test: e2e/cr181/contract-page-sign.spec.ts » người duyệt (khác người tạo): «Đạt» khoá tới khi ký đủ, không còn ô vẽ tay]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Người duyệt chỉ thấy Duyệt · Trả lại sửa · Từ chối
Ở bước duyệt, người có quyền chỉ thấy ba nút Duyệt, Trả lại sửa, Từ chối (Từ chối và Trả lại bắt buộc ghi lý do). Không dùng chữ "Đạt" hay "Cần quyết". Công ty bật ký trên tài liệu và HĐ có tệp cần ký thì ô vẽ chữ ký được thay bằng khung «Ký trên tài liệu» (số chỗ ký của bạn, đã ký x/y tệp, «Mở và ký»); nút Duyệt khoá tới khi ký đủ chỗ của mình, tệp đính kèm thành tuỳ chọn. Không có tệp cần ký thì không vẽ tay, máy chủ gắn chữ ký của người duyệt.
- Kịch bản: khi người duyệt mở thẻ thì đúng ba nút, không Xác nhận/Đọc lại [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » nút theo vai (người duyệt chỉ thấy Duyệt · Trả lại sửa · Từ chối)]
- Kịch bản: khi đọc chuỗi tiếng Việt của ứng dụng Hợp đồng thì không còn "Cần quyết", "Giai đoạn", "Đạt", "đi tới" [test: apps/workspace-web/src/features/contract-approval/lib/card-status.test.ts » từ vựng thẻ duyệt trong chuỗi contracts]
- Kịch bản: khi chưa ký đủ thì nút Duyệt khoá, ký đủ thì mở, và không có ô vẽ tay [test: apps/workspace-web/src/features/contract-files/components/sign-files.test.tsx » Đạt khoá khi chưa ký đủ, mở khi đủ, không có ô vẽ tay]
- Kịch bản: khi bật ký thì không cần chữ ký tay, chỉ cần ý kiến [test: apps/workspace-web/src/features/contract-files/components/sign-files.test.tsx » ô vẽ tay ẩn, không cần chữ ký/tệp, chỉ cần ý kiến]
- Kịch bản: tiến độ ký của người duyệt tính từ phiên [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » chưa ký đủ ⇒ chưa ready]
- Kịch bản: mã lỗi SIGN_REQUIRED / SIGN_NOT_READY hiện câu nghiệp vụ [test: apps/workspace-web/src/features/doc-sign/lib/contract-view.test.ts » mã lỗi ký ⇒ khoá i18n]

## Việc còn lại
- Chưa chạy e2e `e2e/cr181/contract-page-sign.spec.ts` (điều phối chạy cuối đợt). «Xem bản đã ký» chờ s14.
- Khi s9 gộp: kiểm `submit_block` thật trả `sign_no_files` / `sign_missing_fields`; cân nhắc thêm vào `SUBMIT_BLOCKS` trong `packages/contracts/src/pack-contracts/submit.ts` (backend).
