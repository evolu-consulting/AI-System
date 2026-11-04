-- CR-118 · cr118-config-consistency: Hub (ConfigCache) đọc agent của gói từ `packs.pack_agents` thay cho hằng `PACK_AGENTS`.
-- Tối thiểu quyền: đúng SELECT trên đúng một bảng (không INSERT/UPDATE/DELETE/TRUNCATE; bảng không có cột nhạy cảm, không RLS).
-- USAGE schema `packs` cho hub_api đã có từ 0006. Ghi bảng vẫn chỉ qua migration gói (chủ migration).
GRANT SELECT ON packs.pack_agents TO hub_api;
