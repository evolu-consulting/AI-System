# features/workflows

Quản lý Workflows [ADM-FR-10] [ADM-FR-11] [ADM-FR-13] [ADM-FR-14] [ADM-FR-15] (M2): catalog workflow dùng chung cho command và agent; chỉ `platform_admin`.

- `api.ts`: hook TanStack Query cho `/admin/workflows*` (list có `counts`, chi tiết, `usages` nạp lười, tạo, `PATCH` kèm `version`, xoá) và danh sách secret cho ô chọn.
- Danh sách: bộ lọc nằm trên URL (`?q&status=on|off|unattached&secret=<NAME>&page`, `routes/_authed/workflows/index.tsx`). Chip `Chưa gắn` gọi API bằng `attached=false`; `?secret=` hiện chip "Secret: NAME ✕".
- Cấu trúc `components/{list,editor}`: `list/` (WorkflowTable, WorkflowRowMenu, UsageCell, WorkflowFilters, WorkflowGuide, WorkflowBlockedDialog, WorkflowDeleteDialog), `editor/` (WorkflowEditorHeader, WorkflowInfoSection, SchemaEditor, SchemaParamRow, SchemaBreaksAlert, ToolPreview, WorkflowUsageTab).
- `components/`: `WorkflowTable` + `WorkflowRowMenu` + `UsageCell` (Popover usages), `WorkflowGuide` (nhớ trong `localStorage ai.workflowsGuide`), `WorkflowBlockedDialog` (AC-A05: liệt kê cả command và agent từ `details` của 409).
- Editor (`/workflows/new`, `/workflows/$id?tab=`): `WorkflowInfoSection`, `SchemaEditor` + `SchemaParamRow` (≤ 50 tham số, ↑↓, `Lựa chọn` cho `select`), `ToolPreview` ("Model thấy gì", dựng từ giá trị đang soạn), `WorkflowUsageTab`. Tạo mới gộp Input vào tab Thông tin.
- `hooks/use-workflow-editor`: lưu và ánh xạ lỗi (`KEY_TAKEN` → ô Key, `SCHEMA_BREAKS_COMMANDS` → `SchemaBreaksAlert`, `WORKFLOW_IN_USE` khi tắt bằng công tắc → dialog chặn và công tắc quay lại, `VERSION_CONFLICT → ConflictDialog (M3)).
- `hooks/use-workflow-actions`: bật/tắt/xoá ở danh sách.
- `lib/schemas.ts`: `workflowSchema` (mô tả 20–400 sau trim, Base URL http(s) không userinfo, tham số: tên, trùng, mô tả, lựa chọn); `lib/tool-preview.ts`: `toToolPreview`; `lib/usage.ts`: nhóm DependencyList.
