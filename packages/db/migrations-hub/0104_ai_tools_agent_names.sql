-- CR-121 F10 · Công cụ AI hiện TÊN agent thật: admin-api đọc `hub.agents(id, key, name)` (chỉ 3 cột, không đọc prompt/runtime) trong cùng
-- câu danh sách gộp. Chỉ cấp quyền đọc cột; chạy lại vô hại.
GRANT SELECT (id, key, name) ON hub.agents TO admin_rw;