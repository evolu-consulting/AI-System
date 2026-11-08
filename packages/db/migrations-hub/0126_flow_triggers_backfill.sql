-- CR-125 · G8 · cờ `flow_triggers` + `company_flows` là hai nguồn cho "công ty đang dùng quy trình nào" (audit #2). Từ c2 (3ed4f2fa7) gán/áp dụng
-- tự đặt cờ BẬT; prod còn công ty do platform gán sẵn từ trước (có dòng `company_flows.enabled` nhưng cờ tắt/vắng) ⇒ chạy "cách cũ".
-- Quyết định người dùng 2026-11-08: BẬT cờ cho tất cả. Chỉ công ty có dòng gán đang bật; công ty khác không đụng; chạy lại vô hại
-- (không đổi hàng đã bật, không đổi updated_at của hàng đó). Một câu theo tập.
INSERT INTO hub.tenant_flow_settings (tenant_id, flow_triggers)
SELECT DISTINCT f.tenant_id, true FROM hub.company_flows f WHERE f.enabled
ON CONFLICT (tenant_id) DO UPDATE SET flow_triggers = true, updated_at = now()
  WHERE NOT hub.tenant_flow_settings.flow_triggers;
