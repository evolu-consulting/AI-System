-- Prod-fixes1 · bản gửi email tới miền dành riêng (.invalid/.test/.example/.localhost, example.com/org/net) được ghi `skipped`
-- (kèm last_error = mã lý do), không tính là lỗi. Chỉ nới CHECK trạng thái; không đụng dữ liệu.
ALTER TABLE hub.notification_deliveries DROP CONSTRAINT IF EXISTS notification_deliveries_ck;
--> statement-breakpoint
ALTER TABLE hub.notification_deliveries ADD CONSTRAINT notification_deliveries_ck CHECK (channel IN ('email', 'push')
  AND status IN ('pending', 'sending', 'sent', 'dead', 'skipped') AND attempts BETWEEN 0 AND 20
  AND (last_error IS NULL OR char_length(last_error) <= 64));
