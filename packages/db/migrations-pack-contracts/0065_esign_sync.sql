-- esign-sweep2 · pha đồng bộ phong bì với nhà cung cấp trong vòng nền (lưới an toàn khi webhook không tới): mốc "lần kiểm cuối"
-- `sync_checked_at` (không gọi lại nhà cung cấp liên tục khi trạng thái không đổi) + index một phần trên phong bì MỞ theo
-- `greatest(updated_at, sync_checked_at)` (cũ nhất trước). Câu chọn chạy chéo tenant dưới role `contracts_job`: thêm quyền ĐỌC các cột
-- cần lọc (id, status, updated_at, sync_checked_at) và GHI DUY NHẤT cột `sync_checked_at`, chỉ trên phong bì mở (policy UPDATE riêng
-- của `contracts_job`). Không đọc người ký/lý do/tệp; `contracts_rw` không đổi. Chỉ cộng thêm; chạy lại vô hại.
ALTER TABLE contracts.esign_envelopes ADD COLUMN IF NOT EXISTS sync_checked_at timestamptz;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS esign_envelopes_sync_idx ON contracts.esign_envelopes ((greatest(updated_at, sync_checked_at)), id)
  WHERE status IN ('sent', 'delivered');
--> statement-breakpoint
GRANT SELECT (id, status, updated_at, sync_checked_at) ON contracts.esign_envelopes TO contracts_job;
--> statement-breakpoint
GRANT UPDATE (sync_checked_at) ON contracts.esign_envelopes TO contracts_job;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'contracts' AND tablename = 'esign_envelopes'
      AND policyname = 'esign_envelopes_job_sync') THEN
    CREATE POLICY esign_envelopes_job_sync ON contracts.esign_envelopes FOR UPDATE TO contracts_job
      USING (status IN ('sent', 'delivered')) WITH CHECK (status IN ('sent', 'delivered'));
  END IF;
END
$$;
