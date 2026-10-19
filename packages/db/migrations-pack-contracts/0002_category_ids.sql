-- HD-FR-07 · HD-NFR-01 · D-22 · HD1 plan §3/§6 (Luật 4c): loại hàng gộp sẵn lên HĐ — `contracts.category_ids` (mảng loại khác
-- nhau, sắp tăng). Facets đếm bằng `unnest(category_ids)` trên lát tenant (không khử trùng 50k cặp item). Giữ đúng bằng
-- trigger MỨC CÂU LỆNH trên `contract_items` (transition tables): mỗi câu ghi item ⇒ 2 câu theo tập (khoá hàng HĐ bị chạm theo
-- thứ tự id, rồi tính lại bằng ảnh chụp mới ⇒ hai tx đồng thời trên cùng HĐ không mất cập nhật), không theo hàng. Hàm SECURITY
-- INVOKER (RLS của `contracts_rw` vẫn áp), `search_path` cố định, lọc `tenant_id` tường minh. Chỉ cộng thêm; backfill cuối file.
-- KHÔNG index GIN: đo D-22 — lọc danh sách `category_ids && $x` (planner không chọn GIN, 9,6 ms) chậm hơn semi-join
-- `items_category_idx` (2,2 ms); cột không index ⇒ cập nhật từ trigger còn đường HOT.
ALTER TABLE contracts.contracts ADD COLUMN IF NOT EXISTS category_ids uuid[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
-- Tính lại `category_ids` cho tập HĐ (id là PK toàn cục; `p_tids` là lưới tenant). Câu 1 khoá theo thứ tự id (FOR NO KEY UPDATE
-- không xung đột KEY SHARE của FK item); câu 2 chạy với ảnh chụp mới nên thấy item tx khác đã commit trong lúc chờ khoá.
CREATE OR REPLACE FUNCTION contracts.sync_category_ids(p_ids uuid[], p_tids uuid[]) RETURNS void
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM 1 FROM contracts.contracts c
    WHERE c.id = ANY (p_ids) AND c.tenant_id = ANY (p_tids) ORDER BY c.id FOR NO KEY UPDATE;
  UPDATE contracts.contracts c SET category_ids = n.ids
    FROM (SELECT k.id, ARRAY(SELECT DISTINCT i.category_id FROM contracts.contract_items i
            WHERE i.contract_id = k.id AND i.tenant_id = k.tenant_id AND i.category_id IS NOT NULL ORDER BY 1) AS ids
          FROM contracts.contracts k WHERE k.id = ANY (p_ids) AND k.tenant_id = ANY (p_tids)) n
    WHERE c.id = n.id AND c.tenant_id = ANY (p_tids) AND c.category_ids IS DISTINCT FROM n.ids;
END
$$;
--> statement-breakpoint
-- Trigger câu lệnh: gom HĐ bị chạm từ transition table (INSERT/DELETE: hàng có loại; UPDATE: hàng đổi loại/HĐ/tenant, kể cả
-- đổi id ⇒ FULL JOIN) rồi gọi `sync_category_ids` một lần. Câu không chạm loại hàng ⇒ không ghi gì lên `contracts`.
CREATE OR REPLACE FUNCTION contracts.items_category_sync() RETURNS trigger
  LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog
AS $$
DECLARE
  ids uuid[];
  tids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.contract_id), array_agg(DISTINCT n.tenant_id) INTO ids, tids
      FROM new_rows n WHERE n.category_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.contract_id), array_agg(DISTINCT o.tenant_id) INTO ids, tids
      FROM old_rows o WHERE o.category_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT v.cid) FILTER (WHERE v.cid IS NOT NULL),
           array_agg(DISTINCT v.tid) FILTER (WHERE v.tid IS NOT NULL) INTO ids, tids
      FROM new_rows n FULL JOIN old_rows o ON o.id = n.id
      CROSS JOIN LATERAL (VALUES (n.contract_id, n.tenant_id), (o.contract_id, o.tenant_id)) AS v (cid, tid)
      WHERE n.id IS NULL OR o.id IS NULL
         OR (n.category_id, n.contract_id, n.tenant_id) IS DISTINCT FROM (o.category_id, o.contract_id, o.tenant_id);
  END IF;
  IF ids IS NOT NULL THEN
    PERFORM contracts.sync_category_ids(ids, tids);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION contracts.sync_category_ids(uuid[], uuid[]), contracts.items_category_sync() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION contracts.sync_category_ids(uuid[], uuid[]), contracts.items_category_sync() TO contracts_rw;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER items_category_ins AFTER INSERT ON contracts.contract_items
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION contracts.items_category_sync();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER items_category_upd AFTER UPDATE ON contracts.contract_items
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION contracts.items_category_sync();
--> statement-breakpoint
CREATE OR REPLACE TRIGGER items_category_del AFTER DELETE ON contracts.contract_items
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION contracts.items_category_sync();
--> statement-breakpoint
-- Backfill theo tập (owner, qua RLS): một câu cho mọi HĐ đã có item mang loại.
UPDATE contracts.contracts c SET category_ids = x.ids
  FROM (SELECT i.contract_id, i.tenant_id, array_agg(DISTINCT i.category_id ORDER BY i.category_id) AS ids
        FROM contracts.contract_items i WHERE i.category_id IS NOT NULL GROUP BY i.contract_id, i.tenant_id) x
  WHERE c.id = x.contract_id AND c.tenant_id = x.tenant_id AND c.category_ids IS DISTINCT FROM x.ids;
