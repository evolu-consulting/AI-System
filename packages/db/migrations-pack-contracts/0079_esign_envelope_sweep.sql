-- CR-122 · E5c · vòng quét THEO PHONG BÌ (node Ký số, không có lượt duyệt kiểu cũ): mốc nhắc cuối + mốc hết hạn ngay trên phong bì ⇒ nhắc đúng
-- chu kỳ, không gửi trùng khi quét lại / nhiều instance; chỉ thêm cột nullable, không backfill (phong bì cũ: trống = chưa nhắc / chưa hết hạn).
ALTER TABLE contracts.esign_envelopes ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
--> statement-breakpoint
ALTER TABLE contracts.esign_envelopes ADD COLUMN IF NOT EXISTS expired_at timestamptz;
