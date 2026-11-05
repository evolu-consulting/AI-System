-- perf-v2g-save · Luật 4c: "Lưu" 200 dòng + 50 mốc (p95 ≤ 250 ms). Hai chỗ trigger tốn thời gian không cần thiết; hành vi quan sát được KHÔNG đổi.
--
-- 1) `obligations_v2e_cell`: trigger HÀNG gọi 50 lần (mỗi lần một SELECT qua RLS lấy ô uy tín của HĐ/giao dịch, ~30 ms/50 mốc).
--    Câu ghi mốc của "Lưu" nay tự điền `rep_cell` (từ HĐ đã có trong cùng CTE); trigger HÀNG chỉ còn điền khi người ghi KHÔNG đưa
--    `rep_cell` (NULL), và trigger CÂU (bảng chuyển tiếp) đối chiếu MỘT lần mỗi câu ⇒ giá trị cuối vẫn LUÔN = ô của HĐ/giao dịch
--    (giá trị đưa sai bị sửa lại). Đổi HĐ của mốc (UPDATE OF contract_id) giữ nguyên trigger hàng.
CREATE OR REPLACE FUNCTION contracts.v2e_obligation_cell_verify() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM nw n LEFT JOIN contracts.contracts c ON c.tenant_id = n.tenant_id AND c.id = n.contract_id
      WHERE n.contract_id IS NOT NULL AND n.rep_cell IS DISTINCT FROM c.rep_cell) THEN
    UPDATE contracts.obligations o SET rep_cell = c.rep_cell
    FROM nw n LEFT JOIN contracts.contracts c ON c.tenant_id = n.tenant_id AND c.id = n.contract_id
    WHERE n.contract_id IS NOT NULL AND o.tenant_id = n.tenant_id AND o.id = n.id AND o.rep_cell IS DISTINCT FROM c.rep_cell;
  END IF;
  IF EXISTS (SELECT 1 FROM nw WHERE contract_id IS NULL) THEN
    UPDATE contracts.obligations o SET rep_cell = x.rep_cell
    FROM nw n LEFT JOIN contracts.transactions x ON x.tenant_id = n.tenant_id AND x.id = n.transaction_id
    WHERE n.contract_id IS NULL AND o.tenant_id = n.tenant_id AND o.id = n.id AND o.rep_cell IS DISTINCT FROM x.rep_cell;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.v2e_obligation_cell_verify() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2e_obligation_cell_verify() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS obligations_v2e_cell ON contracts.obligations;
--> statement-breakpoint
DROP TRIGGER IF EXISTS obligations_v2e_cell_ins ON contracts.obligations;
--> statement-breakpoint
DROP TRIGGER IF EXISTS obligations_v2e_cell_upd ON contracts.obligations;
--> statement-breakpoint
DROP TRIGGER IF EXISTS obligations_v2e_cell_chk ON contracts.obligations;
--> statement-breakpoint
CREATE TRIGGER obligations_v2e_cell_ins BEFORE INSERT ON contracts.obligations
  FOR EACH ROW WHEN (NEW.rep_cell IS NULL) EXECUTE FUNCTION contracts.v2e_obligation_cell();
--> statement-breakpoint
CREATE TRIGGER obligations_v2e_cell_upd BEFORE UPDATE OF contract_id ON contracts.obligations
  FOR EACH ROW EXECUTE FUNCTION contracts.v2e_obligation_cell();
--> statement-breakpoint
CREATE TRIGGER obligations_v2e_cell_chk AFTER INSERT ON contracts.obligations
  REFERENCING NEW TABLE AS nw FOR EACH STATEMENT EXECUTE FUNCTION contracts.v2e_obligation_cell_verify();
--> statement-breakpoint
-- 2) `contract_items_v2j1_ins/upd` (nhóm SP của HĐ từ dòng gắn SP): chạy cả câu gom + UPDATE HĐ qua RLS cho MỌI lệnh ghi dòng, kể cả
--    khi không dòng nào mang SP (nhóm không thể đổi). Thoát sớm khi không dòng nào (mới / cũ) mang `product_id`. Bảng chuyển tiếp CŨ
--    thêm cho UPDATE để dòng bỏ SP (product_id ⇒ null) vẫn tính lại như trước.
CREATE OR REPLACE FUNCTION contracts.v2j1_fill_group() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM nw WHERE product_id IS NOT NULL) THEN RETURN NULL; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM nw WHERE product_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM od WHERE product_id IS NOT NULL) THEN RETURN NULL; END IF;
  END IF;
  UPDATE contracts.contracts c SET product_group = g.grp
  FROM (SELECT i.tenant_id, i.contract_id,
          CASE WHEN bool_or(p.grp = 'service') THEN 'service' WHEN bool_or(p.grp = 'goods') THEN 'goods' END AS grp
        FROM contracts.contract_items i
        JOIN contracts.products p ON p.tenant_id = i.tenant_id AND p.id = i.product_id
        WHERE (i.tenant_id, i.contract_id) IN (SELECT DISTINCT n.tenant_id, n.contract_id FROM nw n)
        GROUP BY i.tenant_id, i.contract_id) g
  WHERE c.tenant_id = g.tenant_id AND c.id = g.contract_id AND g.grp IS NOT NULL AND c.product_group IS DISTINCT FROM g.grp;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contract_items_v2j1_upd ON contracts.contract_items;
--> statement-breakpoint
CREATE TRIGGER contract_items_v2j1_upd AFTER UPDATE ON contracts.contract_items
  REFERENCING OLD TABLE AS od NEW TABLE AS nw FOR EACH STATEMENT EXECUTE FUNCTION contracts.v2j1_fill_group();