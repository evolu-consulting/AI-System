-- CR-130 L3: nhãn đơn xin tham gia Bảng tin `buyer` ⇒ `customer` (một tên với SHT). Chưa có khách dùng thật ⇒ đổi dữ liệu tại chỗ.
ALTER TABLE community.join_requests DROP CONSTRAINT IF EXISTS join_requests_labels_ck;
--> statement-breakpoint
UPDATE community.join_requests SET labels = array_replace(labels, 'buyer', 'customer') WHERE 'buyer' = ANY (labels);
--> statement-breakpoint
ALTER TABLE community.join_requests ADD CONSTRAINT join_requests_labels_ck CHECK (labels <@ ARRAY['supplier', 'customer']::text[]);
