-- CR-097 U2 · R39 · UT-FR-13: cờ đỏ — hai loại sự kiện nghiêm trọng của sổ đối tác (`no_delivery` không giao, `fraud` gian lận).
-- Chỉ nới CHECK loại + thêm CHECK "phải có lý do" + chỉ mục một phần cho truy vấn cờ; không đổi dòng cũ, chạy lại vô hại.
-- Cờ = còn dòng nghiêm trọng CHƯA huỷ trong khoảng tính (không tính vào điểm); gỡ cờ = huỷ dòng (`partner_event_voids`, có lý do + nhật ký).
ALTER TABLE contracts.partner_events DROP CONSTRAINT IF EXISTS partner_events_type_ck;
--> statement-breakpoint
ALTER TABLE contracts.partner_events ADD CONSTRAINT partner_events_type_ck CHECK (type IN ('paid', 'received', 'postponed',
  'appointment_kept', 'appointment_missed', 'delivered', 'reminded', 'complaint', 'cks_renewed', 'cks_lapsed', 'manual_adjust',
  'rating', 'overdue', 'no_delivery', 'fraud'));
--> statement-breakpoint
ALTER TABLE contracts.partner_events DROP CONSTRAINT IF EXISTS partner_events_severe_reason_ck;
--> statement-breakpoint
ALTER TABLE contracts.partner_events ADD CONSTRAINT partner_events_severe_reason_ck
  CHECK (type NOT IN ('no_delivery', 'fraud') OR char_length(btrim(note)) >= 1);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_events_severe_idx ON contracts.partner_events (tenant_id, party_key, role, at)
  WHERE type IN ('no_delivery', 'fraud');