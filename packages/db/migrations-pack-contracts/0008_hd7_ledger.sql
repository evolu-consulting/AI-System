-- HD7-FR-01 · HD7-FR-02 · HD7-NFR-01 · HD7 plan §1 · D7-02 · D7-03 · D7-12…D7-14: sổ thanh toán của gói `contracts` — đợt
-- (`obligations`), sổ đối tác chỉ thêm (`partner_events`) và bảng huỷ (`partner_event_voids`; huỷ = thêm một hàng, sổ không
-- UPDATE/DELETE). Tiền = bigint đồng 0…10¹⁵ (số nguyên an toàn của JS). Không FK sang `contracts.contracts` (D9-02: test HD1
-- TRUNCATE không CASCADE). Lịch mặc định khi HĐ vào trạng thái đã duyệt bằng trigger (D7-09, chạy trong UPDATE HĐ ⇒ khoá HĐ → đợt).
-- Chỉ cộng thêm; chạy lại vô hại.
-- party_key ≡ `ledger.rules.ts::partyKey` (D7-04): MST có chữ số ⇒ 'tax:<chữ số>'; không ⇒ 'name:<fold(tên)>'; rỗng cả hai ⇒ null.
CREATE OR REPLACE FUNCTION contracts.party_key(name text, tax text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog
  RETURN CASE
    WHEN regexp_replace(coalesce(tax, ''), '[^0-9]', '', 'g') <> '' THEN 'tax:' || regexp_replace(tax, '[^0-9]', '', 'g')
    WHEN contracts.fold(coalesce(name, '')) <> '' THEN 'name:' || contracts.fold(name)
  END;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.party_key(text, text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.party_key(text, text) TO contracts_rw;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.obligations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  party_key text,
  direction text NOT NULL,
  kind text NOT NULL DEFAULT 'payment',
  seq smallint NOT NULL,
  due_date date NOT NULL,
  amount bigint,
  status text NOT NULL DEFAULT 'open',
  done_at date,
  done_by uuid,
  postponed_to date,
  postpones int NOT NULL DEFAULT 0,
  reminders int NOT NULL DEFAULT 0,
  overdue_for date,
  source text NOT NULL DEFAULT 'manual',
  estimated boolean NOT NULL DEFAULT false,
  basis text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT obligations_pkey PRIMARY KEY (id),
  CONSTRAINT obligations_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT obligations_direction_ck CHECK (direction IN ('pay', 'receive')),
  CONSTRAINT obligations_kind_ck CHECK (kind IN ('payment', 'delivery')),
  CONSTRAINT obligations_seq_ck CHECK (seq BETWEEN 1 AND 9999),
  CONSTRAINT obligations_amount_ck CHECK (amount BETWEEN 0 AND 1000000000000000),
  CONSTRAINT obligations_status_ck CHECK (status IN ('open', 'done', 'cancelled', 'replaced')),
  CONSTRAINT obligations_done_ck CHECK ((status = 'done') = (done_at IS NOT NULL)),
  CONSTRAINT obligations_counts_ck CHECK (postpones >= 0 AND reminders >= 0),
  CONSTRAINT obligations_source_ck CHECK (source IN ('manual', 'ai', 'default', 'cks')),
  CONSTRAINT obligations_text_ck CHECK (char_length(party_key) <= 300 AND char_length(basis) <= 200)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS obligations_contract_idx ON contracts.obligations (tenant_id, contract_id, seq);
--> statement-breakpoint
-- Bảng Thanh toán (đợt mở theo hạn) — cột tổng đi kèm để tổng hợp không đọc heap.
CREATE INDEX IF NOT EXISTS obligations_open_idx ON contracts.obligations (tenant_id, due_date, id)
  INCLUDE (kind, direction, amount) WHERE status = 'open';
--> statement-breakpoint
-- D7-14 · vòng quá hạn: chỉ đợt mở có đối tác chưa ghi cho hạn hiện tại (đã ghi ⇒ ra khỏi index, lượt sau không quét lại).
CREATE INDEX IF NOT EXISTS obligations_overdue_idx ON contracts.obligations (tenant_id, due_date, id)
  WHERE status = 'open' AND party_key IS NOT NULL AND overdue_for IS DISTINCT FROM due_date;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS obligations_party_idx ON contracts.obligations (tenant_id, party_key, due_date)
  WHERE party_key IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS obligations_done_idx ON contracts.obligations (tenant_id, done_at DESC, id)
  WHERE status = 'done';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.partner_events (
  id bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  party_key text NOT NULL,
  role text NOT NULL,
  type text NOT NULL,
  at date NOT NULL,
  by_user uuid,
  source text NOT NULL DEFAULT 'action',
  contract_id uuid,
  obligation_id uuid,
  days_late int,
  amount bigint,
  note text,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_events_pkey PRIMARY KEY (id),
  CONSTRAINT partner_events_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT partner_events_role_ck CHECK (role IN ('customer', 'supplier')),
  CONSTRAINT partner_events_type_ck CHECK (type IN ('paid', 'received', 'postponed', 'appointment_kept',
    'appointment_missed', 'delivered', 'reminded', 'complaint', 'cks_renewed', 'cks_lapsed', 'manual_adjust', 'rating',
    'overdue')),
  CONSTRAINT partner_events_source_ck CHECK (source IN ('action', 'assistant', 'system')),
  CONSTRAINT partner_events_days_ck CHECK (days_late BETWEEN 0 AND 36500),
  CONSTRAINT partner_events_amount_ck CHECK (amount BETWEEN 0 AND 1000000000000000),
  CONSTRAINT partner_events_text_ck CHECK (char_length(party_key) BETWEEN 1 AND 300 AND char_length(note) <= 500),
  CONSTRAINT partner_events_data_ck CHECK (jsonb_typeof(data) = 'object' AND octet_length(data::text) <= 4096)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_events_party_idx ON contracts.partner_events (tenant_id, party_key, at, id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_events_obligation_idx ON contracts.partner_events (tenant_id, obligation_id)
  WHERE obligation_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.partner_event_voids (
  event_id bigint NOT NULL,
  tenant_id uuid NOT NULL,
  by_user uuid,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_event_voids_pkey PRIMARY KEY (event_id, tenant_id), -- tenant_id trong khoá: chéo tenant gặp FK, không gặp PK (không lộ id)
  CONSTRAINT partner_event_voids_event_fk FOREIGN KEY (event_id, tenant_id)
    REFERENCES contracts.partner_events (id, tenant_id) ON DELETE RESTRICT
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'obligations');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'partner_events');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'partner_event_voids');
--> statement-breakpoint
-- D7-02 · D7-03: sổ và bảng huỷ chỉ thêm; đợt không xoá (bị thay ⇒ `replaced`).
REVOKE UPDATE, DELETE ON contracts.partner_events, contracts.partner_event_voids FROM contracts_rw;
--> statement-breakpoint
REVOKE DELETE ON contracts.obligations FROM contracts_rw;
--> statement-breakpoint
-- HD7-FR-02 · `schedule.auto_schedule` (phần mặc định): HĐ vào trạng thái đã duyệt, biết bên, chưa có đợt ⇒ một đợt toàn giá trị
-- vào end/start/signed date. Không bao giờ ném lỗi (giá trị ngoài 0…10¹⁵ ⇒ đợt không tiền) — không được làm hỏng lệnh duyệt.
CREATE OR REPLACE FUNCTION contracts.hd7_default_schedule() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  side text := CASE WHEN NEW.direction = 'sale' THEN 'buyer' ELSE 'supplier' END;
  due date;
BEGIN
  IF NEW.direction IS NULL OR NEW.direction NOT IN ('sale', 'purchase') THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM contracts.obligations o
             WHERE o.tenant_id = NEW.tenant_id AND o.contract_id = NEW.id AND o.status <> 'replaced') THEN
    RETURN NULL;
  END IF;
  due := coalesce(NEW.end_date, contracts.as_date(NEW.fields -> 'start_date' ->> 'value'),
    contracts.as_date(NEW.fields -> 'signed_date' ->> 'value'));
  IF due IS NULL THEN RETURN NULL; END IF;
  INSERT INTO contracts.obligations (tenant_id, contract_id, party_key, direction, kind, seq, due_date, amount, source)
  VALUES (NEW.tenant_id, NEW.id,
    contracts.party_key(NEW.fields -> (side || '_name') ->> 'value', NEW.fields -> (side || '_tax_id') ->> 'value'),
    CASE WHEN NEW.direction = 'sale' THEN 'receive' ELSE 'pay' END, 'payment', 1, due,
    CASE WHEN NEW.value BETWEEN 0 AND 1000000000000000 THEN NEW.value END, 'default');
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.hd7_default_schedule() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.hd7_default_schedule() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contracts_hd7_schedule ON contracts.contracts;
--> statement-breakpoint
-- D7-13: "đã duyệt" = tập HD4. WHEN đánh giá trong C ⇒ lệnh đổi trạng thái giữa các mức đã duyệt (vòng nhắc HD4) không vào plpgsql.
CREATE TRIGGER contracts_hd7_schedule AFTER UPDATE OF status ON contracts.contracts
  FOR EACH ROW WHEN (NEW.kind = 'contract'
    AND NEW.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')
    AND OLD.status NOT IN ('active', 'expiring', 'expired', 'renewed', 'terminated'))
  EXECUTE FUNCTION contracts.hd7_default_schedule();
