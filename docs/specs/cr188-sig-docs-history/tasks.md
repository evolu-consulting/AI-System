---
id: cr188-sig-docs-history
lát: cr188-sig-docs-history
cr: CR-188
làn: đầy đủ
migration: pack-contracts 0125
phụ thuộc: cr188-sign-caption-stamp
---
## Plan (ngắn)
BR-188-4: danh sách phiên bản chữ ký (số bản, ngày tạo, đang dùng) trong «Chữ ký của tôi»; chính chủ + quản trị công ty xem được.
BR-188-5: bấm một bản ⇒ ngăn «Giấy tờ đã ký bằng chữ ký này» (HĐ / phụ lục / giấy tờ khác), lọc loại + khoảng ngày, «Mở». Chỉ giấy tờ người xem có quyền mở HĐ.

## Làm
- [x] Migration pack-contracts 0125: index một phần `sign_marks (tenant_id, user_signature_id) WHERE user_signature_id IS NOT NULL` (`when` 1807000595000 < 0126-cr190 = 1807000600000).
- [x] contracts `pack-contracts/sig-docs.ts` (query, item, response, `SIG_DOCS_PAGE` = 50).
- [x] API `GET /pack/contracts/my-signatures/:sigId/documents?kind=&from=&to=&cursor=`: `sig-docs.repo.ts` MỘT câu SQL (CTE `own` + `page`), `sig-docs.routes.ts`, `domain/sig-docs.rules.ts` (con trỏ), gắn ở `upload.mount.ts`.
- [x] Web: `SignatureVersions` (số bản, «Đang dùng»), `SignedDocsPanel` (lọc + «Mở» + «Xem thêm»), `lib/versions.ts`, hook `useSigDocs`, i18n `contracts.mySig.versions|docs`.

## Không làm / Chạm
Không sửa `hub.user_signatures`, không thêm hàm hub. Chủ chữ ký suy từ `sign_marks.signer_id` (không đọc bảng hub): chữ ký chưa in lên giấy tờ nào ⇒ rỗng; có dấu của người khác ⇒ 403 trừ quản trị. Màn của quản trị xem chữ ký người khác chưa có (chỉ API, BR-188-4: ai xem = chính chủ + quản trị).

## Test tối thiểu
unit `sig-docs.rules.test.ts`, `sig-docs.test.tsx`; int `sig-docs.int.test.ts` (evotest `-Dirty`); e2e `e2e/cr181/cr188-sig-docs.spec.ts` (chưa chạy).

## Quyết định trong lúc làm
- Ai là chủ chữ ký: `sign_marks.signer_id` = chủ (người ký thật); quản trị công ty = `tenant_admin` ∨ quyền `admin` gói Sổ Hợp Tác (cùng luật `ledger.routes.ts isAdmin`).
- HĐ đã giao cho người khác thì người tạo hết quyền mở ⇒ không hiện ở danh sách của người tạo (đúng RLS xem HĐ).
- «Giấy tờ khác» = HĐ khung/giao dịch (`doc_type <> 'contract'`, không phải phụ lục) — cùng `docKindOf` của Kiểm tra tệp.
- Bản ký đã huỷ (`voided_at`) không tính. «Mở» đưa tới trang HĐ `/contracts/c/:id`.
- Số bản đếm riêng cho chữ ký chính và chữ ký tắt, cũ nhất = 1.
- Journal: `idx` 118 trùng với 0126-cr190 ở nhánh của nó ⇒ điều phối đổi idx của 0126 thành 119 khi gộp.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/giay-to-da-ky-bang-chu-ky.md
#### Yêu cầu: Giấy tờ đã ký bằng chữ ký này
Từ một phiên bản chữ ký, xem HĐ / phụ lục / giấy tờ khác đã ký bằng nó (mới → cũ, 50 dòng một trang, một câu SQL), lọc theo loại và khoảng ngày, mỗi dòng có «Mở». Chỉ hiện giấy tờ người xem có quyền mở. Chỉ chính chủ và quản trị công ty xem được.
- Kịch bản: khi người khác không phải quản trị hỏi chữ ký của tôi thì bị từ chối [test: apps/hub-api/src/modules/packs/contracts/adapters/sig-docs.int.test.ts » người KHÁC (không phải quản trị) hỏi chữ ký của u1 ⇒ 403]
- Kịch bản: khi quản trị hỏi chữ ký của người khác thì xem được [test: apps/hub-api/src/modules/packs/contracts/adapters/sig-docs.int.test.ts » quản trị xem được chữ ký của người khác]
- Kịch bản: khi người được giao (không phải người tạo) xem thì thấy HĐ của mình, HĐ không có quyền không hiện [test: apps/hub-api/src/modules/packs/contracts/adapters/sig-docs.int.test.ts » N2: người được giao (không phải người tạo) thấy HĐ giao cho mình, HĐ không có quyền mở KHÔNG hiện]
- Kịch bản: khi lọc theo loại thì chỉ ra đúng loại [test: apps/hub-api/src/modules/packs/contracts/adapters/sig-docs.int.test.ts » lọc theo loại]
- Kịch bản: khi lọc theo khoảng ngày thì gồm cả ngày cuối [test: apps/hub-api/src/modules/packs/contracts/adapters/sig-docs.int.test.ts » lọc theo khoảng ngày (gồm cả ngày cuối)]
- Kịch bản: khi xem trang sau thì tiếp ngay sau dòng cuối trang trước [test: apps/hub-api/src/modules/packs/contracts/adapters/sig-docs.int.test.ts » con trỏ: trang sau bắt đầu sau dòng cuối của trang trước]
- Kịch bản: khi tải danh sách thì chỉ một câu SQL [test: apps/hub-api/src/modules/packs/contracts/adapters/sig-docs.int.test.ts » perf: mỗi lần gọi đúng MỘT câu SQL (cả lọc + con trỏ)]
- Kịch bản: khi trang đầy 50 dòng thì cắt và có con trỏ [test: apps/hub-api/src/modules/packs/contracts/domain/sig-docs.rules.test.ts » trang đầy 50 + 1 dòng thừa ⇒ cắt 50 và có con trỏ, ít hơn thì hết]

### ADDED hub/chu-ky-lich-su-phien-ban.md
#### Yêu cầu: Phiên bản chữ ký và giấy tờ đã ký
Trong «Chữ ký của tôi», lịch sử hiện từng phiên bản (số bản, ngày tạo, «Đang dùng»); bấm một bản mở ngăn giấy tờ đã ký bằng nó, có lọc loại + ngày và nút «Mở».
- Kịch bản: khi có nhiều phiên bản thì đánh số cũ nhất là 1 và dán nhãn bản đang dùng [test: apps/workspace-web/src/features/my-signature/sig-docs.test.tsx » đánh số cũ nhất = 1, mỗi loại đếm riêng, đánh dấu bản đang dùng]
- Kịch bản: khi hiện danh sách phiên bản thì có ngày tạo và «Đang dùng» [test: apps/workspace-web/src/features/my-signature/sig-docs.test.tsx » danh sách có số bản, ngày tạo, «Đang dùng», bản được chọn aria-pressed]
- Kịch bản: khi mở ngăn giấy tờ thì có ba ô lọc và câu «rỗng» nói rõ lý do [test: apps/workspace-web/src/features/my-signature/sig-docs.test.tsx » có ô lọc loại + từ ngày + đến ngày, rỗng thì câu nói rõ lý do]
- Kịch bản: khi đang tải, lỗi hoặc còn trang thì hiện đúng trạng thái [test: apps/workspace-web/src/features/my-signature/sig-docs.test.tsx » đang tải thì không hiện «rỗng», lỗi thì báo lỗi, còn trang thì «Xem thêm»]
- Kịch bản: khi chủ chữ ký chọn một bản thì thấy ngăn giấy tờ và lọc [test: e2e/cr181/cr188-sig-docs.spec.ts » Chủ chữ ký chọn một bản ⇒ ngăn «Giấy tờ đã ký bằng chữ ký này» + lọc]

## Việc còn lại
- Chạy e2e cuối đợt (điều phối). Soát Opus: SQL `sig-docs.repo.ts` (RLS xem HĐ, cờ chủ chữ ký) + route.
- Gộp journal: đổi `idx` của 0126-cr190 thành 119.
