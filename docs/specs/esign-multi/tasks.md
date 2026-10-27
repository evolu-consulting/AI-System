# esign-multi — Nhiều nhà cung cấp ký số song song, mặc định theo công ty, chọn khi gửi ký

Luật 0b, làn đầy đủ một vòng (secret/cấu hình env, quyền owner, tenant). Migration giao trước: `0061_esign_multi` (journal idx 57,
when 1799500000000). Nền: `cf-esign-docusign` (cổng `ESignProvider`, `esign_envelopes.provider`, webhook `/esign/webhook/:provider`).

## Plan
| # | Việc | Làn | Trạng thái |
|---|------|-----|-----------|
| 1 | Registry thuần `domain/esign.providers.ts`: `ESIGN_PROVIDERS` (danh sách, thứ tự) + tương thích ngược `ESIGN_PROVIDER=x`; khả dụng khi đủ cấu hình; `kind` envelope/ca; `misa` khai báo, chưa khả dụng | đầy đủ | xong |
| 2 | Migration 0061: `approval_settings.esign_default_provider` (+ CHECK định dạng) | đầy đủ | xong |
| 3 | Use case: settings trả `providers[]` + `default_provider`; PUT `{enabled?, default_provider?}` (owner, phải khả dụng ⇒ 422); gửi ký `provider?` (vắng ⇒ default); refresh/sign-url/void/webhook dùng provider LƯU trên envelope | đầy đủ | xong |
| 4 | Người ký công ty = tài khoản gửi (bỏ name/email client; không email ⇒ 422 `ESIGN_SIGNER_NO_EMAIL`); "Ký ngay" chỉ người ký công ty (khác ⇒ 403 `ESIGN_NOT_SIGNER`) | đầy đủ | xong |
| 5 | DocuSign: trang ký cuối = HTML UTF-8 (`fileExtension: "html"`), ô ký/ngày theo anchor ẩn `\sN\`/`\dN\` | nhanh | xong |
| 6 | Người ký lưu `provider` + `certificate_ref` (jsonb `signers`); sign-url nhận `provider?` cho phong bì loại "ca" | đầy đủ | xong (khung) |
| 7 | UI contracts-web: Cài đặt chọn mặc định (nhãn + pháp lý), hộp Gửi ký dropdown (> 1 khả dụng), công ty chỉ đọc, phong bì hiện tên nhà cung cấp; i18n vi/en | nhanh | xong |
| 8 | Test: unit registry + trang ký HTML; int `tests/acceptance/esign-multi/`; e2e `e2e/contracts-web/esign-multi.cw.ts`; docs deploy | — | xong |

## Quyết định trong lúc làm
- `ESIGN_PROVIDERS` đặt (khác rỗng) thì THẮNG `ESIGN_PROVIDER`; khoá lạ/`none`/trùng bị bỏ. Prod hiện `ESIGN_PROVIDER=docusign` chạy nguyên (⇒ `[docusign]`).
- `GET /esign/settings` liệt kê MỌI nhà cung cấp trong env (cả không khả dụng, `available:false`); `provider`/`demo` cũ = mặc định hiệu lực (giữ tương thích UI cũ). Không FileBox ⇒ mọi nhà cung cấp coi như không khả dụng.
- Mặc định lưu không còn khả dụng (bỏ khỏi env/thiếu biến) ⇒ tự rơi về khả dụng đầu tiên, KHÔNG xoá giá trị đã lưu.
- PUT settings: trường vắng = giữ (coalesce trong một câu SQL), audit before/after có cả `esign_default_provider`.
- Gửi ký: công ty tắt ⇒ 409 `ESIGN_DISABLED` trước; `provider` không khả dụng/lạ ⇒ 422 `ESIGN_PROVIDER_UNAVAILABLE`.
- Lệnh sau gửi lấy adapter theo `envelope.provider`; nhà cung cấp đó đã bị gỡ khỏi env ⇒ refresh không làm gì, sign-url/void 409 `ESIGN_DISABLED`. Webhook chỉ xử lý envelope có `provider` = khoá route.
- Người ký công ty: tối đa MỘT (schema refine); tên trống ⇒ dùng email; luôn ký nhúng (`client_user_id` = người gửi). Schema company nhận name/email tuỳ chọn (UI cũ vẫn gửi được) nhưng server bỏ qua.
- "Ký ngay": người không phải người ký công ty ⇒ 403 `ESIGN_NOT_SIGNER` (trước đây 409 `ESIGN_STATE`; đã sửa kỳ vọng ở `cf-esign/esign.int.test.ts`).
- Trang ký DocuSign: HTML do DocuSign tự chuyển PDF (giữ dấu tiếng Việt), bảng Bên A (công ty)/Bên B… (đối tác theo thứ tự), escape mọi trường; anchor chữ trắng, `anchorIgnoreIfNotPresent=false`. Bỏ PDF ASCII cũ (`signaturePagePdf`, `signTabAt`) — selfsign không cần trang ký.
- `kind`: docusign = "envelope", selfsign/misa = "ca". sign-url `provider?`: chỉ nhận khi phong bì loại "ca" và provider chọn cũng "ca" + khả dụng (khác ⇒ 422); ghi `signers[i].provider` (certificate_ref = null). Không cần đổi schema (jsonb).
- Seam test: `packs.esign.providers: ESignProvider[]` (mới) cạnh `packs.esign.provider` (cũ).
- Log thiếu cấu hình đổi tên `esign-docusign-not-configured` ⇒ `esign-provider-not-configured {provider}`.

## Delta (so với docs/current)
Trỏ: `docs/current/sht/duyet-ky-so.md` §4 Ký số.
- Env: `ESIGN_PROVIDERS` (danh sách) thay vai trò `ESIGN_PROVIDER` (vẫn đọc khi vắng danh sách).
- `approval_settings.esign_default_provider` (0061). `GET /esign/settings` thêm `providers[{key,label,kind,available,legal}]`, `default_provider`; `PUT` nhận `{enabled?, default_provider?}`.
- `POST /contracts/:id/esign` thêm `provider?`; người ký công ty = tài khoản gửi. `POST …/sign-url` thêm `provider?` (loại "ca"), người khác ⇒ 403.
- Mã lỗi mới: `ESIGN_PROVIDER_UNAVAILABLE` 422, `ESIGN_SIGNER_NO_EMAIL` 422, `ESIGN_NOT_SIGNER` 403. Envelope out thêm `provider_label`; signer out thêm `provider`, `certificate_ref`.
- Trang ký cuối DocuSign: HTML Unicode + anchor (thay PDF ASCII toạ độ cố định).

Trạng thái gộp: đã gộp 2026-10-27 (đợt ký số) — Đã gộp vào docs/current 2026-10-27

## Việc còn lại
- Lát `esign-cks`: "Chữ ký số của tôi" (mỗi người nhiều CKS: MISA, VNPT SmartCA, Viettel MySign…), chọn chứng thư lúc ký, ký PAdES nối tiếp cho phong bì loại "ca", điền `certificate_ref`; UI chọn chứng thư ở "Ký ngay".
- Adapter MISA thật khi có Client ID: thêm `adapters/misa.provider.ts` + nhánh `adapterOf` trong `esign.mount.ts` + `providerAvailable` (`domain/esign.providers.ts`).
- Prod: muốn chạy song song ký thử ⇒ đặt `ESIGN_PROVIDERS=docusign,selfsign` (giữ docusign đầu = mặc định); không đặt gì vẫn chạy như cũ.
- e2e bộ đầy đủ + test:all chạy cuối đợt (Luật 0b).
