# cf-esign-docusign — Ký số hợp đồng (trung lập nhà cung cấp; DocuSign = một adapter)

Luật 0b, làn đầy đủ một vòng (secret, dịch vụ ngoài, RLS bảng mới, webhook không user). Migration giao trước: `0054_esign`
(journal idx 50, when 1798800000000). Đổi giữa lát (người dùng): DocuSign không phải nhà cung cấp được tin dùng ở VN ⇒ cổng, bảng,
route, nhãn UI trung lập; thêm adapter `selfsign` (ký thử demo); chọn bằng `ESIGN_PROVIDER` (none | selfsign | docusign, mặc định none).

## Plan
| # | Việc | Làn | Trạng thái |
|---|------|-----|-----------|
| 1 | Migration 0054: `contracts.esign_envelopes` (RLS tenant `secure_table`, `contracts_job` chỉ đọc tenant_id/provider/envelope_id để map webhook), `approval_settings.esign_enabled` | đầy đủ | xong |
| 2 | Cổng `ESignProvider` + `docusignProvider` (JWT Grant RS256 `node:crypto`, cache token, HMAC Connect) + `fakeESign` + `selfsignProvider` | đầy đủ | xong |
| 3 | Use case + route `/pack/contracts/contracts/:id/esign*`, `/esign/settings`, webhook `/pack/contracts/esign/webhook/:provider` (gắn trước JWT) | đầy đủ | xong |
| 4 | contracts-web: khối "Ký số" ở chi tiết HĐ, hộp Gửi ký, ô bật/tắt ở Cài đặt › Quy trình duyệt, i18n vi/en | nhanh | xong |
| 5 | Test: unit (JWT, HMAC, map trạng thái, env, selfsign, luật UI), int (DocuSign giả Bun.serve: đường chính, quyền, chéo tenant, thiếu cấu hình), RLS bộ chung, e2e mock | — | xong |
| 6 | Docs: README deploy "Cài DocuSign sandbox", env.template, mount `./secrets` | — | xong |

## Endpoint
- `GET/PUT /pack/contracts/esign/settings` — đọc: `read`; đổi: `admin` (owner). `{configured, enabled, provider, demo}`.
- `GET /contracts/:id/esign` (read) · `POST /contracts/:id/esign` (write, `{signers[]}` tuần tự) · `POST …/refresh` (read, một lần) ·
  `POST …/sign-url` (write, chỉ người ký nhúng = chính user) · `POST …/void` (write) · `GET …/signed-link` (read).
- `POST /pack/contracts/esign/webhook/:provider` — không JWT; adapter tự xác thực (DocuSign: HMAC-SHA256 `X-DocuSign-Signature-1..5`,
  không khoá ⇒ 401). Chỉ tin envelopeId ⇒ tenant qua bảng ⇒ GET trạng thái thật từ nhà cung cấp.

## Quyết định trong lúc làm
- Ô ký đặt trên **trang ký cuối** do server tự sinh (PDF 1 trang A4, chữ ASCII) nối làm tài liệu 2 của envelope, toạ độ cố định — không
  phụ thuộc số trang/anchor của HĐ gốc (không cần thư viện PDF). Bản combined của DocuSign có trang ký ở cuối.
- Chỉ ký tệp PDF; DOCX/ảnh ⇒ 422 `ESIGN_UNSUPPORTED_FILE` (chưa có bản PDF sinh sẵn).
- "Đã duyệt xong" = HĐ đã khoá (`locked_at`, K1). Người ký nhúng = đại diện công ty có email TRÙNG email user gửi (clientUserId = user id);
  sửa email khác ⇒ người đó nhận email từ nhà cung cấp.
- Cờ bật theo tenant ở `approval_settings.esign_enabled` (+ nhật ký `approval_settings_audit`), route riêng `/esign/settings` thay vì
  nhồi vào `PUT /company` (ít đụng code cũ).
- Bảng KHÔNG có FK tới `contracts`/`files` (như obligations): FK làm vỡ `TRUNCATE` của bộ test HD1 và luồng xoá HĐ; app chỉ chèn sau khi
  đọc được HĐ trong tenant (RLS). Unique `(provider, envelope_id)`; một envelope đang chờ mỗi HĐ (index một phần ⇒ `on conflict do nothing`,
  thua đua ⇒ void envelope vừa tạo).
- Idempotent "Bản đã ký": khoá hàng envelope `FOR UPDATE`, đã có tệp ⇒ xoá tệp FileBox vừa đẩy. Webhook lặp ⇒ không thêm tệp.
- Ký thử (`selfsign`): không trạng thái, ký xong ở lần đọc đầu ("Ký ngay" quay thẳng về HĐ ⇒ trang tự làm mới một lần qua `?esign=return`);
  "Bản đã ký" = PDF gốc đổi tên `-ky-thu.pdf`. KHÔNG đóng dấu/ký PAdES vào PDF vì cần thư viện mới (không thêm theo brief).
- Token DocuSign cache tới hết hạn − 60 s; 401 từ API ⇒ bỏ cache. Lỗi nhà cung cấp chỉ log `status + errorCode` (không token/khoá/thân).
- `packs.mount.ts` chạm trần 400 dòng ⇒ tách FileBox của gói sang `packs.filebox.ts` (không đổi hành vi).

## Việc còn lại / rủi ro
- Người dùng: tạo DocuSign sandbox + đặt env (README "Cài DocuSign sandbox"); hoặc `ESIGN_PROVIDER=selfsign` để demo ngay.
- Chưa thử với DocuSign thật (chỉ server giả đúng hợp đồng REST v2.1). Định dạng Connect giả định JSON SIM (`data.envelopeId`).
- HĐ bị xoá ⇒ hàng envelope mồ côi (không FK) — vô hại, dọn sau nếu cần. Envelope đang chờ không tự huỷ khi HĐ mở lại (K1).
- Chọn CA Việt Nam ⇒ thêm adapter mới (cùng cổng, cột `provider` đã mở regex).
- depcruise `ca-application-inward-only` cho `esign.usecase.ts → @ai/contracts` (DTO ra) — cùng khuôn các use case gói hiện có (nợ chung).
- Lỗi typecheck có sẵn ở `apps/contracts-web/scripts/deploy-proxy.test.ts` (tsconfig.node, từ 6695db10) — ngoài lát.
