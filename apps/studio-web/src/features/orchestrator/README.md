# features/orchestrator

Orchestrator [HUB-FR-62] (H4a): `/orchestrator` — bản mặc định (`DefaultForm`) + bảng theo tenant (`TenantTable`), Sheet thêm/sửa (`TenantSheet`, điền sẵn từ bản mặc định), xoá bản tenant.

- `api.ts`: `GET /orchestrator`, `PUT /orchestrator/default`, `POST/PUT/DELETE /orchestrator/tenants[/:tenant_id]` (`encodeURIComponent`), catalog `tenants`.
- `hooks/`: `use-orch-data` (đọc), `use-orch-editor` (form), `use-orch-mutations` (ghi + map lỗi).
- `lib/save-error.ts`: `ORCHESTRATOR_EXISTS`, `TENANT_INACTIVE`, `AGENT_NOT_ORCHESTRATABLE` gắn trường; `VERSION_CONFLICT{current, updated_at}` ⇒ ConflictDialog.
- Chỉ chọn agent `agentic-cli` đang bật (`ORCHESTRATOR_RUNTIMES` từ `@ai/contracts/studio`); cảnh báo "Chậm" theo luật Hub.

Bẫy: đóng Sheet mất nháp không hỏi (TD #83); bản mặc định không xoá được (409 protected).
