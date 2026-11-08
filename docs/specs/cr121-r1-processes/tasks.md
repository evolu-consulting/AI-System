---
id: cr121-r1-processes
lát: cr121-r1-processes
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c, c13, c15, c17, c17b
---
## Plan (ngắn)
Sửa theo reviewer cuối đợt CR-121 C, vùng processes: Blocker 1 (chỗ gán thứ hai ở trình sửa thư viện) + TB 4/5/7/8.

## Làm
- B1: gỡ nút "Gán cho công ty" + action `assign` + `AssignTenantsDialog` (PUT/DELETE `/tenants/:tid/process-slots`) khỏi trình sửa thư viện; thay bằng chữ "Công ty gán quy trình này ở trang Công ty › Quy trình." + link "Xem danh sách công ty". Gỡ code chết: `assignTenant`, `unassignTenant`, `useAssignments`, `canAssign`, `assignPlan`, `settledCounts` (+ test), khoá i18n `assign.*` cũ.
- TB5: `lib/flows-view.ts` (+ test) xoá; `slotsOfCaps` sang `lib/caps-slots.ts` (+ test), `use-company-flows.ts` đổi import. `use-process-tenant.ts` (`ai.process.tenant`) GIỮ: thư viện không còn dùng, nhưng `DlcStepsPage` (DLC, không chạm) còn chọn công ty qua `setTenant`.
- TB4: `recordLabelOf` (company-copy) gộp vào `lib/run-label.ts` (`recordLabel`, `recordLabelText`); bảng Lượt chạy dùng `recordLabelText`. R2 đổi `tenants/flows/lib/run-title.ts` dùng `recordLabel`. Export dùng chung đã có sẵn một chỗ: `lib/run-detail-view.ts` `isRunEnded`, `components/run/RunStatusBadge.tsx`, `components/editor/EditorRunsTab.tsx` `runColumns`.
- TB7: `SLOT_UNKNOWN` (vi+en) thành lời nghiệp vụ kèm cách khắc phục.
- TB8: comment đầu `library.routes.ts` sửa đúng (GATED chỉ platform; `clone-for-company`/đọc chỉ-xem dùng `requireAdminRole`); `preview.routes.ts` dùng `requireAdminRole()`.

## Test
unit `lib/caps-slots.test.ts`, `lib/run-label.test.ts`, `lib/library-view.test.ts` (bỏ ca gán); int evotest `library-preview.int` + `clone-for-company.int`.
Perf: không chạm đường nóng.

## e2e cần đổi (qc khác giữ, KHÔNG sửa ở đây)
- `e2e/P-a/pf4/process-library.pa.ts` ~dòng 131–136: bước `toolbar.getByRole("button", { name: "Gán cho tenant" })` + "Đã cập nhật gán cho 1 tenant" + kiểm "Dùng bởi = 1 công ty" — nút không còn; đổi sang gán ở Công ty › Quy trình (hoặc API `PUT /tenants/:tid/process-routing/...`) rồi kiểm cột "Dùng bởi", và thêm kiểm `assign-where` hiện chữ + link.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/thu-vien-khong-gan-truc-tiep.md
#### Yêu cầu: Thư viện quy trình không gán trực tiếp cho công ty (CR-121 R5/R7)
Trình sửa quy trình thư viện không còn nút gán cho công ty; chỉ ghi "Công ty gán quy trình này ở trang Công ty › Quy trình" kèm link tới danh sách công ty. Việc gán duy nhất nằm ở Công ty › Quy trình.
- Kịch bản: trình sửa thư viện không còn hành động gán, chữ hướng dẫn thay thế hiện đủ [test: thủ công — e2e/P-a/pf4/process-library.pa.ts (qc đổi), cột Dùng bởi]
- Kịch bản: các khe của công ty rút từ năng lực app, bỏ trùng [test: apps/admin-web/src/features/processes/lib/caps-slots.test.ts » slotsOfCaps]
- Kịch bản: nhãn hồ sơ lượt chạy dùng một hàm [test: apps/admin-web/src/features/processes/lib/run-label.test.ts » run-label]

## Việc còn lại
- qc đổi e2e `process-library.pa.ts`; R2 đổi `run-title.ts` dùng `recordLabel`.