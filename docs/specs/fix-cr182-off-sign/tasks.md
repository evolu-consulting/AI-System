---
id: fix-cr182-off-sign
lát: fix-cr182-off-sign
cr: CR-182
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Công ty TẮT ký trên tài liệu vẫn lưu được bước Ký chỉ có `signer_role`; lượt chạy ném `ONDOC_NOT_ENABLED`, HĐ kẹt. Chặn khi lưu/bật và để trình soạn giữ cách cũ khi công ty tắt.

## Làm
- [x] `checkNode`: có `signer_role`, không `provider`, công ty tắt ⇒ issue `provider: ONDOC_NOT_ENABLED`.
- [x] Options của node thêm trường chỉ đọc `on_doc_enabled`.
- [x] Panel Ký: công ty tắt (hoặc chưa biết) ⇒ bước mới KHÔNG tự nhận vai, ẩn «Chuyển sang vai» + giải thích, cảnh báo bước chỉ có vai; nút chuyển không còn xoá `provider` / `company_signers`.
- [x] Câu báo vi/en `err.ONDOC_NOT_ENABLED`, `ondocOff`.

## Không làm / Chạm
Chạm: `esign-node.usecase.ts`, `pack-contracts/esign-node.ts`, `admin-web .../esign/Panel.tsx`, `lib/esign-role-ui.ts`, locale `process/admin.*`.

## Test tối thiểu
unit `esign-role-ui.test.ts`; int evotest `sign-flow.int.test.ts` (cờ công ty thật).

## Quyết định trong lúc làm
- Nút «Chuyển sang vai» giữ cấu hình cũ trong def (đường lùi khi công ty tắt lại); lúc chạy công ty bật thì vai thắng.
- Chưa biết công ty bật hay tắt (options chưa tải) ⇒ coi như tắt (giữ cách cũ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/quy-trinh-cr127.md
#### Yêu cầu: Bước Ký theo vai chỉ lưu được khi công ty bật ký trên tài liệu
Bước Ký chỉ có vai (không chọn cách ký cũ) bị chặn khi lưu hoặc bật quy trình nếu công ty chưa bật ký trên tài liệu, với câu «Công ty chưa bật ký trên tài liệu (Cài đặt › Chữ ký): bước Ký cần chọn cách ký cũ hoặc bật ký trên tài liệu». Công ty tắt thì bước Ký mới giữ cách cũ.
- Kịch bản: khi công ty tắt thì bước chỉ có vai bị chặn đúng mã còn công ty bật thì lưu được [test: apps/hub-api/src/modules/packs/sign-flow.int.test.ts » CR-182 · bước Ký chỉ có signer_role (không provider): công ty TẮT ký trên tài liệu ⇒ ONDOC_NOT_ENABLED, BẬT ⇒ lưu được, có provider cũ ⇒ vẫn lưu được, options báo cờ]
- Kịch bản: khi công ty tắt thì trình soạn không tự gán vai, ẩn nút chuyển sang vai và cảnh báo bước chỉ có vai [test: apps/admin-web/src/features/processes/lib/esign-role-ui.test.ts » công ty TẮT: không tự gán vai, không nút chuyển, bước chỉ có vai thì cảnh báo]

## Việc còn lại
`esign-node.int.test.ts:183` (docusign ⇒ PROVIDER_NOT_ENABLED) đang đỏ sẵn trên staging vì DocuSign đã ẩn (`isListedProvider`), không thuộc lát này.
