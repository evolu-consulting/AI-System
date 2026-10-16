-- DLC-R10 · provider `dlc` (engine AI SDLC, vendor `evolu`): job `agent.cli` của agent dùng profile `dlc-1` được Agent
-- Runtime chạy bằng HTTP tới engine DLC (`runtimes/dlc`), không CLI. Chỉ nới CHECK vendor — không mất dữ liệu; viết tay,
-- idempotent (như vendor `dify` ở 0002).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'providers_vendor_check'
                 AND conrelid = 'hub.providers'::regclass AND pg_get_constraintdef(oid) LIKE '%''evolu''%') THEN
    ALTER TABLE hub.providers DROP CONSTRAINT IF EXISTS providers_vendor_check;
    ALTER TABLE hub.providers ADD CONSTRAINT providers_vendor_check
      CHECK (vendor IN ('anthropic', 'openai', 'google', 'fake', 'dify', 'evolu'));
  END IF;
END
$$;
