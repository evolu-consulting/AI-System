---
id: s8-sign-api
lát: s8-sign-api
cr: CR-181
làn: nhanh
migration: không
phụ thuộc: s6-sign-db, s7-sign-stamp
---
## Plan (ngắn)
API phía HĐ cho «Ký trên tài liệu» (decisions.md §5). PHẦN A (xong): cờ «Cần ký», người ký, đặt chỗ ký, phiên chuẩn bị/ký/xem + luật thuần + cổng lượt ký.
PHẦN B (chưa giao): POST Lưu chữ ký, các bản, nội dung bản, chặn Gửi duyệt, cài `SignTurnPort` thật.

## Làm
- [x] A · `domain/sign.rules.ts` (+ test): người tải lên, `canPrepSign`, `needsSignIssue` (PDF/mật khẩu/≤ 50 trang), `defaultNeedsSign`, `fieldsIssue`, `normalizeFields`, `signReadiness`, `sessionMode`.
- [x] A · `domain/sign-turn.port.ts`: `SignTurnPort.turnFor` + `noTurn`.
- [x] A · `adapters/sign-doc.repo.ts` (tệp chính+kèm, đối tác), `sign-pdf-probe.ts`, `application/sign-doc.usecase.ts`, `adapters/sign-doc.routes.ts`, `sign-doc.mount.ts`, `packs.sign-doc.ts` (cổng hub), schema API trong `packages/contracts/.../doc-sign.ts`.
- [x] A · int `adapters/sign-doc.int.test.ts` (12 ca; evotest xanh).
- [ ] B · POST Lưu chữ ký · bản · nội dung bản (gồm `GET /sign-docs/:fileId/content` bản gốc) · chặn Gửi duyệt (dùng `signReadiness`) · cài `SignTurnPort` thật (s9).

## Không làm / Chạm
Không web, không Lưu chữ ký, không migration. Chạm: `packages/contracts/src/pack-contracts/doc-sign.ts`, `apps/hub-api/src/modules/packs/contracts/{domain,application,adapters}/sign*`, `contracts/sign-doc.mount.ts`, `packs/packs.sign-doc.ts`, `packs/packs.contracts-attachments.ts`.

## Test tối thiểu
`bun test apps/hub-api/src/modules/packs/contracts/domain/sign.rules.test.ts` → 11 pass; `run-tests.ps1 -Step int -Dirty -Filter apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts` → 12 pass.

## Quyết định trong lúc làm
- Đường phiên là `GET /contracts/:id/doc-sign-session` (không phải `/sign-session`): `/contracts/:id/sign-session` đã là phiên ký chung CR-127 (`sign-session.routes.ts`). Web s12 gọi đường mới.
- Thứ tự kiểm PATCH/PUT: 404 → 403 (không phải người tải lên, kể cả quản trị gói) → 409 `SIGN_ON_DOC_OFF` → 409 `CONTRACT_NOT_DRAFT` → 422. PUT vào tệp chưa «Cần ký» ⇒ 409 `SIGN_FILE_NOT_NEEDED`. Mã 422: `SIGN_NOT_PDF|SIGN_PDF_ENCRYPTED|SIGN_PDF_INVALID|SIGN_TOO_MANY_PAGES|SIGN_SIGNER_UNKNOWN|SIGN_PAGE_NOT_FOUND|SIGN_FIELDS_TOO_MANY`.
- Tệp chưa có hàng `sign_docs`: tệp chính hiệu lực «Cần ký» khi công ty bật và là PDF (Q14), tệp kèm tắt; PUT chỗ ký tạo hàng `sign_docs` (đếm trang lúc đó).
- Chỗ ký chỉ kiểm số trang (`parts.page < pages`); kích thước/xoay thật của trang kiểm lúc Lưu (s7 `resolveParts`) — tránh tải PDF mỗi lần PUT.
- `signer_ref`: user/group = uuid; partner = email liên hệ (chữ thường), lưu chữ thường. `label` do máy chủ điền (nhóm = «Đại diện <nhóm>»).
- `readiness` (BR-C3) chỉ đòi chỗ ký cho người ký Bên A; Bên B không chặn (Q6). `NO_SIGN_FILE` khi không có tệp cần ký; s9 quyết có áp hay không (BR-T2).
- `latest.url` là đường tương đối dưới `/pack/contracts`: bản đã ký `/contracts/:id/sign-docs/:fileId/versions/:vid/content`, bản gốc `/contracts/:id/sign-docs/:fileId/content` — HAI đường này thuộc phần B.
- Người ký công ty (Q2) lấy từ quy trình Bật đầu tiên (`contract.submitted`, theo `position`) có bước `contracts-esign-send` với `company_signers` (`packs.sign-doc.ts`); tên người từ `packAssignees` (người có quyền xem gói), tên nhóm + `mine` từ `admin.groups`/`group_members`. HĐ đã có lượt chạy ⇒ s9 đổi sang quy trình của lượt.
- Thiết lập công ty `on_doc_enabled` đọc qua `signaturesRepo(tx).getSettings()` (s1) trong `packs.sign-doc.ts` (gói không import module hub).
- Công ty tắt ⇒ session `{enabled:false, mode:"view", files:[], signers:[]}` chỉ 1 câu SQL (kiểm HĐ thấy được).
- Số câu SQL: session ≤ 6 (facts, tệp, đối tác, cờ, chỗ ký, bản) + 1 cổng hub thiết lập + cổng người ký; PATCH/PUT 2 tx nhỏ, đọc tệp FileBox ngoài tx.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Chỉ người tải lên đánh dấu «Cần ký» và đặt chỗ ký, khi hợp đồng chưa khoá
Người tải lên tệp (tệp chính = người tạo hợp đồng, tệp kèm = người gắn tệp) bật/tắt «Cần ký» và đặt chỗ ký cho từng người ký, chỉ khi hợp đồng còn Nháp hoặc bị trả lại. Người khác, kể cả quản trị gói, không làm được. Công ty chưa bật «Ký trên tài liệu» thì không làm được.
- Kịch bản: khi người được giao (không phải người tải lên) bật «Cần ký» thì bị từ chối, còn người tải lên tệp kèm của mình bật được [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts » T1: người được giao / không phải người tải lên ⇒ forbidden, tệp kèm của U2 thì CHỈ U2 (người tạo HĐ cũng không)]
- Kịch bản: khi hợp đồng đang duyệt hoặc công ty tắt tính năng thì bật «Cần ký» bị từ chối [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts » HĐ đang duyệt ⇒ locked (409 CONTRACT_NOT_DRAFT), công ty tắt ⇒ off (409 SIGN_ON_DOC_OFF)]
- Kịch bản: khi người khác đặt chỗ ký thì bị từ chối, và chỗ ký gán cho người không thuộc danh sách người ký thì bị từ chối [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts » C2: người khác (kể cả quản trị gói) ⇒ forbidden, C1: người ký lạ / trang ngoài tệp ⇒ 422]
- Kịch bản: khi công ty khác gọi thì thấy không có hợp đồng (404) [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts » khác công ty ⇒ not_found (không lộ tồn tại)]

#### Yêu cầu: Tệp cần ký phải là PDF, không mật khẩu, tối đa 50 trang
Word, tệp có mật khẩu hoặc trên 50 trang không bật được «Cần ký» (báo lý do). Tệp chính của hợp đồng mặc định «Cần ký» khi công ty bật; tệp kèm mặc định tắt. Tắt «Cần ký» thì bỏ các chỗ ký chưa ký của tệp đó.
- Kịch bản: khi bật «Cần ký» cho PDF 3 trang thì lưu số trang; Word hoặc PDF 51 trang bị từ chối [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts » PDF 3 trang bật được, số trang lưu, Word ⇒ SIGN_NOT_PDF, 51 trang ⇒ SIGN_TOO_MANY_PAGES, tệp lạ ⇒ not_found]
- Kịch bản: khi tắt «Cần ký» thì chỗ ký chưa ký của tệp bị xoá [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts » tắt «Cần ký» ⇒ xoá chỗ ký chưa ký của tệp đó]
- Kịch bản: khi tệp chính chưa đặt cờ thì mặc định cần ký và đặt chỗ ký được ngay; tệp kèm chưa bật thì không đặt được [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts » đặt chỗ ký: nhóm ⇒ nhãn «Đại diện …», id lạ bị bỏ (máy chủ sinh), thay toàn bộ, tệp chính mặc định bật nên đặt được ngay; apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts » tệp kèm chưa bật «Cần ký» ⇒ not_needed]

#### Yêu cầu: Người ký lấy từ bước Ký của quy trình và liên hệ đối tác
Người ký Bên A là từng người của bước Ký; nhóm thì một mục «Đại diện <nhóm>». Người ký Bên B là liên hệ đầu tiên của đối tác có email.
- Kịch bản: khi xem danh sách người ký thì thấy từng người và «Đại diện <nhóm>», người gọi được đánh dấu là «của tôi» [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts » signers: Bên A theo company_signers (người ⇒ một, nhóm ⇒ «Đại diện …»), có Bên B khi đối tác có liên hệ email, khác công ty ⇒ null]

#### Yêu cầu: Màn ký có đúng chế độ chuẩn bị, ký hoặc xem
Người tải lên khi hợp đồng chưa khoá vào chế độ chuẩn bị; người đang có lượt ký vào chế độ ký; còn lại chỉ xem. Còn thiếu gì để gửi duyệt hiện sẵn. Công ty tắt thì không có màn ký.
- Kịch bản: khi người tải lên, người có lượt và người xem mở thì mỗi người vào đúng chế độ, kèm danh sách còn thiếu [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts » session: người tải lên ⇒ prep (readiness nói thiếu), người có lượt (cổng giả) ⇒ sign, người xem ⇒ view, khác công ty ⇒ null]
- Kịch bản: khi công ty tắt «Ký trên tài liệu» thì phiên báo tắt và không có tệp [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-doc.int.test.ts » công ty tắt ⇒ session enabled=false, mode view, không tệp]
- Kịch bản: khi xét ai được chuẩn bị, tệp nào cần ký, chỗ ký nào hợp lệ, còn thiếu gì thì luật thuần cho đúng kết quả [test: apps/hub-api/src/modules/packs/contracts/domain/sign.rules.test.ts » BR-C3 signReadiness]

## Việc còn lại
- PHẦN B (xem Làm). Chưa làm: `SignTurnPort` thật (đang `noTurn`), chặn Gửi duyệt, nội dung tệp.
- `packs.sign-doc.ts` import `processes/library/event-flow.repo` (không qua `public.ts`): nếu depcruise/`check:modules` đòi cửa công khai ⇒ thêm `eventFlowsOf` vào `processes/public.ts`.
- Ngoài lát: `tsc --noEmit` hub-api còn lỗi cũ `pmsg-db.int.test.ts:412`.
