-- CR-161 · sửa lỗi tệp trò chuyện (hub 0148): chữ ký `hub.cc_file_add` đổi (thêm id FileBox) và `cc_file_get` đổi kiểu trả ⇒ hub 0148 đã DROP + tạo lại,
-- quyền cũ mất. Cấp lại cho `contracts_rw` không điều kiện (khuôn 0116; migration gói chạy SAU role). Chạy lại vô hại. `cc_files_sweep` KHÔNG cấp.
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.cc_file_add(uuid, uuid, text, text, text, bigint, text), hub.cc_file_get(uuid) TO contracts_rw;
