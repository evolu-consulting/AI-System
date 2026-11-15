-- CR-161 · sửa lỗi tệp trò chuyện (hub 0148): chữ ký `hub.cc_file_add` đổi (thêm id FileBox) và `cc_file_get` đổi kiểu trả ⇒ hub 0148 đã DROP + tạo lại,
-- quyền cũ mất. Cấp lại cho `contracts_rw` không điều kiện (khuôn 0116; migration gói chạy SAU role). Chạy lại vô hại. `cc_files_sweep` KHÔNG cấp.
-- CR-169 lát 2a: hub 0149 đã GỠ cc_file_add/cc_file_get ⇒ bỏ GRANT EXECUTE (DB dựng sạch lỗi nếu giữ). Còn lại chỉ USAGE schema hub ở trên.
GRANT USAGE ON SCHEMA hub TO contracts_rw;
