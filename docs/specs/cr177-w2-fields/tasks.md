---
id: cr177-w2-fields
lát: cr177-w2-fields
cr: CR-177
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
workspace-web: mọi `<select>` gốc ⇒ `OptionSelect` (vỏ mỏng trên `Select` của kit, nhận `<option>` làm con); `<input>` text/number/email/search/tel/password ⇒ `Input` của kit.

## Làm
- [x] `shared/ui/OptionSelect.tsx` (giá trị "" qua mã tạm; `data-value` trên ô và từng mục để e2e đọc/chọn)
- [x] 46 `<select>` ⇒ 0 · 93 `<input>` trần ⇒ 6 (còn: ô màu/range của AccentPicker, SegButton, `components/ui/input.tsx`)
- [x] e2e: helper `pickOption` trong `e2e/_kit/ui.ts`; đổi `selectOption`/`locator("select")`/`toHaveValue` của màn workspace-web (chưa chạy)
- [x] `biome.json`: `noLabelWithoutControl` biết `Input`/`OptionSelect` (nhãn bọc component vẫn hợp lệ)
- [x] hạ mốc `ui-kit-baseline.json`

## Không làm / Chạm
Không đụng `<button>`, `title=` (W3), emoji (W4), messages, admin-web, `packages/web-kit/src/ui/kit`. Danh sách ngắn nên dùng Select cả chỗ nhiều mục; Combobox (có tìm) chưa dùng vì thiếu `id`/`aria-label`/`disabled` trên Combobox của kit.

## Test tối thiểu
`bun test apps/workspace-web` (đỏ có sẵn: `table.test` Pager «Trang trước», `CR-126 Việc của tôi`) · `tsc --noEmit -p apps/workspace-web` · `check:ui-kit`.

## Màn đã đổi (cho soát UI)
- Select: contract-esign (EsignSendDialog, EsignSetting, SignSessionCard) · contract-form (KindTermsFields, ProductPicker x3) · contract-milestones/MilestoneDialog · contract-new/DealNewPage · contract-review (ManagePanel, PeriodDialog) · contract-versions/VersionDiff x2 · contracts-list/DateFilterControl x2 · ledger/OtherForm · org/OrgPage · partner-inbox/PartnerSendPanel · partners/FlagPanel x2 · product-links/ProductLinkDialog x2 · product-suppliers (ManualPriceDialog, ScoutFields x2, ScoutProductFields) · products (AddProductDialog, RulesPanel, StockPanel) · requests/RequestField · settings/TypesTab · sourcing/SaleLines · table/Pager · community (Composer, DraftFields, Feed x3, JoinApprove, QuoteForm x3, TopBar) · flow (FormSearchSelect, FormStep, ReassignBox).
- Input: auth (LoginForm, StepForms) · contract-esign · contract-form (FieldsGrid, FramePicker, ItemTable, KindTermsFields, PartnerField, ProductPicker) · contract-milestones · contract-review · contracts-list/UploadTypeDialog · frame-panel/AttachDialog · ledger · org, org-chart · partner-inbox · partners · product-links · product-suppliers · products · promote-deal · settings (nhiều ô) · table (ColumnFilters, CondEditors, TableTools) · community (nhiều ô) · flow (FormSearchSelect, FormStep) · PersonSearchSelect.
- Soát: ô chọn cao/rộng đúng chỗ cũ, ô khoá/lỗi (viền đỏ qua `aria-invalid`), ô tìm có kính lúp (TableTools) còn đủ đệm.

## Quyết định trong lúc làm
- Vỏ `OptionSelect` thay vì sửa từng chỗ sang `SelectItem` ⇒ giữ `<option>` và nhãn cũ, ít diff.
- Mục "" của Radix không hợp lệ ⇒ đổi qua mã tạm nội bộ, `onValueChange` vẫn nhận "".
- Bỏ lớp `field`/viền/nền/cỡ chữ riêng trên ô; giữ lớp kích thước và bố cục.
- Bỏ `title=` ở Composer (đã có `aria-label` giống hệt) vì prop `title` không có trên OptionSelect.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: chỉ đổi cách hiển thị ô chọn/ô nhập sang bộ component chung; giá trị, nhãn, luồng giữ nguyên)

## Việc còn lại
- Chạy e2e các file đã sửa cuối đợt (chưa chạy): `e2e/contracts-web`, `community-web`, `cr127`, `flows3`, `prod-journey`, `smoke-journey`, `journey-approval/_partner-pick`, `deployed/09`.
- Ô trong `<form>` có thể sinh thêm `<select aria-hidden>` của Radix ⇒ `getByLabel` có thể trúng hai phần tử; nếu e2e báo strict-mode, dùng `getByRole("combobox", { name })`.
