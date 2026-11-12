-- CR-127 · P1 · BR-60…65 · spec §2.4: liên kết HĐ của MỖI bên với phiên ký chung ở hub (`hub.partner_sign_sessions`, MIGH 0132).
-- Một dòng mỗi (tenant, phiên): bên gửi ghi khi đề xuất (`side='from'`), bên nhận ghi khi đồng ý (`side='to'`). Bộ chuyển hộp thư báo gói
-- theo `session_id` ⇒ gói tra HĐ của tenant mình ở bảng này (RLS gói theo tenant, `packs.secure_table`). Không id của bên kia.
-- Role gói gọi được các hàm `hub.sign_session_*` (hub 0132 bỏ qua khi role gói chưa có). Chỉ cộng thêm; chạy lại vô hại.
CREATE TABLE IF NOT EXISTS contracts.sign_session_refs (
  tenant_id uuid NOT NULL,
  contract_id uuid NOT NULL,
  session_id uuid NOT NULL,
  side text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sign_session_refs_pkey PRIMARY KEY (tenant_id, session_id),
  CONSTRAINT sign_session_refs_side_ck CHECK (side IN ('from', 'to')),
  CONSTRAINT sign_session_refs_contract_fk FOREIGN KEY (contract_id) REFERENCES contracts.contracts (id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sign_session_refs_contract_idx ON contracts.sign_session_refs (tenant_id, contract_id, created_at DESC);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'sign_session_refs');
--> statement-breakpoint
REVOKE UPDATE ON contracts.sign_session_refs FROM contracts_rw;
--> statement-breakpoint
GRANT USAGE ON SCHEMA hub TO contracts_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION hub.sign_session_propose(uuid, text, integer, integer, text), hub.sign_session_accept(uuid, text),
  hub.sign_session_fallback(uuid), hub.sign_session_mark_signed(uuid, text, text), hub.sign_session_decline(uuid, text),
  hub.sign_session_cancel(uuid, text), hub.sign_session_resolve(uuid, text), hub.sign_session_mine(uuid), hub.sign_session_by_mailbox(uuid[]) TO contracts_rw;
