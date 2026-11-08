# CR-122 p12 — Số chứng từ không ký tự đặc biệt

Trạng thái gộp: chưa gộp

Lý do: số chứng từ có "/", dấu, khoảng trắng làm lỗi khi up vào phần mềm kế toán / chuyển ngân hàng.

## Quyết định
- Quy tắc: chỉ `A-Z a-z 0-9 -`, tối đa 50 ký tự (`DOC_NUMBER_RE`, `DOC_NUMBER_MAX` trong `packages/contracts/src/pack-contracts/doc-number.ts`).
- Chuẩn hoá khi gõ/dán và khi AI đọc: bỏ dấu (đ→d), "/" + khoảng trắng → "-", HOA; ký tự lạ còn lại giữ nguyên để báo lỗi.
- Server KHÔNG tự chuẩn hoá, chỉ chặn: tạo tay/giao dịch (`ManualContractRequestSchema.number`) và `PATCH fields.number` ⇒ 422 path `number`.
- Dữ liệu cũ có "/": KHÔNG migrate. PATCH chỉ chứa khoá đã đổi, nên số cũ không đụng tới không bị validate ⇒ lưu các trường khác vẫn được. Mở sửa: ô giữ nguyên giá trị cũ, hiện gợi ý bản chuẩn hoá + nút "Dùng"; người dùng sửa tay thì kiểm theo luật mới.
- Khuyết điểm chấp nhận: đầu ra agent trích (`fieldValueSchema("number")`) không bị siết (tránh hỏng cả lượt đọc); chuẩn hoá ở web khi điền form xác nhận (`formOfConfirm`).

## Bản đồ file
- `packages/contracts/src/pack-contracts/doc-number.ts` (+ test), `extract.ts` (Manual), `detail.ts` (PATCH_SHAPE), `index.ts`
- `apps/workspace-web/src/features/contract-form/components/FieldsGrid.tsx`, `lib/blocker.ts`, `lib/review-model.ts`; `contract-review/components/InfoPanel.tsx`
- i18n `packages/i18n/locales/contracts/v2f.{vi,en}.json`

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Số chứng từ không ký tự đặc biệt
Số chứng từ chỉ gồm chữ không dấu, số và dấu gạch ngang, tối đa 50 ký tự; web chuẩn hoá khi gõ/dán/AI đọc và báo lỗi dưới ô; server chặn 422 path `number`; số cũ chưa sửa không chặn lưu.
- Kịch bản: số "2026/11-xyz" chuẩn hoá thành "2026-11-XYZ" [test: packages/contracts/src/pack-contracts/doc-number.test.ts]
- Kịch bản: tạo tay / PATCH với số có "/" ⇒ lỗi path number; PATCH không có khoá number không bị ảnh hưởng [test: packages/contracts/src/pack-contracts/doc-number.test.ts]
- Kịch bản: AI đọc số có "/" và dấu ⇒ form xác nhận điền bản chuẩn hoá [test: apps/workspace-web/src/features/contract-form/lib/review-model.test.ts]

## Việc còn lại
- e2e hành trình (chạy một lần cuối đợt, không chạy trong lát).
