-- R1 · N4-NFR-01 · Luật 4c: tìm FTS ≤ 50 ms ở 10.000 đoạn/tenant. Số đo (2026-10-20, kho zipf): p95 297–377 ms; ép custom plan
-- KHÔNG đỡ (349 ms) — chi phí thật là đếm df mỗi term bằng quét `@@` từng hàng (planner không biết tsquery sinh trong câu nên bỏ
-- GIN) + dò ứng viên bằng chỉ mục tenant rồi lọc `@@`. Sửa: (1) bảng df `knowledge.lexemes` giữ bằng trigger mức câu (bảng
-- chuyển tiếp, theo tập, khoá theo thứ tự lexeme), df = tra chỉ mục; (2) `knowledge.search_idf`: pha 1 tính tsquery + IDF,
-- pha 2 `EXECUTE … USING` (kế hoạch một lần với giá trị thật ⇒ GIN (tenant_id, tsv) theo tsquery hằng), chạy SECURITY DEFINER
-- dưới role đọc `knowledge_search` (lý do RLS + leakproof ở dưới). Một câu từ client. Đo cục bộ: p95 377 → 28 ms.
-- (3) Role đăng nhập riêng `knowledge_api` (pool riêng của module, `KNOWLEDGE_DATABASE_URL`): chỉ SET ROLE được `knowledge_rw`.
-- Số migration: G1 (slice/g1-graph) giữ 0003 — xem docs/specs/R1-rag/tasks.md.
CREATE TABLE IF NOT EXISTS knowledge.lexemes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lexeme text NOT NULL,
  df integer NOT NULL,
  CONSTRAINT lexemes_pkey PRIMARY KEY (id),
  CONSTRAINT lexemes_tenant_lexeme_uq UNIQUE (tenant_id, lexeme),
  CONSTRAINT lexemes_ck CHECK (df >= 0 AND char_length(lexeme) BETWEEN 1 AND 2048)
);
--> statement-breakpoint
SELECT packs.secure_table('knowledge', 'lexemes');
--> statement-breakpoint
-- Trigger INVOKER: chạy dưới role của câu ghi (knowledge_rw + RLS ⇒ chỉ đụng hàng của tenant đang ghi). `ORDER BY` ⇒ hai lần
-- nạp song song khoá lexeme cùng thứ tự (không deadlock).
CREATE OR REPLACE FUNCTION knowledge.lexemes_add() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  INSERT INTO knowledge.lexemes AS l (tenant_id, lexeme, df)
    SELECT n.tenant_id, x.lexeme, count(*)::int
    FROM new_rows n, unnest(tsvector_to_array(n.tsv)) AS x(lexeme)
    GROUP BY n.tenant_id, x.lexeme ORDER BY n.tenant_id, x.lexeme
  ON CONFLICT (tenant_id, lexeme) DO UPDATE SET df = l.df + excluded.df;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION knowledge.lexemes_sub() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE knowledge.lexemes l SET df = greatest(0, l.df - o.n)
    FROM (SELECT d.tenant_id, x.lexeme, count(*)::int AS n
          FROM old_rows d, unnest(tsvector_to_array(d.tsv)) AS x(lexeme)
          GROUP BY d.tenant_id, x.lexeme ORDER BY d.tenant_id, x.lexeme) o
    WHERE l.tenant_id = o.tenant_id AND l.lexeme = o.lexeme;
  RETURN NULL;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS chunks_lexemes_add ON knowledge.chunks;
--> statement-breakpoint
CREATE TRIGGER chunks_lexemes_add AFTER INSERT ON knowledge.chunks
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION knowledge.lexemes_add();
--> statement-breakpoint
DROP TRIGGER IF EXISTS chunks_lexemes_sub ON knowledge.chunks;
--> statement-breakpoint
CREATE TRIGGER chunks_lexemes_sub AFTER DELETE ON knowledge.chunks
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION knowledge.lexemes_sub();
--> statement-breakpoint
-- Dựng lại df cho đoạn đã có (một câu theo tập).
INSERT INTO knowledge.lexemes AS l (tenant_id, lexeme, df)
  SELECT c.tenant_id, x.lexeme, count(*)::int
  FROM knowledge.chunks c, unnest(tsvector_to_array(c.tsv)) AS x(lexeme)
  GROUP BY c.tenant_id, x.lexeme
ON CONFLICT (tenant_id, lexeme) DO UPDATE SET df = excluded.df;
--> statement-breakpoint
-- Đo dưới RLS: `@@` (ts_match_vq) KHÔNG leakproof ⇒ dưới policy của `knowledge_rw` planner không được dùng nó làm điều kiện
-- chỉ mục ⇒ GIN (tenant_id, tsv) chỉ dò theo tenant rồi lọc `@@` từng hàng (p95 49 ms, chạm trần). Vì vậy hàm tìm chạy SECURITY
-- DEFINER dưới role riêng `knowledge_search`: NOLOGIN, NOINHERIT, NOBYPASSRLS, chỉ SELECT 3 bảng tìm (policy đọc `true` CHỈ cho
-- role này), không ai SET ROLE được. Cách ly tenant giữ bằng: (a) chỉ `knowledge_rw` được EXECUTE; (b) tenant KHÔNG nhận từ
-- tham số — chỉ đọc `app.tenant_id` của tx (do `withPackScope` đặt; vắng ⇒ 42501, đóng khi lỗi); (c) mọi câu bên trong lọc
-- `tenant_id = v_tenant`; (d) `search_path` ghim. Test: tests/acceptance/R1/search-definer.int.test.ts.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowledge_search') THEN
    CREATE ROLE knowledge_search NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER ROLE knowledge_search NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
--> statement-breakpoint
GRANT USAGE ON SCHEMA knowledge TO knowledge_search;
--> statement-breakpoint
GRANT SELECT ON knowledge.chunks, knowledge.documents, knowledge.lexemes TO knowledge_search;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION knowledge.fold(text) TO knowledge_search;
--> statement-breakpoint
DROP POLICY IF EXISTS chunks_search ON knowledge.chunks;
--> statement-breakpoint
CREATE POLICY chunks_search ON knowledge.chunks FOR SELECT TO knowledge_search USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS documents_search ON knowledge.documents;
--> statement-breakpoint
CREATE POLICY documents_search ON knowledge.documents FOR SELECT TO knowledge_search USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS lexemes_search ON knowledge.lexemes;
--> statement-breakpoint
CREATE POLICY lexemes_search ON knowledge.lexemes FOR SELECT TO knowledge_search USING (true);
--> statement-breakpoint
-- BM25-lite có trần (giữ đúng ngữ nghĩa N4): term phổ biến (df ≥ cap = max(50, N/5)) coi df = N/2; ứng viên = đoạn khớp ≥ 1
-- term không phổ biến (vắng ⇒ khớp MỌI term), tối đa `p_cand`; điểm Σ idf·w·(0,5 + ts_rank) trên mọi term khớp. df của cụm
-- nhiều lexeme = min df các lexeme (cận trên).
CREATE OR REPLACE FUNCTION knowledge.search_idf(p_terms jsonb, p_limit integer, p_cand integer DEFAULT 1000)
  RETURNS TABLE (chunk_id uuid, doc_id uuid, title text, heading text, clause_no text, ord integer, body text, score float8)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
  -- Luật 4c: kế hoạch không phụ thuộc thống kê — evotest: ước 5% đoạn ⇒ planner chọn quét tuần tự cả bảng (p95 74 ms) thay vì
  -- dò GIN (tenant_id, tsv). Tắt seqscan CHỈ trong hàm này (mọi bảng ở đây đều có chỉ mục phù hợp).
  SET enable_seqscan = off AS $$
DECLARE
  v_tenant uuid := NULLIF(current_setting('app.tenant_id', true), '')::uuid;
  v_q jsonb;
  v_any tsquery;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'knowledge.search_idf: tx chưa đặt app.tenant_id' USING ERRCODE = '42501';
  END IF;
  WITH n AS (SELECT coalesce(sum(d.chunk_count), 0)::float8 AS n FROM knowledge.documents d WHERE d.tenant_id = v_tenant),
  t AS (SELECT x.w, phraseto_tsquery('knowledge.vi', knowledge.fold(x.term)) AS tq,
          tsvector_to_array(to_tsvector('knowledge.vi', knowledge.fold(x.term))) AS lx
        FROM jsonb_to_recordset(p_terms) AS x(term text, w float8)),
  s AS (SELECT t.w, t.tq, (SELECT coalesce(min(coalesce((SELECT l.df FROM knowledge.lexemes l
          WHERE l.tenant_id = v_tenant AND l.lexeme = u.lexeme), 0)), 0) FROM unnest(t.lx) AS u(lexeme))::float8 AS df
        FROM t WHERE numnode(t.tq) > 0),
  q AS (SELECT s.tq, s.df >= greatest(50, n.n / 5) AS common,
          s.w * ln(1 + (n.n - CASE WHEN s.df >= greatest(50, n.n / 5) THEN n.n / 2 ELSE s.df END + 0.5)
            / (CASE WHEN s.df >= greatest(50, n.n / 5) THEN n.n / 2 ELSE s.df END + 0.5)) AS idf
        FROM s, n WHERE s.df > 0)
  SELECT jsonb_agg(jsonb_build_object('tq', q.tq::text, 'idf', q.idf)),
    coalesce(string_agg('(' || q.tq::text || ')', ' | ') FILTER (WHERE NOT q.common),
      string_agg('(' || q.tq::text || ')', ' & '))::tsquery
  INTO v_q, v_any FROM q;
  IF v_any IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $q$
    WITH q AS MATERIALIZED (SELECT (e->>'tq')::tsquery AS tq, (e->>'idf')::float8 AS idf FROM jsonb_array_elements($2) e),
    cand AS MATERIALIZED (SELECT c.id, c.tsv || ''::tsvector AS tsv FROM knowledge.chunks c
      WHERE c.tenant_id = $1 AND c.tsv @@ $3 LIMIT $4),
    m AS (SELECT cand.id, s.score FROM cand, LATERAL (SELECT sum(q.idf * (0.5 + ts_rank('{0.1,0.3,0.4,1.0}', cand.tsv, q.tq)))
        AS score FROM q WHERE cand.tsv @@ q.tq) s ORDER BY s.score DESC, cand.id LIMIT $5)
    SELECT ch.id, ch.doc_id, d.title, ch.heading, ch.clause_no, ch.ord, ch.body, m.score::float8
    FROM m JOIN knowledge.chunks ch ON ch.id = m.id AND ch.tenant_id = $1
      JOIN knowledge.documents d ON d.id = ch.doc_id AND d.tenant_id = $1
    ORDER BY m.score DESC, m.id$q$
  USING v_tenant, v_q, v_any, least(greatest(p_cand, 1), 1000), least(greatest(p_limit, 1), 100);
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION knowledge.search_idf(jsonb, integer, integer) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION knowledge.search_idf(jsonb, integer, integer) TO knowledge_rw;
--> statement-breakpoint
ALTER FUNCTION knowledge.search_idf(jsonb, integer, integer) OWNER TO knowledge_search;
--> statement-breakpoint
REVOKE ALL ON FUNCTION knowledge.lexemes_add() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION knowledge.lexemes_sub() FROM PUBLIC;
--> statement-breakpoint
-- Role đăng nhập của pool tri thức. Dev/test: `migrations-hub-dev/0001` tạo sẵn kèm mật khẩu dev; production: vận hành
-- `ALTER ROLE knowledge_api WITH LOGIN PASSWORD '…'`. Không GRANT gì ngoài SET ROLE `knowledge_rw` (schema `knowledge`).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'knowledge_api') THEN
    CREATE ROLE knowledge_api NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER ROLE knowledge_api NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
--> statement-breakpoint
GRANT knowledge_rw TO knowledge_api WITH INHERIT FALSE, SET TRUE;
