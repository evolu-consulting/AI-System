-- CR-121 F-4 · PII: cột `admin.tenants.profile` (jsonb: legal_name, tax_id, email, phones…) đã được 0035 cấp lại cho hub_ro.
-- Hub không có đường đọc cột này (grep hub-api/agent-runtime/worker: chỉ chọn cột tường minh) ⇒ thu SELECT cột `profile` của hub_ro.
-- Các cột còn lại của hub_ro giữ nguyên. Chạy lại vô hại (REVOKE cột chưa có quyền là no-op).
REVOKE SELECT (profile) ON admin.tenants FROM hub_ro;
