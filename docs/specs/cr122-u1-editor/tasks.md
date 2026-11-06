---
id: cr122-u1-editor
lát: cr122-u1-editor
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: cr122-f0-flowdef-contract
---
## Plan (ngắn)
MỘT trình sửa cho flow có `trigger` (Thư viện + bản công ty): node Bắt đầu khi ở đầu, bảng node theo manifest app, node Kết thúc có kết quả, một control điều kiện trên dữ kiện (`FactWhenEditor`), lỗi theo `flowDefIssues(def, manifest.events)`.

## Làm
- `lib/fact-when.ts`, `lib/flow-def.ts` (mapper nháp ⇄ FlowDef, bảng node, validate, đổi sự kiện); `StageDraft.outcome/nextStep` qua `stage-convert`.
- `components/flow/*` (TriggerCard, FactWhenEditor, NodePalette, FinishFields, FlowEditorBody); gắn vào `ProcessEditorPage`, `StageWorkbench`, `StagePanel`, `LibraryToolbar`, `LibraryEditorBody`; i18n `process.admin.flow.*` vi+en.
- Artboard: không có artboard riêng cho U1 trong cr121-design; bám khuôn trình sửa hiện có (canvas + ngăn phải).

## Không làm / Chạm
- Chưa gỡ editor theo khe (`FlowWhenEditor`, `FlowFormEditor`, `SlotStageForm`, `slot-canvas`): def cũ không có `trigger` còn dùng tới khi M1/E1 chuyển hết (D6 còn nợ, xoá ở R1).
- Duyệt độc lập và Ký số hiện tắt trong bảng node (chờ E2/E3); Kết thúc tạm dùng executor `set` rỗng (E2 chọn executor `finish`).
- `next_step` (gộp) có trường trong nháp nhưng chưa có control vẽ/sửa; chưa dựng nguồn `fact` trong node Nếu (chờ E2 `CondFromSchema`).

## Test tối thiểu
`bun test apps/admin-web/src/features/processes` → 320 xanh (có `lib/flow-def.test.ts`). e2e cần đổi/viết (qc): mở flow có trigger → đổi sự kiện/điều kiện, thêm Kết thúc, lưu; thay các ca e2e dùng Form theo khe/"Chỉ chạy khi".

## Quyết định trong lúc làm
- Trigger giữ ở state trang, gửi kèm `PUT` qua `extra {trigger, app}`; cần hub E1 nhận/trả `trigger`+`app` trên def (API mới, ghi vào báo cáo).
- Danh mục sự kiện lấy tĩnh từ `@ai/contracts/app-manifest` (không thêm API).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED platform/trinh-sua-flow.md
#### Yêu cầu: Một trình sửa flow theo sự kiện của app (FLOW2-FR-02, FLOW2-FR-15, FLOW2-FR-16)
Flow có `trigger` mở ở MỘT trình sửa canvas: node Bắt đầu khi (sự kiện app khai + điều kiện AND/OR một cấp trên dữ kiện), bảng node theo manifest, node Kết thúc chọn kết quả của sự kiện; lỗi hiển thị theo `flowDefIssues`.
- Kịch bản: khi flow thiếu Kết thúc, kết quả lạ hoặc điều kiện sai kiểu dữ kiện thì báo đúng khoá lỗi [test: apps/admin-web/src/features/processes/lib/flow-def.test.ts » thiếu Kết thúc / kết quả lạ / sự kiện lạ báo đúng khoá]
- Kịch bản: khi đổi sự kiện thì bỏ vế dùng dữ kiện lạ và đưa Kết thúc về kết quả hợp lệ [test: apps/admin-web/src/features/processes/lib/flow-def.test.ts » đổi sự kiện bỏ vế lạ và đưa Kết thúc về kết quả hợp lệ]
- Kịch bản: khi dựng điều kiện thì tối đa 6 vế mỗi cấp, nhóm lồng một cấp [test: apps/admin-web/src/features/processes/lib/flow-def.test.ts » tối đa 6 vế mỗi cấp]

## Việc còn lại
Gỡ editor theo khe (R1); node Duyệt/Ký số/Kết thúc thật (E2/E3); control `next_step` + nguồn `fact` cho Nếu; chụp màn hình khi hub E1 trả flow có trigger.
