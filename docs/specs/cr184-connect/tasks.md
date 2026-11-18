---
id: cr184-connect
lát: cr184-connect
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Ý (3) CR-184: «Kết nối» chỉ còn «Gửi và nhận hợp đồng với đối tác»; khối Ký số qua nhà cung cấp sang Cài đặt › Chữ ký (dưới thẻ «Chữ ký số»); «Vị trí ô ký» chỉ hiện khi có nhà cung cấp envelope đang bật.

## Làm
- [x] SignPartnerPane bỏ khối esign · SignaturePane thêm khối nhà cung cấp (owner truyền từ SettingsBody) · EsignSetting ẩn anchor theo `showAnchorSetting` · i18n v2l.
- [ ] qc sửa e2e KHOÁ: `e2e/contracts-web/esign-anchor.cw.ts`, `e2e/contracts-web/esign-multi.cw.ts` (mở «Chữ ký» thay «Kết nối»), `e2e/journey-approval/cr125-s2-settings-flow.spec.ts` (`openSignSettings` → `?sec=signature`, testid `esign-enabled`).

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/cai-dat-va-quyen.md
#### Yêu cầu: Cài đặt › Kết nối chỉ còn việc gửi và nhận hợp đồng với đối tác
Ký số qua nhà cung cấp (công tắc, nhà cung cấp mặc định, ảnh thư mời) nằm ở Cài đặt › Chữ ký, dưới thẻ «Chữ ký số»; quyền sửa giữ như cũ. «Vị trí ô ký trong văn bản hợp đồng» chỉ hiện khi có nhà cung cấp kiểu DocuSign đang bật.
- Kịch bản: khi chỉ có nhà cung cấp Ký thử hoặc ký số tắt thì ẩn «Vị trí ô ký» [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » chỉ Ký thử/CA ⇒ ẩn]
- Kịch bản: khi có DocuSign đang bật thì hiện «Vị trí ô ký» [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » có DocuSign (envelope) đang bật ⇒ hiện]
- Kịch bản: công tắc ký số hiện ở Cài đặt › Chữ ký, không còn ở Kết nối [test: e2e/contracts-web/cr184-settings.cw.ts » CR-184 · Kết nối chỉ còn «Gửi và nhận hợp đồng với đối tác», Ký số nằm ở Chữ ký]
