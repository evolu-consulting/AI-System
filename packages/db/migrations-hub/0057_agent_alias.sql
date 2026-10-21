-- studio-agents-list · cờ dữ liệu "đã gộp": `hub.agents.alias_of` trỏ agent thay thế. `mgmt-assistant` (disabled từ 0051) chỉ còn là
-- alias + lịch sử ⇒ alias_of = assistant; Studio ẩn khỏi danh sách mặc định, không cho bật. Chạy lại vô hại. Không đổi hub_config_version
-- (cột chỉ để hiển thị, runtime không đọc).
ALTER TABLE hub.agents ADD COLUMN IF NOT EXISTS alias_of uuid REFERENCES hub.agents(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE hub.agents DROP CONSTRAINT IF EXISTS agents_alias_not_self_ck;
--> statement-breakpoint
ALTER TABLE hub.agents ADD CONSTRAINT agents_alias_not_self_ck CHECK (alias_of IS NULL OR alias_of <> id);
--> statement-breakpoint
UPDATE hub.agents o SET alias_of = n.id
  FROM hub.agents n
  WHERE o.key = 'mgmt-assistant' AND n.key = 'assistant' AND o.alias_of IS NULL;
