-- delivery-opts · (1) mốc giao ghi % (`obligations.delivery_pct`): xác nhận đợt tự tính SL dòng = làm tròn(% × SL HĐ);
-- (2) cài đặt tenant `approval_settings.allow_negative_stock` (mặc định TẮT): bật ⇒ giao vượt tồn không bị chặn, tồn được âm;
-- (3) nới ràng buộc kho cho tồn âm (giá trị tồn vẫn ≥ 0 và = 0 khi tồn ≤ 0) + sổ ghi `overdrawn` (phần giao vượt tồn) để theo dõi.
ALTER TABLE contracts.obligations ADD COLUMN IF NOT EXISTS delivery_pct numeric(5, 2);
--> statement-breakpoint
ALTER TABLE contracts.obligations DROP CONSTRAINT IF EXISTS obligations_delivery_pct_ck;
--> statement-breakpoint
ALTER TABLE contracts.obligations ADD CONSTRAINT obligations_delivery_pct_ck
  CHECK (delivery_pct IS NULL OR (kind = 'delivery' AND delivery_pct > 0 AND delivery_pct <= 100));
--> statement-breakpoint
ALTER TABLE contracts.approval_settings ADD COLUMN IF NOT EXISTS allow_negative_stock boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE contracts.product_components DROP CONSTRAINT IF EXISTS product_components_qty_ck;
--> statement-breakpoint
ALTER TABLE contracts.product_components ADD CONSTRAINT product_components_qty_ck
  CHECK (stock_value >= 0 AND avg_cost >= 0 AND (on_hand > 0 OR stock_value = 0)
    AND (mode IN ('stock', 'quota') OR (on_hand = 0 AND stock_value = 0)));
--> statement-breakpoint
ALTER TABLE contracts.stock_moves DROP CONSTRAINT IF EXISTS stock_moves_num_ck;
--> statement-breakpoint
ALTER TABLE contracts.stock_moves ADD CONSTRAINT stock_moves_num_ck
  CHECK (qty > 0 AND unit_cost BETWEEN 0 AND 1000000000000000
    AND amount BETWEEN 0 AND 1000000000000000 AND value_after >= 0);
--> statement-breakpoint
ALTER TABLE contracts.stock_moves ADD COLUMN IF NOT EXISTS overdrawn numeric(18, 4);
