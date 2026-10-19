-- W1 · "Việc của tôi" + "Mua hàng" (docs/specs/W1-mywork-sourcing/tasks.md). (1) `sourcing_choices`: nguồn mua do người chọn cho một
-- dòng hàng bán (mgmt-app lưu `items[i].source` trong bản ghi HĐ; ở đây bảng riêng — sửa HĐ chiếu lại dòng hàng không làm mất lựa
-- chọn). Không FK sang `contracts.contracts` (D9-02: test HD1 TRUNCATE không CASCADE); lựa chọn mồ côi/không còn hợp lệ bị bỏ khi
-- đọc. Thấy được khi thấy HĐ bán (RESTRICTIVE như `obligations`, M1D). (2) Index cho danh sách "Việc của tôi": hạn xử lý của HĐ
-- chưa ghi kết quả, hẹn nhắc của mình chưa xong, nhắc hạn đã gửi cho mình. Chỉ cộng thêm; chạy lại vô hại.
CREATE TABLE IF NOT EXISTS contracts.sourcing_choices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sale_contract_id uuid NOT NULL,
  sale_line smallint NOT NULL,
  source_contract_id uuid NOT NULL,
  source_line smallint NOT NULL,
  chosen_by uuid,
  chosen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sourcing_choices_pkey PRIMARY KEY (id),
  CONSTRAINT sourcing_choices_line_uq UNIQUE (tenant_id, sale_contract_id, sale_line),
  CONSTRAINT sourcing_choices_lines_ck CHECK (sale_line BETWEEN 0 AND 9999 AND source_line BETWEEN 0 AND 9999)
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'sourcing_choices');
--> statement-breakpoint
DROP POLICY IF EXISTS sourcing_choices_visible ON contracts.sourcing_choices;
--> statement-breakpoint
CREATE POLICY sourcing_choices_visible ON contracts.sourcing_choices AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all()) OR EXISTS (SELECT 1 FROM contracts.contracts c
    WHERE c.id = sourcing_choices.sale_contract_id AND c.tenant_id = sourcing_choices.tenant_id));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contracts_deadline_idx ON contracts.contracts (tenant_id, action_deadline, id)
  WHERE kind = 'contract' AND handled IS NULL AND action_deadline IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cks_followups_user_idx ON contracts.cks_followups (tenant_id, user_id, due_at)
  WHERE done_at IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS contract_reminders_user_idx ON contracts.contract_reminders (tenant_id, user_id, sent_at DESC);
--> statement-breakpoint
-- (3) Hẹn nhắc chung (mgmt-app `ledger/followups.py`: `subject_kind` = obligation | contract | company | renewal): "nhắc tôi lúc … về …".
-- Của RIÊNG người tạo (mgmt `mine()` lọc theo email) và chỉ về thứ người đó thấy: policy RESTRICTIVE (mọi lệnh, kể cả chèn) =
-- `user_id` là mình (việc nền, user rỗng, thấy hết) VÀ (không gắn HĐ HOẶC thấy HĐ — luật thấy M1/M1b áp bên trong). Một hẹn nhắc mở
-- mỗi người + chủ thể (đặt lại ⇒ dời). `subject_id` là text: uuid đợt/HĐ/gia hạn hoặc khoá đối tác (`party_key`). Không FK (D9-02).
CREATE TABLE IF NOT EXISTS contracts.followups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  subject_kind text NOT NULL,
  subject_id text NOT NULL,
  contract_id uuid,
  due_at timestamptz NOT NULL,
  title text NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  CONSTRAINT followups_pkey PRIMARY KEY (id),
  CONSTRAINT followups_kind_ck CHECK (subject_kind IN ('obligation', 'contract', 'company', 'renewal')),
  CONSTRAINT followups_status_ck CHECK (status IN ('pending', 'sent', 'done')),
  CONSTRAINT followups_done_ck CHECK ((status = 'done') = (done_at IS NOT NULL)),
  CONSTRAINT followups_text_ck CHECK (char_length(subject_id) BETWEEN 1 AND 300 AND char_length(title) BETWEEN 1 AND 300
    AND char_length(note) <= 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS followups_open_uq ON contracts.followups (tenant_id, user_id, subject_id) WHERE status <> 'done';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS followups_due_idx ON contracts.followups (tenant_id, user_id, due_at) WHERE status <> 'done';
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'followups');
--> statement-breakpoint
DROP POLICY IF EXISTS followups_mine ON contracts.followups;
--> statement-breakpoint
CREATE POLICY followups_mine ON contracts.followups AS RESTRICTIVE FOR ALL TO contracts_rw
  USING ((NULLIF(current_setting('app.user_id', true), '') IS NULL
      OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
    AND (contract_id IS NULL OR EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.id = followups.contract_id AND c.tenant_id = followups.tenant_id)));
--> statement-breakpoint
REVOKE DELETE ON contracts.followups FROM contracts_rw;