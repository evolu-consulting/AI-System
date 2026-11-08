-- CR-125 · G7 · số «Đang chờ công ty nhận» trên menu (`GET /pack/nav`, đường nóng): đếm `status = 'pending'` theo công ty chỉ đọc index (index-only),
-- không quét lịch sử đã trả lời của công ty. Chỉ cộng thêm; chạy lại vô hại.
CREATE INDEX IF NOT EXISTS partner_inbox_pending_idx ON contracts.partner_inbox (tenant_id) WHERE status = 'pending';
