---
id: cr121-qc-flows-list
lát: cr121-qc-flows-list
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-r2-shell-tenants, cr121-qc-e2e-ui2
---
## Plan (ngắn)
Vòng 3 (chỉ sửa test): ca tenant_admin còn bấm sidebar "Quy trình" + `flows-list` chuyển sang lối mới.

## Làm
- `P-b/admin/editor.pb.ts`, `P-d/admin-stage.pd.ts`: mở trình sửa bản riêng của công ty qua `/processes/<id>` (cùng đường `openDef` của P-b2/P-d) thay cho danh sách sidebar đã gỡ.
- `dm.pa`, `forward.pa`, `scenario/sdlc.pa`, `scenario/hoa-don.pa`: không đổi — link "Quy trình" của chúng là của chat-web (hộp thư quy trình), không phải sidebar admin.
- `admin-cr113-flow.pm`: không đổi — platform_admin, sidebar Quy trình (Thư viện) còn nguyên.
- Chạy lại `m4-quota` E22 và `m2-flow`.

## Không làm / Chạm
Không đụng `admin-runs.pa`, `flag-off.pa`, `cr121-c-flows`, `workflows*.spec`, `conflict-workflows`. Không sửa code sản phẩm. Perf: không.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)
Không thay đổi hành vi (lý do: sửa e2e theo CR-121 R2, không đổi code sản phẩm)