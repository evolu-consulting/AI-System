# features/agents

Agents [HUB-FR-60] [HUB-FR-61] [HUB-FR-64] [HUB-FR-90] (H4a): `/agents` (danh sách) và `/agents/new`, `/agents/$agentId` (editor; nhân bản `?from=`).

- `api.ts`: list/detail/POST/PUT/PATCH enabled/DELETE agent + catalog `model-profiles`, `workflows`, `agent-types`.
- Danh sách (`components/list/`): tìm/lọc trên URL (`use-agent-filters`), badge Orchestrator/Chưa cấp/trùng ý, banner "Cần chú ý", `truncated` ⇒ lọc server, bật/tắt + Hoàn tác, menu ⋯ (Nhân bản, Đặt làm Orchestrator — chỉ `PUT orchestrator/default`, Xoá + map 409).
- Editor (`components/editor/`, `components/sections/`): 5 bước; runtime chọn khi tạo, không đổi sau; `SchemaForm` dựng từ `agent_types.config_schema` (D9); `CliOptions` cho `agentic-cli` (tick xác nhận Bash); `WorkflowPicker` lọc theo loại app; "Xem như Orchestrator thấy".
- `lib/draft/`: nháp ↔ payload, map `issues`/`INVALID_REFERENCE` (`details.field`) về trường, JSON thô sai chặn Lưu (`badJson`).
- Lưu: `UnsavedGuard`; 409 `VERSION_CONFLICT` ⇒ ConflictDialog dùng chung.

Bẫy: TD #82 (lý do khoá Switch chỉ ở `title`), #84 (chưa lazy picker/SchemaForm), #86 (`badJson` kẹt khi ô JSON unmount), #87 (ô JSON giữ text cũ sau "Tải bản mới").
