// N4-FR-01…06 · Luật 4c: repo `knowledge` trong tx của `KnowledgeUow` (role `knowledge_rw`, RLS FORCE). SQL văn bản hằng, số câu
// cố định: thêm tài liệu = 1 câu (CTE doc + chunks từ MỘT tham số jsonb); tìm FTS = 1 câu (term qua jsonb, df/IDF tính trong câu,
// mỗi term một lần dò GIN); embedding = 1 câu/lô. Mọi câu lọc `tenant_id` tường minh ngoài RLS.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type { FtsOpts, Hit, KnowledgeRepo, KnowledgeRepos } from "../application/ports";

type HitRow = {
  chunk_id: string;
  doc_id: string;
  title: string;
  heading: string;
  clause_no: string | null;
  ord: number;
  body: string;
  score: number | string;
};
const toHit = (r: HitRow): Hit => ({
  chunkId: r.chunk_id,
  docId: r.doc_id,
  title: r.title,
  heading: r.heading,
  clauseNo: r.clause_no,
  ord: Number(r.ord),
  body: r.body,
  score: Number(r.score),
});

/**
 * BM25-lite có trần (R1, migration 0004): `knowledge.search_idf` — df tra bảng `knowledge.lexemes` (trigger giữ), rồi câu ứng
 * viên + chấm điểm chạy bằng `EXECUTE … USING` (kế hoạch với tsquery thật ⇒ dò GIN (tenant_id, tsv)). Một câu từ client; câu
 * chuẩn bị của pool chỉ bọc lời gọi hàm nên generic plan không còn ảnh hưởng.
 */
const searchIdf = (tx: Tx, _tid: string, terms: string, limit: number) =>
  tx.execute<HitRow>(sql`select chunk_id, doc_id, title, heading, clause_no, ord, body, score
    from knowledge.search_idf(${terms}::jsonb, ${limit}::int)`);

/** Đối chứng (c0): một tsquery OR mọi term, `ts_rank` mặc định — không IDF. */
const searchPlain = (tx: Tx, tid: string, terms: string, limit: number) =>
  tx.execute<HitRow>(sql`with t as (
      select phraseto_tsquery('knowledge.vi', knowledge.fold(x.term)) as tq
      from jsonb_to_recordset(${terms}::jsonb) as x(term text, w float8)),
    u as (select string_agg('(' || tq::text || ')', ' | ')::tsquery as tq from t where numnode(tq) > 0),
    m as (select c.id, ts_rank(c.tsv, u.tq) as score from knowledge.chunks c, u
      where c.tenant_id = ${tid}::uuid and c.tsv @@ u.tq order by score desc, c.id limit ${limit})
    select ch.id as chunk_id, ch.doc_id, d.title, ch.heading, ch.clause_no, ch.ord, ch.body, m.score
    from m join knowledge.chunks ch on ch.id = m.id and ch.tenant_id = ${tid}::uuid
      join knowledge.documents d on d.id = ch.doc_id and d.tenant_id = ${tid}::uuid
    order by m.score desc, m.id`);

const HIT_COLS = sql`ch.id as chunk_id, ch.doc_id, d.title, ch.heading, ch.clause_no, ch.ord, ch.body, 0 as score`;

const insertDoc =
  (tx: Tx, tid: string): KnowledgeRepo["insert"] =>
  async (doc, chunks) => {
    const rows = JSON.stringify(
      chunks.map((c) => ({
        id: c.id,
        ord: c.ord,
        heading: c.heading,
        clause_no: c.clauseNo,
        context: c.context,
        body: c.body,
      })),
    );
    await tx.execute(sql`with d as (
        insert into knowledge.documents (id, tenant_id, title, kind, source, uri, content_hash, chunk_count, created_by)
        values (${doc.id}::uuid, ${tid}::uuid, ${doc.title}, ${doc.kind}, ${doc.source}, ${doc.uri}, ${doc.contentHash},
          ${chunks.length}, ${doc.createdBy}::uuid) returning id)
      insert into knowledge.chunks (id, tenant_id, doc_id, ord, heading, clause_no, context, body)
      select x.id, ${tid}::uuid, d.id, x.ord, x.heading, x.clause_no, x.context, x.body
      from d, jsonb_to_recordset(${rows}::jsonb)
        as x(id uuid, ord int, heading text, clause_no text, context text, body text)`);
  };

const insertEmbeddings =
  (tx: Tx, tid: string): KnowledgeRepo["insertEmbeddings"] =>
  async (model, rows) => {
    if (rows.length === 0) return;
    const json = JSON.stringify(rows.map((r) => ({ chunk_id: r.chunkId, emb: r.emb })));
    await tx.execute(sql`insert into knowledge.chunk_embeddings (tenant_id, chunk_id, model, emb)
      select ${tid}::uuid, x.chunk_id, ${model}, array(select jsonb_array_elements_text(x.emb)::real)
      from jsonb_to_recordset(${json}::jsonb) as x(chunk_id uuid, emb jsonb)
      on conflict (chunk_id, model) do update set emb = excluded.emb`);
  };

const searchVector =
  (tx: Tx, tid: string): KnowledgeRepo["searchVector"] =>
  async (model, emb, limit) => {
    const q = `{${emb.join(",")}}`;
    const rows = await tx.execute<HitRow>(sql`with m as (
        select e.chunk_id as id, (select sum(a * b) from unnest(e.emb, ${q}::real[]) as u(a, b)) as score
        from knowledge.chunk_embeddings e where e.tenant_id = ${tid}::uuid and e.model = ${model}
        order by score desc nulls last, e.chunk_id limit ${limit})
      select ch.id as chunk_id, ch.doc_id, d.title, ch.heading, ch.clause_no, ch.ord, ch.body, m.score
      from m join knowledge.chunks ch on ch.id = m.id and ch.tenant_id = ${tid}::uuid
        join knowledge.documents d on d.id = ch.doc_id and d.tenant_id = ${tid}::uuid
      order by m.score desc, m.id`);
    return rows.map(toHit);
  };

export function knowledgeRepo(tx: Tx, tid: string): KnowledgeRepo {
  return {
    async findByHash(hash) {
      const [r] = await tx.execute<{ id: string; chunk_count: number }>(sql`select id, chunk_count
        from knowledge.documents where tenant_id = ${tid}::uuid and content_hash = ${hash}`);
      return r ? { id: r.id, chunkCount: Number(r.chunk_count) } : null;
    },
    insert: insertDoc(tx, tid),
    async getChunk(id) {
      const [r] = await tx.execute<HitRow>(sql`select ${HIT_COLS}
        from knowledge.chunks ch join knowledge.documents d on d.id = ch.doc_id and d.tenant_id = ${tid}::uuid
        where ch.id = ${id}::uuid and ch.tenant_id = ${tid}::uuid`);
      return r ? toHit(r) : null;
    },
    async getDocument(id) {
      const rows = await tx.execute<HitRow>(sql`select ${HIT_COLS}
        from knowledge.documents d join knowledge.chunks ch on ch.doc_id = d.id and ch.tenant_id = ${tid}::uuid
        where d.id = ${id}::uuid and d.tenant_id = ${tid}::uuid order by ch.ord`);
      const first = rows[0];
      return first ? { id: first.doc_id, title: first.title, chunks: rows.map(toHit) } : null;
    },
    async searchFts(terms, o: FtsOpts) {
      const json = JSON.stringify(terms);
      const rows = await (o.mode === "plain" ? searchPlain : searchIdf)(tx, tid, json, o.limit);
      return rows.map(toHit);
    },
    insertEmbeddings: insertEmbeddings(tx, tid),
    searchVector: searchVector(tx, tid),
  };
}

export const knowledgeRepos = (tx: Tx, tenantId: string): KnowledgeRepos => ({
  knowledge: knowledgeRepo(tx, tenantId),
});
