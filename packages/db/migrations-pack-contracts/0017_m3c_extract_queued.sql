-- M3c · review B #7: lượt AI đọc còn XẾP HÀNG (Redis Streams, worker chưa nhận) không được tính là "mất" sau 15'. `queued_at` có
-- giá trị ⇔ lượt `extracting` đang chờ hàng (đặt lúc mở lượt / trích lại); worker xoá về NULL khi bắt đầu đọc (STALE khi đó
-- tính từ `contracts.updated_at` mà worker chạm). Cột thêm nullable; hàng cũ giữ NULL (hành vi cũ). Mặc định đặt SAU khi thêm
-- cột để hàng có sẵn không bị gán now().
ALTER TABLE contracts.approvals ADD COLUMN IF NOT EXISTS queued_at timestamptz;
--> statement-breakpoint
ALTER TABLE contracts.approvals ALTER COLUMN queued_at SET DEFAULT now();
