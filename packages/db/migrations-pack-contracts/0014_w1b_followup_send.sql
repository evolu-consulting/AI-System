-- W1b · gửi hẹn nhắc chung (`contracts.followups`) đúng giờ: vòng nền theo mẫu HD4 (tìm tenant có việc bằng role `contracts_job`, rồi claim
-- theo lô trong tx `system(tenant)`). Role job chỉ đọc (tenant_id, due_at, status) của hàng đang chờ, chéo tenant, không đọc nội dung.
-- Index riêng cho truy vấn "hẹn nhắc chờ tới hạn sớm nhất". Chỉ cộng thêm; chạy lại vô hại.
CREATE INDEX IF NOT EXISTS followups_pending_idx ON contracts.followups (due_at) WHERE status = 'pending';
--> statement-breakpoint
GRANT SELECT (tenant_id, due_at, status) ON contracts.followups TO contracts_job;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'contracts' AND tablename = 'followups'
                 AND policyname = 'followups_job') THEN
    CREATE POLICY followups_job ON contracts.followups FOR SELECT TO contracts_job USING (status = 'pending');
  END IF;
END
$$;
