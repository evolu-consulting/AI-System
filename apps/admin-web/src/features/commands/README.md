# features/commands

Quản lý Commands [ADM-FR-20] [ADM-FR-21] [ADM-FR-22] [ADM-FR-24] (M2): lệnh ngắn người dùng gõ trong Chat/Extension, mỗi lệnh gọi một workflow; chỉ `platform_admin`. Không có nút Chạy thử (FR-23, M5) và không có Lịch sử (M4).

- `api.ts`: hook TanStack Query cho `/admin/commands*` (list có `counts`, chi tiết, tạo, `PATCH` kèm `version`, xoá, `access`), danh sách chọn Feature/Workflow (≤ 200) và chi tiết workflow (input schema).
- Danh sách (`/commands?q&status&feature&workflow&page`): `CommandToggle` (Switch lạc quan; tắt → toast + Hoàn tác 5 s; workflow tắt → khoá bằng `aria-disabled` kèm tooltip), `CommandRowMenu` (Sửa · Nhân bản → `/commands/new?from=` · Bật/Tắt · Xoá gõ tên), `CommandFilters` (2 Select).
- Editor (`/commands/new`, `/commands/$id`, `?from=` nhân bản, `?workflow=` chọn sẵn): 5 bước trong tab "Cấu hình": `StepName` (tên chuẩn hoá khi gõ + kiểm trùng khi rời ô, `AliasField`, `LocalizedInput` mô tả, `FeatureField` mặc định `core`), `StepWorkflow` (Select + `WorkflowCard`, Alert workflow tắt / map bị bỏ), `StepArgs` (`ArgRow`, `SyntaxPreview`), `StepInputMap` (`InputMapRow`, 8 nguồn, cảnh báo sai kiểu không chặn), `StepOutput`.
- Tab "Ai dùng được" (`AccessTab`, `lazy()`): tenant dùng được command, tổng "n tenant · m user" trên tiêu đề tab, khối nhóm "Chưa khả dụng" (M3). Khoá khi tạo mới.
- `hooks/use-command-form`: dựng giá trị ban đầu, lưu; thiếu input bắt buộc → **không gửi request** (AC-A03); ánh xạ lỗi server (`COMMAND_NAME_TAKEN` → ô tên/alias, `COMMAND_NEEDS_FEATURE`, `WORKFLOW_DISABLED`, `INPUT_MAP_INVALID`, `VERSION_CONFLICT` → Tải lại). `hooks/use-workflow-link`: nạp workflow, điền sẵn output field, gộp map khi đổi workflow.
- `lib/`: `schemas.ts` (commandSchema), `defaults.ts` (form ↔ body, nhân bản D6), `input-map.ts` (`reconcileMap`, `validateInputMap`, `mapWarnings`: cùng luật với server), `syntax.ts` (`buildSyntax`, `mapSyntax`), `access.ts`.
