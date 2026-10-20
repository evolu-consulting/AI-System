-- V2-B · BA v2 §2 (Nhóm sản phẩm, Nguồn hàng và giá vốn) · §5.3 · §5.5 · §5.7 · intake C4: danh mục SP + thành phần + quy tắc nhận
-- diện + lô kho + sổ nhập/xuất + giá vốn bình quân gia quyền theo THÀNH PHẦN. Chỉ cộng thêm; chạy lại vô hại. Số 0022 dành cho V2-A.
-- Tiền = bigint đồng (chưa VAT); số lượng = numeric(18,4). Ghi kho chỉ qua `applyDelivery` (adapters/stock.repo.ts): khoá thành phần
-- `FOR UPDATE` theo id ⇒ đọc lô mở ⇒ một CTE ghi lô + sổ ⇒ cập nhật tồn/BQ (trigger đối chiếu với dòng sổ vừa ghi).
-- Thấy (M1, docs/specs/V2-B/tasks.md D2): danh mục + tồn + lô (chỉ số lượng/hạn) thấy cả tenant (form HĐ cần tồn, BA 5.7e);
-- sổ nhập/xuất (giá lô, NCC, HĐ) theo luật thấy HĐ như `cks_lots` (sees_all · mình ghi · HĐ thấy được).
-- Không FK tới `contracts.contracts` (như `cks_lots`): TRUNCATE HĐ của các bộ test cũ không vướng; HĐ phải thấy được khi ghi (policy
-- `stock_moves_visible_ins`, CTE tạo SP); xoá HĐ xử lý ở V2-M.
CREATE TABLE IF NOT EXISTS contracts.products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  name_key text GENERATED ALWAYS AS (contracts.fold(name)) STORED,
  unit text,
  grp text NOT NULL,
  main_supplier_party_key text,
  main_supplier_name text,
  created_from_contract_id uuid,
  created_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_pkey PRIMARY KEY (id),
  CONSTRAINT products_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT products_name_uq UNIQUE (tenant_id, name_key),
  CONSTRAINT products_grp_ck CHECK (grp IN ('service', 'goods', 'referral')),
  CONSTRAINT products_text_ck CHECK (char_length(name) BETWEEN 1 AND 300 AND char_length(unit) <= 40
    AND char_length(main_supplier_party_key) BETWEEN 1 AND 300 AND char_length(main_supplier_name) <= 300)
);
--> statement-breakpoint
-- Thành phần: SP một phần có đúng 1 thành phần cùng tên. `mode`: stock (kho lô) · quota (gói suất có hạn) · order (không giữ hàng,
-- giá vốn theo từng đơn) · none (Giới thiệu). Tồn/giá trị/BQ là trạng thái gộp của sổ (`stock_moves`), chỉ đổi kèm một dòng sổ.
CREATE TABLE IF NOT EXISTS contracts.product_components (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  ord smallint NOT NULL DEFAULT 0,
  name text NOT NULL,
  unit text,
  mode text NOT NULL,
  on_hand numeric(18, 4) NOT NULL DEFAULT 0,
  stock_value bigint NOT NULL DEFAULT 0,
  avg_cost bigint NOT NULL DEFAULT 0,
  last_move_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_components_pkey PRIMARY KEY (id),
  CONSTRAINT product_components_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT product_components_ord_uq UNIQUE (product_id, tenant_id, ord),
  CONSTRAINT product_components_mode_ck CHECK (mode IN ('stock', 'quota', 'order', 'none')),
  CONSTRAINT product_components_qty_ck CHECK (on_hand >= 0 AND stock_value >= 0 AND avg_cost >= 0
    AND (on_hand > 0 OR stock_value = 0) AND (mode IN ('stock', 'quota') OR (on_hand = 0 AND stock_value = 0))),
  CONSTRAINT product_components_text_ck CHECK (char_length(name) BETWEEN 1 AND 300 AND char_length(unit) <= 40
    AND ord BETWEEN 0 AND 20),
  CONSTRAINT product_components_product_fk FOREIGN KEY (product_id, tenant_id)
    REFERENCES contracts.products (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
-- Quy tắc nhận diện (BA 5.5b): từ khoá trong tên dòng ⇒ SP (và thành phần nếu có).
CREATE TABLE IF NOT EXISTS contracts.product_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  product_id uuid NOT NULL,
  component_id uuid,
  pattern text NOT NULL,
  pattern_key text GENERATED ALWAYS AS (contracts.fold(pattern)) STORED,
  created_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_rules_pkey PRIMARY KEY (id),
  CONSTRAINT product_rules_uq UNIQUE (tenant_id, product_id, pattern_key),
  CONSTRAINT product_rules_text_ck CHECK (char_length(pattern) BETWEEN 2 AND 100),
  CONSTRAINT product_rules_product_fk FOREIGN KEY (product_id, tenant_id)
    REFERENCES contracts.products (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT product_rules_component_fk FOREIGN KEY (component_id, tenant_id)
    REFERENCES contracts.product_components (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS product_rules_product_idx ON contracts.product_rules (tenant_id, product_id);
--> statement-breakpoint
-- Lô: mỗi lần nhập một lô (BA §2). Chỉ số lượng + hạn (gói quota: hạn = ngày kết thúc HĐ mua); giá/NCC/HĐ nằm ở dòng sổ nhập.
CREATE TABLE IF NOT EXISTS contracts.stock_lots (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  component_id uuid NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  qty numeric(18, 4) NOT NULL,
  remaining numeric(18, 4) NOT NULL,
  received_on date NOT NULL,
  expires_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_lots_pkey PRIMARY KEY (id),
  CONSTRAINT stock_lots_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT stock_lots_qty_ck CHECK (qty > 0 AND remaining >= 0 AND remaining <= qty),
  CONSTRAINT stock_lots_component_fk FOREIGN KEY (component_id, tenant_id)
    REFERENCES contracts.product_components (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_lots_open_idx ON contracts.stock_lots (tenant_id, component_id) WHERE remaining > 0;
--> statement-breakpoint
-- Sổ nhập/xuất, chỉ thêm. `reason`: delivery (mốc giao) · expire (suất gói hết hạn) · reversal (V2-M xoá HĐ). Dòng thành phần
-- `order` không đổi tồn (before/after null). `reverses` trỏ dòng bị đảo.
CREATE TABLE IF NOT EXISTS contracts.stock_moves (
  id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  component_id uuid NOT NULL,
  lot_id uuid,
  direction text NOT NULL,
  reason text NOT NULL DEFAULT 'delivery',
  qty numeric(18, 4) NOT NULL,
  unit_cost bigint NOT NULL,
  amount bigint NOT NULL,
  on_hand_before numeric(18, 4),
  on_hand_after numeric(18, 4),
  value_before bigint,
  value_after bigint,
  avg_before bigint,
  avg_after bigint,
  moved_on date NOT NULL,
  contract_id uuid,
  milestone_id uuid,
  contract_item_id uuid,
  supplier_party_key text,
  reverses uuid,
  created_by uuid DEFAULT NULLIF(current_setting('app.user_id', true), '')::uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_moves_pkey PRIMARY KEY (id),
  CONSTRAINT stock_moves_id_tenant_uq UNIQUE (id, tenant_id),
  CONSTRAINT stock_moves_dir_ck CHECK (direction IN ('in', 'out')),
  CONSTRAINT stock_moves_reason_ck CHECK (reason IN ('delivery', 'expire', 'reversal')),
  CONSTRAINT stock_moves_num_ck CHECK (qty > 0 AND unit_cost BETWEEN 0 AND 1000000000000000
    AND amount BETWEEN 0 AND 1000000000000000 AND on_hand_after >= 0 AND value_after >= 0),
  CONSTRAINT stock_moves_text_ck CHECK (char_length(supplier_party_key) BETWEEN 1 AND 300),
  CONSTRAINT stock_moves_component_fk FOREIGN KEY (component_id, tenant_id)
    REFERENCES contracts.product_components (id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT stock_moves_lot_fk FOREIGN KEY (lot_id, tenant_id)
    REFERENCES contracts.stock_lots (id, tenant_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_moves_component_idx ON contracts.stock_moves (tenant_id, component_id, seq);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stock_moves_contract_idx ON contracts.stock_moves (tenant_id, contract_id) WHERE contract_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE contracts.product_components DROP CONSTRAINT IF EXISTS product_components_last_move_fk;
--> statement-breakpoint
ALTER TABLE contracts.product_components ADD CONSTRAINT product_components_last_move_fk FOREIGN KEY (last_move_id, tenant_id)
  REFERENCES contracts.stock_moves (id, tenant_id);
--> statement-breakpoint
-- BA 5.5a/5.5f: dòng HĐ gắn SP + các thành phần đã chọn (đặt ở V2-F/V2-G; V2-D đọc để sinh dòng nhập/xuất).
ALTER TABLE contracts.contract_items ADD COLUMN IF NOT EXISTS product_id uuid;
--> statement-breakpoint
ALTER TABLE contracts.contract_items ADD COLUMN IF NOT EXISTS component_ids uuid[];
--> statement-breakpoint
ALTER TABLE contracts.contract_items DROP CONSTRAINT IF EXISTS contract_items_product_fk;
--> statement-breakpoint
ALTER TABLE contracts.contract_items ADD CONSTRAINT contract_items_product_fk FOREIGN KEY (product_id, tenant_id)
  REFERENCES contracts.products (id, tenant_id);
--> statement-breakpoint
ALTER TABLE contracts.contract_items DROP CONSTRAINT IF EXISTS contract_items_components_ck;
--> statement-breakpoint
ALTER TABLE contracts.contract_items ADD CONSTRAINT contract_items_components_ck
  CHECK (component_ids IS NULL OR (product_id IS NOT NULL AND cardinality(component_ids) BETWEEN 1 AND 20));
--> statement-breakpoint
-- Tồn/giá trị/BQ chỉ đổi khi `last_move_id` trỏ một dòng sổ MỚI (ghi trong chính tx này) có số "sau" khớp — không sửa tay được.
-- INVOKER: dòng vừa ghi do chính phiên tạo (`created_by` = mình hoặc việc nền) nên thấy được dưới RLS M1.
CREATE OR REPLACE FUNCTION contracts.product_components_guard() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.on_hand IS NOT DISTINCT FROM OLD.on_hand AND NEW.stock_value IS NOT DISTINCT FROM OLD.stock_value
     AND NEW.avg_cost IS NOT DISTINCT FROM OLD.avg_cost AND NEW.last_move_id IS NOT DISTINCT FROM OLD.last_move_id THEN
    RETURN NEW;
  END IF;
  IF NEW.last_move_id IS NULL OR NEW.last_move_id IS NOT DISTINCT FROM OLD.last_move_id OR NOT EXISTS (
       SELECT 1 FROM contracts.stock_moves m
       WHERE m.id = NEW.last_move_id AND m.tenant_id = NEW.tenant_id AND m.component_id = NEW.id
         AND m.created_at = now() AND m.on_hand_after = NEW.on_hand AND m.value_after = NEW.stock_value
         AND m.avg_after = NEW.avg_cost) THEN
    RAISE EXCEPTION 'stock: tồn/giá vốn chỉ đổi kèm dòng sổ khớp' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS product_components_guard ON contracts.product_components;
--> statement-breakpoint
CREATE TRIGGER product_components_guard BEFORE UPDATE ON contracts.product_components
  FOR EACH ROW EXECUTE FUNCTION contracts.product_components_guard();
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'products');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'product_components');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'product_rules');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'stock_lots');
--> statement-breakpoint
SELECT packs.secure_table('contracts', 'stock_moves');
--> statement-breakpoint
-- BA 6c: không sửa SP/thành phần sau khi tạo; xoá SP chỉ qua V2-M. Quy tắc nhận diện: thêm/xoá. Sổ chỉ thêm. Lô: chỉ `remaining`.
REVOKE UPDATE, DELETE ON contracts.products FROM contracts_rw;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.product_components FROM contracts_rw;
--> statement-breakpoint
GRANT UPDATE (on_hand, stock_value, avg_cost, last_move_id, updated_at) ON contracts.product_components TO contracts_rw;
--> statement-breakpoint
REVOKE UPDATE ON contracts.product_rules FROM contracts_rw;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.stock_lots FROM contracts_rw;
--> statement-breakpoint
GRANT UPDATE (remaining) ON contracts.stock_lots TO contracts_rw;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON contracts.stock_moves FROM contracts_rw;
--> statement-breakpoint
DROP POLICY IF EXISTS stock_moves_visible ON contracts.stock_moves;
--> statement-breakpoint
CREATE POLICY stock_moves_visible ON contracts.stock_moves AS RESTRICTIVE FOR SELECT TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid
    OR EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.id = stock_moves.contract_id AND c.tenant_id = stock_moves.tenant_id));
--> statement-breakpoint
-- Ghi sổ cho HĐ mình không thấy ⇒ từ chối (RLS của HĐ áp trong EXISTS); `created_by` phải là chính phiên.
DROP POLICY IF EXISTS stock_moves_visible_ins ON contracts.stock_moves;
--> statement-breakpoint
CREATE POLICY stock_moves_visible_ins ON contracts.stock_moves AS RESTRICTIVE FOR INSERT TO contracts_rw
  WITH CHECK (created_by IS NOT DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (contract_id IS NULL OR EXISTS (SELECT 1 FROM contracts.contracts c
      WHERE c.id = stock_moves.contract_id AND c.tenant_id = stock_moves.tenant_id)));
--> statement-breakpoint
DROP POLICY IF EXISTS product_rules_visible_del ON contracts.product_rules;
--> statement-breakpoint
CREATE POLICY product_rules_visible_del ON contracts.product_rules AS RESTRICTIVE FOR DELETE TO contracts_rw
  USING ((SELECT contracts.sees_all())
    OR created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);
