# esign-anchor — ô ký DocuSign đặt ĐỘNG trong văn bản HĐ

Trạng thái gộp: chưa gộp

| Làn | Phạm vi |
|---|---|
| Nhanh (Luật 0b) | luật chọn anchor, tabs/documents DocuSign, cài đặt cụm theo công ty, UI, công cụ kiểm bố cục |

## Plan ngắn
1. Luật thuần `domain/esign.anchor.ts` — `pickAnchors({text, side, roles, lists})` ⇒ `{mode:"text", anchors[]}` | `{mode:"page", reason}`.
2. DocuSign `envelopeBody(i, anchors)`: có anchor ⇒ chỉ tài liệu HĐ, tab theo cụm (`anchorMatchWholeWord`, `anchorCaseSensitive=false`,
   `anchorIgnoreIfNotPresent=false`, offset `TEXT_TAB_OFFSET`); lỗi `ANCHOR*` ⇒ gửi lại MỘT lần bằng trang ký cuối + log `esign-anchor-fallback`.
3. Cài đặt cụm: `approval_settings.esign_anchors` (0063, idx 59) + `GET/PUT /esign/anchors` (owner) + xem trước `GET /contracts/:id/esign/placement`.
4. UI: Cài đặt › Quy trình duyệt › Ký số (2 ô, mỗi dòng một cụm) + hộp Gửi ký "Vị trí ký: trong văn bản / trang ký cuối"; i18n `esign-anchor.{vi,en}.json`.
5. Công cụ kiểm bố cục: `esign-layout-gen.ts <ra> text` + `server-check.ts` chế độ text (HTML làm document 1).

## Quyết định trong lúc làm
- **Bỏ hẳn trang ký cuối khi đặt được MỌI người ký trong văn bản** (đơn giản nhất; trang thông tin có thể chứa lại cụm ⇒ DocuSign đặt tab thừa).
  Không đặt được bất kỳ ai ⇒ toàn bộ phong bì dùng trang ký cuối như cũ (không trộn hai chế độ).
- DocuSign đặt tab ở MỌI chỗ khớp ⇒ cụm phải xuất hiện đúng 1 lần trong **cả** văn bản (không chỉ khối cuối) và lần đó nằm ở phần cuối
  (30% cuối, 800–4000 ký tự). Cụm 2 lần / hai người ký trùng vùng / gán mua-bán mâu thuẫn ⇒ trang ký cuối.
- Vai: Bên A = công ty, Bên B = đối tác (như trang ký cuối). Danh sách sửa được: A, B. Cụm theo hướng HĐ (`deal` ưu tiên, rồi `direction`:
  bán ⇒ công ty "ĐẠI DIỆN BÊN BÁN"/"BÊN BÁN", mua ⇒ "…BÊN MUA") thêm SAU danh sách A/B, cố định trong code. Văn bản gán rõ
  "Bên mua (Bên B)" / "Bên A (Bên bán)" / "Bên bán … gọi tắt là Bên B" ⇒ đổi chữ cái của công ty theo gán.
- Nguồn chữ: `contracts.source_text` (trích lúc tải lên từ chính tệp) ⇒ không có thì lớp chữ PDF của bytes đang gửi (`PdfConverter`, worker
  tạo lười). Scan/lỗi ⇒ trang ký cuối, không chặn gửi ký.
- anchorString gửi DocuSign = đoạn khớp trong văn bản (NFC, khoảng trắng đã gộp), không phải chuỗi cấu hình.
- Chỉ nhà cung cấp loại `envelope` (DocuSign) dùng anchor; selfsign/CA bỏ qua. Usecase chỉ thêm một bước `anchorsFor` trước `createEnvelope`.
- Route riêng `/esign/anchors` (không mở rộng `/esign/settings`) để không đụng lát `esign-flow` song song.
- `TEXT_TAB_OFFSET` (sign y=36, date y=84) CHƯA đo trên DocuSign thật — điều phối chạy `esign-layout` chế độ `text` rồi chỉnh.

## Test
- unit `domain/esign.anchor.test.ts` (15): có/không/trùng/mơ hồ/hoa thường/NFC/nguyên từ/mua-bán/gán A-B/danh sách tuỳ chỉnh.
- `adapters/docusign.anchor.test.ts` (3, DocuSign giả Bun.serve): tabs theo cụm + 1 tài liệu; không cụm ⇒ trang ký; lỗi anchor ⇒ fallback + log.
- int `tests/acceptance/esign-anchor/esign-anchor.int.test.ts` (3): xem trước + POST /envelopes theo cụm; không cụm ⇒ trang ký; Cài đặt
  cụm (owner/403/400/audit/404). Chạy lại `cf-esign` + `esign-multi` int: 14 pass.
- e2e `e2e/contracts-web/esign-anchor.cw.ts` (viết, CHƯA chạy — Luật 0b).

## Delta
- Mới: `domain/esign.anchor.ts`, `application/esign-anchor.usecase.ts`, `adapters/esign-anchor.{repo,routes}.ts`,
  `packages/contracts/.../esign-anchor.ts`, migration `0063_esign_anchor.sql` (journal idx 59, when 1799700000000), i18n `esign-anchor.*.json`,
  `contract-esign/anchor-api.ts`, `EsignAnchorSetting.tsx`.
- Sửa: `docusign.provider.ts` (envelopeBody + fallback), `esign.ports.ts` (`anchors?`, `placement?`), `esign.usecase.ts` (`anchorsFor`,
  `anchors` dep), `esign.mount.ts`, `EsignSetting/EsignSendDialog/EsignPanel.tsx`, `contracts-locales.ts`, `esign-layout-gen.ts`,
  `deploy/prod-sohoptac2/esign-layout/{server-check.ts,README.md}`.

## Việc còn lại
- Đo `TEXT_TAB_OFFSET` bằng `esign-layout` chế độ text trên sohoptac2 (điều phối).
- Chạy e2e `esign-anchor.cw.ts` ở lượt e2e cuối đợt.
