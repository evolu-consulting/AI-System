---
id: s6-sign-db
lát: s6-sign-db
cr: CR-181
làn: nhanh
migration: có (pack-contracts 0121)
phụ thuộc:
---
## Plan (ngắn)
Bốn bảng gói Sổ Hợp Tác cho «Ký trên tài liệu» (decisions.md §3) + ba repo (cờ, chỗ ký, bản + dấu). Không route, không luật quyền (s8), không in PDF (s7).

## Làm
- [x] Migration `0121_cr181_sign_on_doc.sql` + journal (idx 117): `sign_docs`, `sign_versions`, `sign_fields`, `sign_marks`; `secure_table` cả 4.
- [x] `adapters/sign-docs.repo.ts` · `sign-fields.repo.ts` · `sign-versions.repo.ts` (số câu cố định: set 1; replaceForFile 1; markSigned 1; add 2; latest/latestByContract/list 1; voidByRun 1).
- [x] int `adapters/sign-on-doc.int.test.ts` (8 ca; evotest xanh).

## Không làm / Chạm
Không route HTTP, không luật quyền, không in PDF, không web. Chạm: `packages/db/migrations-pack-contracts/**`, `apps/hub-api/.../contracts/adapters/sign-{docs,fields,versions}.repo.ts`.

## Test tối thiểu
`run-tests.ps1 -Step int -Dirty -Filter apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts` → 8 pass.

## Quyết định trong lúc làm
- Gói contracts không có schema Drizzle (SQL thô + kiểu hàng khai trong repo, như `contract_files`) ⇒ không thêm kiểu Drizzle; kiểu `Sign*Row` nằm trong repo.
- `sign_fields`/`sign_versions` FK về `sign_docs (contract_id, file_id, tenant_id)` (thay FK riêng về `contracts`): cùng HĐ/tệp/công ty, xoá HĐ ⇒ cascade cả chuỗi; `sign_docs` giữ FK `contracts` + `files`. `out_file_id` FK `files` RESTRICT.
- Unique bản = (tenant_id, contract_id, file_id, seq); `seq` tính trong câu CHÈN SAU khi khoá `sign_docs FOR UPDATE` (câu riêng ⇒ snapshot mới, đua không trùng). `seq` không tái dùng khi void.
- `replaceForFile` giữ nguyên chỗ ĐÃ ký (lịch sử); chỗ chưa ký không có trong danh sách bị xoá, trùng `id` ⇒ cập nhật (id ổn định cho s8/web).
- `voidByRun` (Q17) cũng mở lại chỗ đã ký trong các bản bị void (`signed_by`/`signed_version_id` = null) để «gửi lại ký trên bản gốc» ký lại được. Cùng một câu.
- `sign_marks.ord` giữ thứ tự dấu trong bản (cùng câu chèn ⇒ cùng `created_at`). Index FK: `sign_docs(file_id,tenant_id)`, `sign_versions(out_file_id,tenant_id)`.
- `sign_marks.field_id` và `user_signature_id` không có FK (lịch sử; hub ở schema khác); `user_signature_id` NOT NULL (dấu luôn từ chữ ký đã lưu — BR-K3); cột người ký tên `signer_id`.
- `sign_docs.pages` cho phép null (chưa đếm), 1..50; `set(.., pages=null)` giữ số trang cũ.
- Repo không kiểm trạng thái HĐ/quyền (use case s8); `add`/`set` trả null khi HĐ/tệp không thuộc công ty.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED docs/current/pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Lưu trữ cờ «Cần ký», chỗ ký, bản đã ký và dấu theo từng tệp của hợp đồng
Mỗi tệp của HĐ (tệp chính hoặc tệp kèm) có thể được đánh dấu «Cần ký» (kèm số trang, tối đa 50). Chỗ ký, bản đã ký và dấu chữ ký lưu theo công ty,
chỉ người trong công ty đó đọc/ghi được. Tệp gốc không bị sửa: mỗi lần Lưu thêm một «Bản» mới (số thứ tự 1, 2, 3… không trùng, kể cả khi nhiều người Lưu cùng lúc).
Chỗ ký và dấu mang hình học `SignParts` (1–5 trang liên tiếp).
- Kịch bản: khi công ty khác đọc hoặc ghi cờ, chỗ ký, bản, dấu của HĐ này thì không thấy gì và không ghi được [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » công ty khác không đọc/ghi được cả bốn bảng]
- Kịch bản: khi người được giao (không phải người tạo) đặt cờ «Cần ký» thì đọc lại thấy cờ, số trang giữ khi đổi cờ không kèm số trang [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » đặt → đọc → đổi cờ giữ số trang khi pages null; apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » HĐ không có ⇒ null]
- Kịch bản: khi thay chỗ ký của tệp A thì tệp B giữ nguyên, hình học giáp lai lưu và đọc khớp [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » thay chỗ ký tệp A không đụng tệp B; apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » parts jsonb khớp SignPartsSchema]
- Kịch bản: khi thay chỗ ký mà có chỗ đã ký thì chỗ đã ký được giữ nguyên [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » chỗ đã ký là lịch sử: replace không xoá/sửa; apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » markSigned; apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » void mở lại]
- Kịch bản: khi lưu các bản liên tiếp thì số thứ tự tăng 1, 2, 3; bản mới nhất chưa bị huỷ là bản được dùng tiếp [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » seq tăng 1,2,3; apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » latest = bản mới nhất; apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » list kèm dấu; apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » parts khớp schema]
- Kịch bản: khi hai người Lưu cùng lúc thì mỗi người một số thứ tự khác nhau, không lỗi [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » thêm bản cho tệp chưa có sign_docs ⇒ null; apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » hai lần thêm ĐỒNG THỜI ⇒ seq khác nhau, không lỗi trùng]

#### Yêu cầu: Trả lại / Từ chối huỷ bản đã ký của lượt đó (không xoá)
Khi lượt duyệt bị trả lại hoặc từ chối, mọi bản đã ký của lượt đó được đánh dấu huỷ (vẫn xem được trong lịch sử) và các chỗ ký đã ký trong các bản đó mở lại để ký lại trên bản gốc. Bản của lượt khác và của công ty khác không bị đụng.
- Kịch bản: khi huỷ theo lượt A thì chỉ bản của lượt A bị huỷ, bản lượt B vẫn là bản mới nhất, số thứ tự vẫn tăng tiếp [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » void theo run_id chỉ đụng bản của lượt đó; apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » latest bỏ bản void; apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » seq vẫn tăng tiếp]

#### Yêu cầu: Ràng buộc dữ liệu chỗ ký
Bên chỉ là A hoặc B; người ký là người dùng, nhóm hoặc đối tác; chỗ ký có 1–5 phần; tệp ký phải là tệp của công ty.
- Kịch bản: khi ghi giá trị sai thì cơ sở dữ liệu từ chối [test: apps/hub-api/src/modules/packs/contracts/adapters/sign-on-doc.int.test.ts » CHECK enum/parts và FK tệp: giá trị sai bị DB từ chối]

## Việc còn lại
Không. (Ngoài lát: `tsc --noEmit` hub-api còn lỗi cũ ở `pmsg-db.int.test.ts:412`, `packages/db/src/migrate-hub.int.test.ts:223` — không do lát này.)
