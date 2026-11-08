---
id: cr125-fix-quicksign
lát: cr125-fix-quicksign
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa H1 + M1 của `docs/specs/CR-125/wave-review-2.md`: link `?ky=1` không được tự ký khi chưa có cú bấm; chỉ tự mở khi đến lượt.

## Làm
- `decideAutoSign` trả `open | focus | none` theo `redirectsToProvider`; `redirectsToProvider(state)` đọc cờ mới `redirects_to_provider` của nhà cung cấp phong bì (vắng cờ ⇒ false).
- Cờ `redirects` ở registry hub (`PROVIDER_META`: docusign true; selfsign/misa false; khoá lạ theo `!demo`) ⇒ `ESignProviderOut.redirects_to_provider`.
- `esignView.canSignNow` theo thứ tự ký (cùng luật server `isTurnOf`); `remindTargetOf` dùng chung `isTurnOf`.
- `signUrl` từ chối `ESIGN_NOT_YOUR_TURN` (409) khi chưa đến lượt hoặc đã ký; i18n vi/en.
- Panel: `focus` ⇒ cuộn + focus + viền nhấn mạnh 3 giây nút «Ký ngay», không gọi hub.

## Không làm / Chạm
Không chạm G1/readiness/admin, DLC, e2e. e2e có sẵn kiểu "`?ky=1` ký thử xong luôn" (nếu có) sẽ cần sửa ở lượt e2e cuối (qc), không chạy ở lát này.

## Test tối thiểu
Unit `esign-view.test.ts`, `esign.providers.test.ts`; int `tests/acceptance/esign-multi/esign-multi.int.test.ts` (+ cf-esign, signer-visible để chắc guard không vỡ).

## Quyết định trong lúc làm
- Khoá lạ (seam test) suy `redirects = !demo`. MISA (CA, chưa có adapter) để false (an toàn).
- Đã ký rồi mà bấm sign-url lại ⇒ cũng `ESIGN_NOT_YOUR_TURN`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Link «Mời ký» (`?ky=1`) không tự ký thay người dùng
Link `?ky=1` chỉ tự mở trang ký khi đến lượt người xem (mọi người ký có thứ tự nhỏ hơn đã ký) và nhà cung cấp chỉ chuyển sang trang ký riêng của họ (DocuSign). Với nhà cung cấp tự hoàn tất ký trong lời gọi `sign-url` (ký thử, CA), link chỉ cuộn tới và nhấn mạnh nút «Ký ngay»; chữ ký chỉ hoàn tất sau cú bấm của người dùng.
- Kịch bản: khi nhà cung cấp tự hoàn tất ký thì `?ky=1` chỉ focus nút, không tự mở [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » H1 · nhà cung cấp tự hoàn tất ký (ký thử/CA) ⇒ chỉ focus nút, không bao giờ open]
- Kịch bản: khi người ký 2 mở link trước người ký 1 thì không tự mở [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » M1 · người ký 2 mở link trước người ký 1 thì không có lượt và không tự mở]

#### Yêu cầu: «Ký ngay» chỉ khi đến lượt
`POST /esign/sign-url` trả 409 `ESIGN_NOT_YOUR_TURN` khi còn người ký có thứ tự nhỏ hơn chưa ký (hoặc người gọi đã ký); phong bì không đổi.
- Kịch bản: khi đối tác ký trước chưa ký thì người ký công ty bấm Ký ngay bị 409 và phong bì không hoàn tất [test: tests/acceptance/esign-multi/esign-multi.int.test.ts » đối tác ký trước mà chưa ký ⇒ người ký công ty bấm Ký ngay = 409 ESIGN_NOT_YOUR_TURN, phong bì giữ nguyên (không hoàn tất)]

## Việc còn lại
- e2e cuối CR: kiểm hành trình `?ky=1` với ký thử (focus, không tự ký).
