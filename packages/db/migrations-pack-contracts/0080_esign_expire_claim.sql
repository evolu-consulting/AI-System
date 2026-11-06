-- CR-122 · E5d · giành quyền huỷ phong bì QUÁ HẠN trước khi gọi nhà cung cấp: `expire_claimed_at` đặt bằng UPDATE có điều kiện — chỉ bên giành được
-- (chưa ai giữ, hoặc lease cũ hết hạn khi tiến trình giữ chết giữa chừng) mới gọi `voidEnvelope` + bắn `esign.voided`. Chỉ thêm cột nullable, không backfill.
ALTER TABLE contracts.esign_envelopes ADD COLUMN IF NOT EXISTS expire_claimed_at timestamptz;
