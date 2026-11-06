-- CR-122 · E5b · hạn ký + chu kỳ nhắc THEO PHONG BÌ (node Ký số đặt `due_days`/`remind_every_hours`): chỉ thêm cột, nullable, không backfill.
-- Vòng nền `esign-sweep` đọc cột này TRƯỚC; trống (phong bì cũ / gửi từ bước Ký số của luồng duyệt) ⇒ dùng `flow_steps` của bước Ký số như trước.
ALTER TABLE contracts.esign_envelopes ADD COLUMN IF NOT EXISTS due_h integer;
--> statement-breakpoint
ALTER TABLE contracts.esign_envelopes ADD COLUMN IF NOT EXISTS remind_every_h integer;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'esign_envelopes_due_ck') THEN
    ALTER TABLE contracts.esign_envelopes ADD CONSTRAINT esign_envelopes_due_ck
      CHECK ((due_h IS NULL OR due_h BETWEEN 1 AND 2160) AND (remind_every_h IS NULL OR remind_every_h BETWEEN 1 AND 720));
  END IF;
END $$;
