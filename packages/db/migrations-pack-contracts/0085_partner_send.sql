-- CR-124 · q3 · FLOW4-FR-01/02/07/11/17 · spec §3, §7, §8c · gói Hợp đồng ⇄ hộp thư liên công ty (hub 0117–0119). Chỉ cộng thêm; chạy lại vô hại.
-- (1) `contracts.partner_sends` — bên GỬI (A): một dòng mỗi lần gửi {HĐ, mailbox_id, vòng, kênh, trạng thái}. Tối đa MỘT dòng 'open' mỗi HĐ
--     ⇒ tool gửi chạy lại (engine retry) trả lần gửi đang mở, không gửi đôi (Luật 4c: số câu cố định). Không lưu id/nội dung của bên nhận.
-- (2) `contracts.partner_inbox` — bên NHẬN (B): bản ghi riêng của HĐ đối tác gửi tới (HĐ nhận: `contracts.contracts.source = 'partner_inbox'`);
--     chỉ BẢN CHIA SẺ (tên/MST công khai bên gửi, trường A chọn, lời nhắn, mức, lý do lần trước). KHÔNG id/tenant của A, KHÔNG lịch sử duyệt của A.
--     `file_ref` = tham chiếu tệp ở nơi gửi, chờ chép sang FileBox của B (q4/q5) — không dùng làm đường đọc chéo.
-- (3) cả hai: RLS theo tenant (`packs.secure_table`), role gói không xoá. HĐ nhận: nới `contracts_deal_source_ck` thêm 'partner_inbox'.
-- (4) cấp lại EXECUTE cho `contracts_rw` trên các hàm hub (hub 0117–0119 bỏ qua khi role chưa có lúc chạy).
ALTER TABLE contracts.contracts DROP CONSTRAINT IF EXISTS contracts_deal_source_ck;
--> statement-breakpoint
ALTER TABLE contracts.contracts ADD CONSTRAINT contracts_deal_source_ck CHECK (
  (source IS NULL OR source IN ('invoice', 'verbal', 'message', 'quote', 'other', 'partner_inbox'))
  AND (doc_type <> 'deal' OR (source IS NOT NULL AND deal IS NOT NULL AND kind = 'contract'))) NOT VALID;
--> statement-breakpoint
ALTER TABLE contracts.contracts VALIDATE CONSTRAINT contracts_deal_source_ck;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.partner_sends (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  round integer NOT NULL DEFAULT 1,
  channel text NOT NULL,
  to_key text NOT NULL,
  to_name text,
  status text NOT NULL DEFAULT 'open',
  reason text,
  process_run_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  CONSTRAINT partner_sends_pkey PRIMARY KEY (id),
  CONSTRAINT partner_sends_mailbox_uq UNIQUE (tenant_id, mailbox_id),
  CONSTRAINT partner_sends_channel_ck CHECK (channel IN ('platform', 'email', 'manual')),
  CONSTRAINT partner_sends_status_ck CHECK (status IN ('open', 'confirmed', 'returned', 'declined', 'expired', 'closed')),
  CONSTRAINT partner_sends_round_ck CHECK (round BETWEEN 1 AND 1000),
  CONSTRAINT partner_sends_reason_ck CHECK (reason IS NULL OR char_length(reason) <= 2000),
  CONSTRAINT partner_sends_name_ck CHECK (to_name IS NULL OR char_length(to_name) <= 300)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS partner_sends_open_uq ON contracts.partner_sends (tenant_id, contract_id) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_sends_contract_idx ON contracts.partner_sends (tenant_id, contract_id, round DESC);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'partner_sends');
--> statement-breakpoint
REVOKE DELETE ON contracts.partner_sends FROM contracts_rw;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS contracts.partner_inbox (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  mailbox_id uuid NOT NULL,
  sender_name text NOT NULL,
  sender_tax_code text,
  sender_verified boolean NOT NULL DEFAULT false,
  round integer NOT NULL DEFAULT 1,
  prev_reason text,
  importance text NOT NULL DEFAULT 'normal',
  message text,
  shared jsonb NOT NULL DEFAULT '{}'::jsonb,
  file_ref text,
  pdf_sha256 text,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  replied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_inbox_pkey PRIMARY KEY (id),
  CONSTRAINT partner_inbox_mailbox_uq UNIQUE (tenant_id, mailbox_id),
  CONSTRAINT partner_inbox_contract_uq UNIQUE (tenant_id, contract_id),
  CONSTRAINT partner_inbox_contract_fk FOREIGN KEY (contract_id, tenant_id)
    REFERENCES contracts.contracts (id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT partner_inbox_importance_ck CHECK (importance IN ('normal', 'important', 'critical')),
  CONSTRAINT partner_inbox_status_ck CHECK (status IN ('pending', 'confirmed', 'returned', 'declined')),
  CONSTRAINT partner_inbox_round_ck CHECK (round BETWEEN 1 AND 1000),
  CONSTRAINT partner_inbox_shared_ck CHECK (jsonb_typeof(shared) = 'object' AND pg_column_size(shared) <= 65536),
  CONSTRAINT partner_inbox_text_ck CHECK (char_length(sender_name) BETWEEN 1 AND 300
    AND (message IS NULL OR char_length(message) <= 1000) AND (reason IS NULL OR char_length(reason) <= 2000)
    AND (prev_reason IS NULL OR char_length(prev_reason) <= 2000))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS partner_inbox_list_idx ON contracts.partner_inbox (tenant_id, created_at DESC);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'partner_inbox');
--> statement-breakpoint
REVOKE DELETE ON contracts.partner_inbox FROM contracts_rw;
--> statement-breakpoint
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION
  hub.partner_send(uuid, uuid, text, text, text, jsonb, text, text, timestamptz, uuid),
  hub.partner_reply(uuid, text, text, text, jsonb),
  hub.partner_mailbox_mine(integer),
  hub.partner_link_request(uuid), hub.partner_link_accept(uuid), hub.partner_link_block(uuid), hub.partner_links_mine(),
  hub.partner_self(), hub.partner_route(text), hub.partner_inbox_take(integer)
  TO contracts_rw;
