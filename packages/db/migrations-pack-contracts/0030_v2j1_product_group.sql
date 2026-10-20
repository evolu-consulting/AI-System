-- V2-J1 · BA v2 §2 (Hai loại điểm) · §5.2 · CD-06: (1) điền `contracts.product_group` từ danh mục SP (việc còn lại của V2-E);
-- (2) cấu hình điểm kinh doanh = thêm phạm vi `business` vào `score_configs_v2` (một hàng/tenant, vắng ⇒ mặc định trong code);
-- (3) index dòng HĐ theo SP cho câu gom điểm. Chỉ cộng thêm; chạy lại vô hại. Số 0029 dành cho lát khác.
--
-- 1) Nhóm SP của HĐ: có dòng gắn SP dịch vụ ⇒ `service`; không thì có dòng gắn SP hàng hoá ⇒ `goods`; chỉ SP Giới thiệu hoặc chưa
--    gắn SP ⇒ giữ nguyên (HĐ Giới thiệu luôn ô 5 theo `deal`). Dòng sửa/thêm ⇒ tính lại cho HĐ của dòng (một câu mỗi lệnh, bảng
--    chuyển tiếp). SECURITY INVOKER: người ghi dòng đã thấy/ghi HĐ của dòng trong cùng tx; ô của HĐ đổi ⇒ trigger V2-E chép sang mốc.
CREATE OR REPLACE FUNCTION contracts.v2j1_fill_group() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
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
REVOKE ALL ON FUNCTION contracts.v2j1_fill_group() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.v2j1_fill_group() TO contracts_rw;
--> statement-breakpoint
DROP TRIGGER IF EXISTS contract_items_v2j1_ins ON contracts.contract_items;
--> statement-breakpoint
CREATE TRIGGER contract_items_v2j1_ins AFTER INSERT ON contracts.contract_items
  REFERENCING NEW TABLE AS nw FOR EACH STATEMENT EXECUTE FUNCTION contracts.v2j1_fill_group();
--> statement-breakpoint
DROP TRIGGER IF EXISTS contract_items_v2j1_upd ON contracts.contract_items;
--> statement-breakpoint
CREATE TRIGGER contract_items_v2j1_upd AFTER UPDATE ON contracts.contract_items
  REFERENCING NEW TABLE AS nw FOR EACH STATEMENT EXECUTE FUNCTION contracts.v2j1_fill_group();
--> statement-breakpoint
-- Điền lùi cho HĐ đã có dòng gắn SP.
UPDATE contracts.contracts c SET product_group = g.grp
FROM (SELECT i.tenant_id, i.contract_id,
        CASE WHEN bool_or(p.grp = 'service') THEN 'service' WHEN bool_or(p.grp = 'goods') THEN 'goods' END AS grp
      FROM contracts.contract_items i
      JOIN contracts.products p ON p.tenant_id = i.tenant_id AND p.id = i.product_id
      GROUP BY i.tenant_id, i.contract_id) g
WHERE c.tenant_id = g.tenant_id AND c.id = g.contract_id AND g.grp IS NOT NULL AND c.product_group IS DISTINCT FROM g.grp;
--> statement-breakpoint
-- 2) Cấu hình điểm kinh doanh (CD-06).
ALTER TABLE contracts.score_configs_v2 DROP CONSTRAINT IF EXISTS score_configs_v2_scope_ck;
--> statement-breakpoint
ALTER TABLE contracts.score_configs_v2 ADD CONSTRAINT score_configs_v2_scope_ck CHECK (scope IN ('settings', 'job_types',
  'service:supplier', 'service:customer', 'goods:supplier', 'goods:customer', 'referral:commission_payer', 'business'));
--> statement-breakpoint
-- 3) Câu gom điểm đọc dòng HĐ theo SP (bán 12 tháng, HĐ theo SP).
CREATE INDEX IF NOT EXISTS contract_items_product_idx ON contracts.contract_items (tenant_id, product_id) WHERE product_id IS NOT NULL;
