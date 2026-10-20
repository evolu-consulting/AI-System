-- V2-K · BA v2 §3.4 TQ-01/TQ-02 · §4.1 · §5.4 · §5.9: Tổng quan (doanh thu / hoa hồng theo mốc, lãi gộp, hàng đang giữ) + Cần xử lý
-- 8 nguồn (Bỏ qua / Đã xong). Chỉ cộng thêm; chạy lại vô hại. 0029 = V2-H, 0030 = V2-J1, 0031/0032 dành cho lát khác.
--
-- 1) Bỏ qua / Đã xong một việc của Cần xử lý: việc SUY từ dữ liệu (mốc, HĐ, khách, …) nên không có hàng để đóng ⇒ ghi khoá việc
--    `<loại>:<uuid>:<ngày>` của RIÊNG người bấm (ngày trong khoá: hạn đổi ⇒ việc hiện lại). Chỉ ẩn trong danh sách của người đó; không
--    đổi dữ liệu nghiệp vụ. Mỗi người chỉ thấy/ghi hàng của mình (RLS RESTRICTIVE theo `app.user_id`).
CREATE TABLE IF NOT EXISTS contracts.todo_dismissals (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  item_key text NOT NULL,
  action text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT todo_dismissals_pkey PRIMARY KEY (tenant_id, user_id, item_key),
  CONSTRAINT todo_dismissals_action_ck CHECK (action IN ('skip', 'done')),
  CONSTRAINT todo_dismissals_key_ck CHECK (item_key ~
    '^[a-z_]{1,24}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9]{4}-[0-9]{2}-[0-9]{2}$')
);
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'todo_dismissals');
--> statement-breakpoint
REVOKE DELETE ON contracts.todo_dismissals FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS todo_dismissals_mine ON contracts.todo_dismissals;
--> statement-breakpoint
CREATE POLICY todo_dismissals_mine ON contracts.todo_dismissals AS RESTRICTIVE FOR ALL TO contracts_rw
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
-- 2) Luật 4c · Tổng quan: mốc tiền (Thu tiền / Nhận hoa hồng) theo HẠN, gồm cả mốc đã xác nhận (doanh thu dự kiến tính mốc đến hạn
--    trong kỳ dù đã thu) — cột gom đi kèm (không đọc heap). Thực nhận theo ngày xác nhận dùng `obligations_done_idx` (0008).
CREATE INDEX IF NOT EXISTS obligations_money_due_idx ON contracts.obligations (tenant_id, due_date)
  INCLUDE (contract_id, kind, direction, amount, status, done_at, seq)
  WHERE kind IN ('payment', 'commission') AND status IN ('open', 'done');
--> statement-breakpoint
-- 3) Cần xử lý · HĐ sắp hết hạn (theo ngày kết thúc + số ngày nhắc của HĐ).
CREATE INDEX IF NOT EXISTS contracts_end_idx ON contracts.contracts (tenant_id, end_date)
  WHERE kind = 'contract' AND end_date IS NOT NULL;
