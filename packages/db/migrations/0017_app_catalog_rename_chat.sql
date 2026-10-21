-- switcher-unify: app "chat" đổi tên hiển thị "AI System" -> "Chat AI" / "AI Chat" (AI System là cả nền tảng). Chỉ đổi khi tên còn
-- đúng mặc định cũ (cả vi lẫn en) ⇒ tên admin đã sửa ở "Ứng dụng" được giữ. Bump version để client thấy thay đổi.
UPDATE admin.app_catalog
SET name = '{"vi": "Chat AI", "en": "AI Chat"}'::jsonb, version = version + 1, updated_at = now()
WHERE key = 'chat' AND name = '{"vi": "AI System", "en": "AI System"}'::jsonb;