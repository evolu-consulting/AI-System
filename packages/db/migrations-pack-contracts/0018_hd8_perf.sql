-- HD8-NFR-01 (Luật 4c) · /partners: dòng hiếm của sổ đối tác (chấm tay, quá hạn, gia hạn CKS, hoãn) đọc theo loại thay vì lọc cả sổ
-- (trước: mỗi tập con quét toàn bộ 10.000 dòng/tenant qua `partner_events_party_idx` + lọc policy M1 từng dòng, ~4 ms mỗi tập).
-- Chỉ cộng thêm; chạy lại vô hại.
CREATE INDEX IF NOT EXISTS partner_events_type_idx ON contracts.partner_events (tenant_id, type, party_key, role, at);