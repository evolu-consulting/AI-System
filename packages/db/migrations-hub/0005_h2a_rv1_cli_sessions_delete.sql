-- HUB-FR-23 · H2a-R14 · REVIEW 1 Hub #5: phiên `dify-agent` mà Dify trả 404 (conversation lạ/đã xoá) → Hub xoá dòng
-- `hub.cli_sessions(provider_key='dify')` rồi thử lại một lần không kèm `conversation_id`. 0002 chỉ cấp SELECT/INSERT/UPDATE.
-- Viết tay, idempotent (GRANT lặp lại vô hại). Câu xoá luôn lọc `tenant_id` + `provider_key` (dify-agent.repo).
GRANT DELETE ON hub.cli_sessions TO hub_rw;
