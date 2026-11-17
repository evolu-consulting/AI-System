# CR-181 · Ký trên tài liệu — đợt 1 (chữ ký nội bộ) · quyết định chung cho mọi lát

Nguồn nghiệp vụ: Claude Docs «Duyệt và ký giấy tờ trên Evolu» (https://claude.ai/artifact/FYWXvvfW4UXzMjA1uvbPE4) — bản văn lưu tại
`docs/specs/CR-181/nghiep-vu.txt`. Bản mẫu giao diện: https://claude.ai/artifact/WAuXbU2XrLXkAEgaze4XYh (HTML lưu tại
`docs/specs/CR-181/prototype.html`, phần JS từ dòng 362: chuẩn bị chỗ ký, màn ký, Xem bản đã ký, lần đầu đăng nhập, Cài đặt › Chữ ký).
Tài liệu nghiệp vụ thắng bản mẫu khi lệch. Người dùng chốt 2026-11-17 («Ok làm đi»).

## 1. Phạm vi đợt 1
Làm: chữ ký nội bộ (lõi chung), màn tạo lần đầu đăng nhập, «Chữ ký của tôi», Cài đặt › Chữ ký (nhóm Chung), màn ký Từng trang
(kéo thả, đổi cỡ, chuột phải, chạm giữ, hít khe 2 trang, chép sang mọi trang, nhiều tệp, Lưu = máy chủ in), cờ «Cần ký», chuẩn bị chỗ ký
(+ Tự đặt theo «ĐẠI DIỆN BÊN A/B»), bấm ô để ký, thẻ duyệt «Mở và ký», Hồ sơ duyệt có hình chữ ký, Xem bản đã ký; chọn loại chữ ký
(nội bộ | số — số làm sẵn khung, luôn khoá).
KHÔNG làm (đợt 2–3): Xoè quạt, Liền mép, đối tác ký qua link, vai + giao việc, gọn cấu hình CR-146, chuyển quy trình, chữ ký số thật,
phụ lục ký sau, kiểm tra tệp. Không thêm thư viện (pdf-lib + fontkit ở hub-api, pdfjs-dist ở workspace-web đã có).

## 2. Quyết định (Q = mặc định đã chốt)
- Q1 Bước Ký: thêm giá trị `provider = "ondoc"` («Ký trên tài liệu (chữ ký nội bộ)») vào `EsignNodeConfigSchema`; các giá trị cũ giữ nguyên.
  Bước xong khi mọi chỗ ký của người ký công ty đã ký và Lưu (BR-D3, BR-C4).
- Q2 Người ký công ty = `company_signers` của bước Ký: người cụ thể ⇒ mỗi người một chỗ ký; Group ⇒ một chỗ ký «Đại diện <nhóm>», người
  trong nhóm ký trước thì ô thuộc người đó. Người ký đối tác = liên hệ đầu tiên có email (`esign.repo.ts:187-189`).
- Q3 BR-D2 (Đạt cần ký đủ tệp cần ký + ý kiến) chỉ áp bước duyệt có bằng chứng «ý kiến + chữ ký/tệp»; bước «Chỉ ý kiến» như cũ.
  BR-T2 (≥1 tệp cần ký) chỉ bắt khi quy trình có bước ký trên tài liệu (bước Ký `ondoc` hoặc bước duyệt có bằng chứng).
- Q4 Chỗ khác có ô vẽ chữ ký (ghi nhận mốc, Việc của tôi): khi công ty BẬT ký trên tài liệu ⇒ dùng «Chữ ký của tôi» (máy chủ gắn), không vẽ tay.
- Q5 Công tắc theo công ty `on_doc_enabled` (mặc định TẮT). Tắt ⇒ mọi thứ như cũ (không màn tạo chữ ký, ô vẽ tay cũ). Seed bật cho tenant demo.
- Q6 Chỗ ký Bên B (đối tác) vẫn đặt được, hiện «Chờ đối tác ký», KHÔNG chặn hoàn tất bước/hợp đồng ở đợt 1.
- Q7 Không dùng chữ «Phiên bản» cho bản đã ký (trùng chuỗi phiên bản HĐ): nhãn «Bản» — «Bản gốc», «Sau khi <người> ký · <giờ>».
- Q8 Người ký hợp đồng thấy và ký được ô của mình ngay ở bước duyệt; ký hết ô ⇒ bước Ký của người đó tự xong (không ký hai lần).
- Q9 Lưu khi còn ô của mình chưa ký: cho Lưu (hộp xác nhận nhắc), ô còn lại vẫn mở, ký tiếp tạo bản mới; bước chỉ xong khi hết ô.
- Q10 «Phải quản trị cho phép» đổi chữ ký: người dùng bấm «Xin đổi chữ ký» ⇒ chuông cho quản trị ⇒ «Cho phép» (một lần).
- Q11 Chữ ký nháy: «Chép sang mọi trang» đặt bản THU NHỎ (40% cỡ) cùng vị trí; công ty chọn «chữ ký tắt riêng» ⇒ màn tạo chữ ký có bước tạo
  chữ ký tắt (`kind = initials`) và «Chép sang mọi trang» dùng chữ ký tắt.
- Q12 Chọn loại chữ ký lúc ký: «Ký bằng: Chữ ký nội bộ | Chữ ký số». Số luôn khoá kèm lý do («Công ty chưa bật chữ ký số» / «Bạn chưa được
  gán chứng thư»). API nhận `kind`; `digital` khi chưa bật ⇒ 409 `DIGITAL_SIGN_NOT_ENABLED`, tệp không đổi. Thứ tự Lưu: in hình → (ký số qua cổng
  `DigitalSigner`, đợt 1 không có nhà cung cấp) (BR-L5).
- Q13 Tệp cần ký chỉ PDF; Word ⇒ chặn bật «Cần ký», báo «Đổi sang PDF rồi tải lại». Tệp có mật khẩu ⇒ chặn. ≤ 50 trang (BR-T3).
- Q14 Tệp chính của HĐ (`contracts.file_id`) mặc định «Cần ký» khi công ty bật; người tải lên tắt được. Tệp kèm mặc định tắt.
- Q15 «Quản trị công ty» = tenant admin hoặc người có quyền `admin` gói Sổ Hợp Tác (`pack-hosts.ts:15-24`).
- Q16 Phông «Gõ họ tên»: Dancing Script (OFL) tự host trong `apps/workspace-web/public/fonts/` — chỉ dùng ở trình duyệt để vẽ ảnh chữ ký.
  Dòng dưới chữ ký in ở máy chủ bằng Be Vietnam Pro (`contracts/adapters/fonts/`).
- Q17 Trả lại / Từ chối: các bản đã ký của lượt đó bị đánh dấu `voided_at` (không xoá, vẫn xem trong lịch sử); gửi lại ký trên bản gốc.
- Câu hỏi mở của tài liệu (6 thiết lập định dạng, bắt buộc tạo, giáp lai theo tờ… ): dùng mặc định đề xuất của tài liệu.

## 3. Dữ liệu (migration chỉ THÊM)
**hub 0155** `packages/db/migrations-hub/0155_cr181_signatures.sql` (lát s1):
- `hub.user_signatures` (id, tenant_id, user_id, kind `main|initials`, method `draw|upload|type`, png bytea ≤ 204800, created_at,
  retired_at null). Một bản đang dùng / (tenant,user,kind) (unique partial `retired_at is null`). Không xoá; đổi = retire + insert.
- `hub.signature_settings` (tenant_id pk, methods text[] ⊆ draw/upload/type ≥1, required bool, caption text[] ⊆ name/title/date/time,
  ink `blue|black`, initials `shrink|own`, change_policy `self|admin`, on_doc_enabled bool false, digital_enabled bool false,
  digital_provider text null, updated_by, updated_at). Không có hàng ⇒ mặc định (methods 3 cách, required, name+date, blue, shrink, self, tắt).
- `hub.signature_change_grants` (tenant_id, user_id, requested_at, granted_by null, granted_at null, used_at null).
- RLS theo khuôn hub 0149: bật RLS, truy cập qua hàm SECURITY DEFINER đọc `app.tenant_id`/`app.user_id`, REVOKE PUBLIC; người dùng chỉ đọc/ghi
  chữ ký của CHÍNH MÌNH; hàm nội bộ `hub.signature_for_stamp(tenant,user,kind)` cho máy chủ in (BR-K3).
- `hub.audit_log`: thêm action `signature_created`, `signature_settings_changed`, `signature_change_requested`, `signature_change_granted`,
  `document_signed` (CHECK + `HUB_AUDIT_ACTION_VALUES`).

**pack-contracts 0121** `packages/db/migrations-pack-contracts/0121_cr181_sign_on_doc.sql` (lát s6):
- `contracts.sign_docs` (tenant_id, contract_id, file_id — tệp gốc ở `contracts.files`, cả tệp chính lẫn tệp kèm; needs_sign bool,
  pages int, set_by, set_at; pk (contract_id,file_id)).
- `contracts.sign_fields` (id, tenant_id, contract_id, file_id, side `A|B`, signer_kind `user|group|partner`, signer_ref text, label text,
  parts jsonb, created_by, created_at, signed_by null, signed_version_id null).
- `contracts.sign_versions` (id, tenant_id, contract_id, file_id (gốc), seq int ≥1, out_file_id (bản mới ở `contracts.files`), sha256,
  signed_by, signature_kind `internal|digital`, run_id null, created_at, voided_at null).
- `contracts.sign_marks` (id, tenant_id, version_id, signer user, field_id null, placement `field|free|seam|initials`, parts jsonb,
  user_signature_id uuid (hub, không FK), caption text null, created_at).
- `packs.secure_table('contracts', <bảng>)` cho cả 4.

## 4. Hình học (dùng chung web ↔ API, zod ở `packages/contracts/src/pack-contracts/doc-sign.ts`)
`SignPart = { page (0-based), x, y, w, h, cx, cy, cw, ch }` — đơn vị điểm PDF, gốc DƯỚI-TRÁI của trang ĐÃ XOAY như hiển thị
(viewport pdf.js scale 1, có `rotate` của trang); (x,y,w,h) = khung cả chữ ký đặt trên trang đó, (cx..ch) = phần cắt thuộc trang đó.
Một chữ ký = mảng parts (1 trang thường, 2..5 trang giáp lai, BR-L4). Máy chủ đổi về hệ toạ độ gốc theo `/Rotate` của trang, cắt theo
(cx..ch) và theo mép trang (BR-L3), ảnh đặt vừa khung giữ tỉ lệ (như `stamp()` của bản mẫu, dòng 401–414). Ô chỗ ký tỉ lệ 2,4:1.

## 5. API (khung; lát làm API chốt chi tiết vào zod)
Hub (lát s2): `GET /me/signature` · `POST /me/signature` · `POST /me/signature/change-request` · `GET|PUT /company/signature-settings`
(PUT chỉ quản trị) · `POST /company/signature-change-grants`. `GET /me/signature` trả `needs_create` (bật + bắt buộc + chưa có / cách tạo đã bỏ).
Contracts (lát s8), dưới `/contracts/:id`: `PATCH /sign-docs/:fileId` {needs_sign} · `GET /sign-session` (tệp cần ký, bản mới nhất, chỗ ký
của mình/người khác, người ký A/B, chế độ prep|sign|view, quyền, loại chữ ký khả dụng) · `PUT /sign-docs/:fileId/fields` · `POST
/sign-docs/:fileId/sign` {kind, marks[{field_id?, placement, parts, caption}]} (KHÔNG nhận ảnh — BR-K3) · `GET /sign-docs/:fileId/versions` ·
`GET /sign-docs/:fileId/versions/:vid/content`.

## 6. Lát và chủ file
| Lát | Việc | File chính |
|---|---|---|
| s1-sig-db | migration hub 0155 + repo + int RLS | `packages/db/migrations-hub/0155_*`, `packages/db/src/schema/hub-signature.ts`, `apps/hub-api/src/modules/signatures/adapters/*.repo.ts` |
| s6-sign-db | migration contracts 0121 + repo + int RLS | `packages/db/migrations-pack-contracts/0121_*`, `apps/hub-api/src/modules/packs/contracts/adapters/sign-*.repo.ts` |
| s7-sign-stamp | in chữ ký pdf-lib + sha256 + cổng DigitalSigner | `apps/hub-api/src/modules/packs/contracts/adapters/sign-stamp.pdf.ts`, `domain/sign-geometry.ts` |
| s11a-sign-geom | hình học web (hít khe, cắt, chia giáp lai, chép trang) | `apps/workspace-web/src/features/doc-sign/lib/*` |
| s2-sig-api | API chữ ký + định dạng + xin đổi | `apps/hub-api/src/modules/signatures/*` |
| s3-sig-create | component tạo chữ ký (vẽ/tải ảnh xoá nền/gõ tên) + xem trước | `apps/workspace-web/src/features/my-signature/components/*` |
| s8-sign-api | API ký (cờ, chỗ ký, Lưu, bản, chặn gửi duyệt) | `contracts/adapters/sign.routes.ts`, `application/sign.usecase.ts`, `domain/sign.rules.ts` |
| s11b-sign-canvas | khung màn ký (trang pdf.js, cột trang, tab tệp, kéo/đổi cỡ/chuột phải/chạm giữ) | `features/doc-sign/components/*` |
| s4-sig-gate | màn chặn sau đăng nhập + «Chữ ký của tôi» + menu | `routes/_authed.tsx`, `features/my-signature/pages/*`, `features/shell/components/UserMenu.tsx` |
| s5-sig-settings | Cài đặt › Chữ ký (nhóm Chung) | `features/settings/*` |
| s9-sign-flow | nối quy trình: `ondoc`, BR-D2/D3, Trả lại void, bằng chứng dùng chữ ký của mình | `esign-node.ts`, `nodes/esign/*`, `gates.service.ts`, `approval.routes.ts` |
| s12-sign-modes | chế độ chuẩn bị chỗ ký + chế độ ký nối API | `features/doc-sign/*` |
| s10-sign-record | Hồ sơ duyệt PDF + khối Hồ sơ duyệt hiện hình | `approval-record.*`, `ApprovalRecord.tsx` |
| s13-sign-contract-ui | Tài liệu kèm (Cần ký, Chỗ ký, Tình trạng) + dải người ký + thẻ «Mở và ký» + kiểm tra trước Gửi duyệt | `ContractFilesPanel.tsx`, `use-approval-ui.tsx` |
| s14-sign-viewer | Xem bản đã ký | `features/doc-sign/components/SignedViewer*` |
| s15-e2e | e2e hành trình 3 vai + 390px; sửa test khoá j01/j11/cr141/evidence-file | `e2e/cr181/*` |
| s16-seed | bật demo + HĐ PDF mẫu | `deploy/stg-test/seed-*`, `tools/scripts/src/seed-*` |

## 7. Test bắt buộc (theo BR, ca «người được giao, không phải người tạo» — N2)
K1/K2/K5 int hub · K3 int (ảnh in = chữ ký đang dùng) · K4/G1/G3 unit+int · T1/T2/T3 int · D1 int (403 ngoài nhóm; người được giao ≠ người tạo
mở được) · D2/D3/C4 int · L1/L2/L3 unit+int · C1/C2/C3 int · X1/X2 int · Q12 int (digital ⇒ 409, tệp không đổi) + unit thứ tự in→ký số.
Hiệu năng: Lưu tệp 50 trang < 3 s ở máy chủ, số câu SQL cố định mỗi lần Lưu (đo, báo số thật).

## Quyết định trong lúc làm
(lát ghi một dòng vào đây khi tự quyết)
