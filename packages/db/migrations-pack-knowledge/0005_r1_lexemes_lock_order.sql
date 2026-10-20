-- R1 · F-03 (review CR-095 đợt C): nhánh xoá của trigger df (`lexemes_sub`, 0004) cập nhật qua `UPDATE … FROM (subquery ORDER BY)`
-- — ORDER BY trong subquery join KHÔNG quyết định thứ tự UPDATE khoá hàng (hash join theo thứ tự heap) ⇒ xoá ∥ thêm/xoá cùng tenant,
-- chung lexeme deadlock (40P01, tái hiện ở tests/acceptance/R1/lexemes-lock.int.test.ts). Sửa: khoá trước bằng
-- `SELECT … ORDER BY tenant_id, lexeme FOR UPDATE` (LockRows nằm trên Sort ⇒ khoá đúng thứ tự, trùng thứ tự nhánh thêm
-- `lexemes_add`), rồi UPDATE các hàng đã giữ khoá. Vẫn 2 câu theo tập mỗi câu xoá (Luật 4c). 0004 đã áp — không sửa file cũ.
CREATE OR REPLACE FUNCTION knowledge.lexemes_sub() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM 1 FROM knowledge.lexemes l
    WHERE (l.tenant_id, l.lexeme) IN (SELECT d.tenant_id, x.lexeme
                                      FROM old_rows d, unnest(tsvector_to_array(d.tsv)) AS x(lexeme))
    ORDER BY l.tenant_id, l.lexeme FOR UPDATE;
  UPDATE knowledge.lexemes l SET df = greatest(0, l.df - o.n)
    FROM (SELECT d.tenant_id, x.lexeme, count(*)::int AS n
          FROM old_rows d, unnest(tsvector_to_array(d.tsv)) AS x(lexeme)
          GROUP BY d.tenant_id, x.lexeme) o
    WHERE l.tenant_id = o.tenant_id AND l.lexeme = o.lexeme;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION knowledge.lexemes_sub() FROM PUBLIC;
