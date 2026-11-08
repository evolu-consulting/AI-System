-- CR-125 · cr125-run-attachments · liên kết tệp đính kèm ↔ lượt chạy: tệp người điền (phiếu «Tạo yêu cầu», bước form) vào lượt thì mọi người
-- XEM ĐƯỢC LƯỢT (định nghĩa `hub.process_run_viewer`, 0019) mở được tệp qua `GET /attachments/:id(/content)`; người ngoài / công ty khác không.
-- Bảng nối nhỏ, không đụng `hub.attachments` (CHECK/RLS chủ-sở-hữu giữ nguyên): quyền đọc theo lượt là nhánh THÊM ở service (như `autofix_results`
-- PC-R14), tra bằng scope system + `tenant_id` tường minh rồi hỏi definer `process_run_viewer` ở scope user. Hàng có liên kết KHÔNG bị sweeper
-- "chưa gắn quá 24 h" dọn (thêm NOT EXISTS ở sweeper.ts). Xoá lượt / xoá tệp ⇒ CASCADE liên kết. `source`: start (phiếu) | form (bước form) |
-- subprocess (kế thừa từ lượt cha qua input_map). Viết tay, idempotent, chỉ thêm bảng ⇒ không mất dữ liệu.
CREATE TABLE IF NOT EXISTS hub.process_run_files (
  process_run_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  linked_by uuid NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT process_run_files_pkey PRIMARY KEY (process_run_id, attachment_id),
  CONSTRAINT process_run_files_source_ck CHECK (source IN ('start', 'form', 'subprocess')),
  CONSTRAINT process_run_files_run_fk FOREIGN KEY (process_run_id, tenant_id)
    REFERENCES hub.process_runs (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT process_run_files_attachment_fk FOREIGN KEY (attachment_id)
    REFERENCES hub.attachments (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS process_run_files_attachment_idx ON hub.process_run_files (attachment_id, tenant_id);
--> statement-breakpoint
ALTER TABLE hub.process_run_files ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'hub' AND tablename = 'process_run_files'
                 AND policyname = 'process_run_files_hub_rw') THEN
    CREATE POLICY process_run_files_hub_rw ON hub.process_run_files FOR ALL TO hub_rw
      USING (current_setting('app.scope', true) = 'system'
             OR (current_setting('app.scope', true) = 'user'
                 AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid))
      WITH CHECK (current_setting('app.scope', true) = 'system'
             OR (current_setting('app.scope', true) = 'user'
                 AND tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid));
  END IF;
END
$$;
--> statement-breakpoint
GRANT SELECT, INSERT ON hub.process_run_files TO hub_rw;
