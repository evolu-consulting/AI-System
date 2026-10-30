---
id: pl-sht-settings
lát: pl-sht-settings
cr: CR-105
làn: nhanh
migration: không
phụ thuộc: docs/specs/process-library (design.md §4, tasks.md L4), L1 pl-slot-core
---
## Plan (ngắn)
L4 của CR-105: gói `contracts` chỉ đọc quy trình đang dùng; sửa quy trình ở ai-admin.

## Làm
- hub-api: `GET /approval-flow` = `readCurrentFlow` (resolveSlot: gán ⇒ mặc định) `{def_id, name, rel_version, is_default, steps:[{name,
  department_name, kind, when?}]}`, tên phòng ban theo tenant (mã Group ⇒ id ⇒ tên); chưa có bản áp được ⇒ 404 `NOT_FOUND`.
  Bỏ `PUT /approval-flow`, `engineFlowDefSync`/`engineSettingsSync`, `readFlow`/`flowOf` (khe vắng ⇒ máy 2 bước cũ), `saveApprovalFlow`.
  `resolveSlot` thêm `isDefault` (gán vắng). Giữ `PUT /approval-settings` + công tắc ký số.
- contracts: `ApprovalFlowCurrentSchema` (giữ `ApprovalFlowResponse`/`Put` cũ, hết dùng).
- contracts-web: bỏ `FlowPane`/`api-flow` form/`lib/flow-*`; khối chỉ đọc + sơ đồ + xem trước + link ai-admin (platform_admin); nút
  "Chỉnh quy trình duyệt" trên thẻ duyệt trỏ link; e2e `approval-current.cw.ts` (viết, chưa chạy).

## Không làm / Chạm
Route thư viện (L2a). Bảng `contracts.approval_flows` giữ nguyên (không đọc/ghi, để quay lui).

## Test tối thiểu
`approval-flow-current.int.test.ts` (route thật + gán/mặc định + PUT 404), `approval-engine.usecase.test.ts` (đường khe, khe vắng ⇒ máy),
`current-flow.test.ts` (mapper + xem trước).

## Quyết định trong lúc làm
- 2026-10-31 khe không có bản xuất bản (chưa seed 0069) ⇒ lượt chạy máy 2 bước cũ, `GET /approval-flow` 404; L2a seed mặc định ở 0069.
- 2026-10-31 link ai-admin = `/processes/<def_id>` qua SSO một lần (như `account-link`); chỉ `platform_admin` thấy.
- 2026-10-31 `e2e/contracts-web/{contract-flow,esign-flow}.cw.ts` test form cũ ⇒ cần qc làm lại khi chạy e2e cuối đợt.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Cài đặt chỉ xem quy trình duyệt đang dùng
Cài đặt › Quy trình duyệt hiện tên + phiên bản quy trình tenant đang dùng (gán, không có ⇒ mặc định), sơ đồ bước, xem trước đường
đi; không có form sửa và không còn `PUT /approval-flow`; chỉ platform_admin có lối vào trình sửa ở ai-admin.
- Kịch bản: khi mở Cài đặt › Quy trình duyệt thì thấy "đang dùng: <tên> · v<N>" và không có nút Lưu/Thêm bước [test: e2e/contracts-web/approval-current.cw.ts » Cài đặt hiện quy trình đang dùng, không có form sửa]
- Kịch bản: khi GET approval-flow thì trả quy trình được gán hoặc mặc định, PUT trả 404 [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-flow-current.int.test.ts » GET chỉ đọc quy trình đang dùng, PUT không còn]

## Việc còn lại
Chạy e2e cuối đợt; qc làm lại e2e form cũ.
