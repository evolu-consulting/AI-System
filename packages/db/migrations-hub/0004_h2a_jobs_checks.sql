-- HUB-FR-89 · HUB-FR-95 · plan H2a §2.2, plan-errors §2 (D1b): nới CHECK `hub.jobs` theo contract C2
-- (`HUB_JOB_ERROR_CODES` thêm NOT_CONFIGURED, `JOB_FAIL_REASONS` thêm credential/upstream) — 0002 sót.
-- Migration mới (0002/0003 đã áp trên DB dev). Viết tay, idempotent: DROP + ADD trong DO $$ chỉ khi định nghĩa
-- hiện tại chưa có giá trị mới (lần 2 = không đổi). Chỉ nới tập giá trị — không mất dữ liệu.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_error_code_check'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''NOT_CONFIGURED''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_error_code_check;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_error_code_check CHECK (
      error_code IS NULL
      OR error_code IN ('ALL_PROVIDERS_EXHAUSTED', 'TIMEOUT', 'CANCELLED', 'UPSTREAM_ERROR', 'INTERNAL_ERROR',
                        'NOT_CONFIGURED')
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jobs_error_reason_check'
                 AND conrelid = 'hub.jobs'::regclass AND pg_get_constraintdef(oid) LIKE '%''credential''%'
                 AND pg_get_constraintdef(oid) LIKE '%''upstream''%') THEN
    ALTER TABLE hub.jobs DROP CONSTRAINT IF EXISTS jobs_error_reason_check;
    ALTER TABLE hub.jobs ADD CONSTRAINT jobs_error_reason_check CHECK (
      error_reason IS NULL
      OR error_reason IN ('quota', 'tenant_slots', 'provider_busy', 'provider_unavailable', 'orphaned', 'crash',
                          'cancelled', 'timeout', 'invalid_payload', 'invalid_output', 'sandbox', 'credential',
                          'upstream')
    );
  END IF;
END
$$;
