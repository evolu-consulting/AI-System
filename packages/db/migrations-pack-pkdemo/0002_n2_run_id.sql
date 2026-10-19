-- N2-FR-01 · N2-D07: bản ghi gói gắn run quy trình (khuôn `contracts.contracts.run_id`) — cột null, không mất dữ liệu.
ALTER TABLE pkdemo.items ADD COLUMN IF NOT EXISTS run_id uuid;
