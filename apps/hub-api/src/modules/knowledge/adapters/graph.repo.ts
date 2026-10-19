// G1 · CR-095 · Luật 4c: đồ thị tri thức trên bảng `knowledge.*` trong tx `knowledge_rw` (RLS FORCE) — thay các câu Cypher của
// mgmt-app `app/store/graph.py`. SQL văn bản hằng, danh sách qua MỘT tham số jsonb, mỗi hàm số câu cố định; mọi câu lọc
// `tenant_id` tường minh ngoài RLS để đi đúng index (tenant_id, …) hai chiều của bảng cạnh.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import type {
  ConflictRow,
  CorpusRow,
  GraphRepo,
  GraphRepos,
  LinkKind,
  NbRow,
} from "../application/graph.ports";
import { graphStats, nbSql } from "./graph.sql";

const json = (v: unknown): string => JSON.stringify(v);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

type SimRow = {
  doc_id: string;
  title: string;
  uri: string | null;
  type: LinkKind;
  score: number | null;
  reason: string | null;
  chunk_id: string;
  other_chunk_id: string;
};
type ConfRow = {
  type: LinkKind;
  a_id: string;
  a_title: string;
  a_uri: string | null;
  b_id: string;
  b_title: string;
  b_uri: string | null;
  score: number | null;
  reason: string | null;
};

export function graphRepo(tx: Tx, tid: string): GraphRepo {
  return {
    async attach(docId, chunks) {
      const ents = chunks.flatMap((c) => c.entities.map((e) => ({ chunk_id: c.chunkId, ...e })));
      const rels = chunks.flatMap((c) => c.relations.map((r) => ({ chunk_id: c.chunkId, ...r })));
      // MENTIONS cũ của tài liệu (upsert_document xoá đoạn cũ ⇒ cạnh cũ đi theo)
      await tx.execute(sql`delete from knowledge.chunk_entities ce using knowledge.chunks c
        where ce.tenant_id = ${tid}::uuid and c.tenant_id = ${tid}::uuid and c.doc_id = ${docId}::uuid
          and ce.chunk_id = c.id`);
      await tx.execute(sql`with x as materialized (select * from jsonb_to_recordset(${json(ents)}::jsonb)
          as x(chunk_id uuid, key text, name text, type text)),
        r as materialized (select * from jsonb_to_recordset(${json(rels)}::jsonb)
          as r(chunk_id uuid, src text, dst text, type text)),
        ch as materialized (select c.id from knowledge.chunks c
          where c.tenant_id = ${tid}::uuid and c.doc_id = ${docId}::uuid),
        up as (insert into knowledge.entities (tenant_id, key, name, type)
          select distinct on (x.key) ${tid}::uuid, x.key, x.name, x.type from x
          where exists (select 1 from ch) order by x.key
          on conflict (tenant_id, key) do update set key = excluded.key
          returning id, key),
        m as (insert into knowledge.chunk_entities (tenant_id, chunk_id, entity_id)
          select distinct ${tid}::uuid, x.chunk_id, up.id from x join up on up.key = x.key
          where x.chunk_id in (select id from ch)
          on conflict do nothing),
        ek as (select id, key from up
          union select e.id, e.key from knowledge.entities e
          where e.tenant_id = ${tid}::uuid and e.key = any(array(select src from r union select dst from r)))
        insert into knowledge.entity_rels (tenant_id, src_id, dst_id, type, evidence_chunk_id)
        select distinct on (a.id, r.type, b.id) ${tid}::uuid, a.id, b.id, r.type,
          case when r.chunk_id in (select id from ch) then r.chunk_id end
        from r join ek a on a.key = r.src join ek b on b.key = r.dst
        where exists (select 1 from ch)
        order by a.id, r.type, b.id
        on conflict (tenant_id, src_id, type, dst_id) do update set evidence_chunk_id = excluded.evidence_chunk_id`);
    },

    async linkDocuments(docId, uris) {
      const rows = await tx.execute<{ n: number }>(sql`with ins as (
          insert into knowledge.document_links (tenant_id, src_id, dst_id)
          select ${tid}::uuid, ${docId}::uuid, b.id from knowledge.documents b
          where b.tenant_id = ${tid}::uuid and b.id <> ${docId}::uuid
            and b.uri = any(array(select jsonb_array_elements_text(${json(uris)}::jsonb)))
            and exists (select 1 from knowledge.documents a where a.tenant_id = ${tid}::uuid and a.id = ${docId}::uuid)
          on conflict do nothing returning 1)
        select count(*)::int as n from ins`);
      return Number(rows[0]?.n ?? 0);
    },

    async expand(keys, exclude, limit) {
      const rows = await tx.execute<{ id: string }>(sql`with e as materialized (
          select id from knowledge.entities where tenant_id = ${tid}::uuid
            and key = any(array(select jsonb_array_elements_text(${json(keys)}::jsonb)))),
        ea as materialized (select id from e
          union select al.b_id from knowledge.entity_aliases al join e on al.a_id = e.id where al.tenant_id = ${tid}::uuid
          union select al.a_id from knowledge.entity_aliases al join e on al.b_id = e.id where al.tenant_id = ${tid}::uuid)
        select distinct ce.chunk_id::text as id from knowledge.chunk_entities ce join ea on ce.entity_id = ea.id
        where ce.tenant_id = ${tid}::uuid
          and ce.chunk_id <> all(array(select jsonb_array_elements_text(${json(exclude)}::jsonb)::uuid))
        limit ${limit}`);
      return rows.map((r) => r.id);
    },

    async hasAlias(a, b) {
      const rows = await tx.execute<{ ok: boolean }>(sql`select exists (select 1
          from knowledge.entities x join knowledge.entities y on y.tenant_id = ${tid}::uuid and y.key = ${b}
          join knowledge.entity_aliases al on al.tenant_id = ${tid}::uuid
            and al.a_id = least(x.id, y.id) and al.b_id = greatest(x.id, y.id)
          where x.tenant_id = ${tid}::uuid and x.key = ${a}) as ok`);
      return rows[0]?.ok === true;
    },

    async addAlias(a, b) {
      const rows = await tx.execute(sql`insert into knowledge.entity_aliases (tenant_id, a_id, b_id)
        select ${tid}::uuid, least(x.id, y.id), greatest(x.id, y.id)
        from knowledge.entities x join knowledge.entities y on y.tenant_id = ${tid}::uuid and y.key = ${b}
        where x.tenant_id = ${tid}::uuid and x.key = ${a} and x.id <> y.id
        on conflict do nothing returning 1`);
      return rows.length > 0;
    },

    async addLinks(links) {
      if (links.length === 0) return 0;
      const rows = links.map((l) => ({
        a: l.a,
        b: l.b,
        kind: l.kind,
        score: l.score ?? null,
        reason: l.reason ?? null,
      }));
      const out = await tx.execute<{ n: number }>(sql`with r as (
          select distinct on (a, b, kind) a, b, kind, score, reason
          from (select (e.v ->> 'a')::uuid as a, (e.v ->> 'b')::uuid as b, e.v ->> 'kind' as kind,
              (e.v ->> 'score')::real as score, e.v ->> 'reason' as reason, e.i
            from jsonb_array_elements(${json(rows)}::jsonb) with ordinality as e(v, i)) z
          order by a, b, kind, i),
        ins as (insert into knowledge.chunk_links
            (tenant_id, src_id, dst_id, kind, score, reason, src_doc_id, dst_doc_id)
          select ${tid}::uuid, x.id, y.id, r.kind, r.score, r.reason, x.doc_id, y.doc_id
          from r join knowledge.chunks x on x.tenant_id = ${tid}::uuid and x.id = r.a
            join knowledge.chunks y on y.tenant_id = ${tid}::uuid and y.id = r.b
          where x.id <> y.id
          on conflict (tenant_id, src_id, dst_id, kind) do update
            set score = coalesce(excluded.score, chunk_links.score),
                reason = coalesce(excluded.reason, chunk_links.reason)
          returning 1)
        select count(*)::int as n from ins`);
      return Number(out[0]?.n ?? 0);
    },

    async similarDocuments(docId, limit) {
      const rows = await tx.execute<SimRow>(sql`with l as (
          select l.dst_doc_id as doc_id, l.kind, l.score, l.reason, l.src_id as chunk_id, l.dst_id as other_chunk_id
          from knowledge.chunk_links l
          where l.tenant_id = ${tid}::uuid and l.src_doc_id = ${docId}::uuid and l.dst_doc_id <> ${docId}::uuid
          union all
          select l.src_doc_id, l.kind, l.score, l.reason, l.dst_id, l.src_id
          from knowledge.chunk_links l
          where l.tenant_id = ${tid}::uuid and l.dst_doc_id = ${docId}::uuid and l.src_doc_id <> ${docId}::uuid)
        select l.doc_id::text, d.title, d.uri, l.kind as type, l.score, l.reason,
          l.chunk_id::text, l.other_chunk_id::text
        from l join knowledge.documents d on d.tenant_id = ${tid}::uuid and d.id = l.doc_id
        order by l.kind desc, l.score desc nulls last, l.doc_id, l.chunk_id, l.other_chunk_id
        limit ${limit}`);
      return rows.map((r) => ({
        docId: r.doc_id,
        title: r.title,
        uri: r.uri,
        type: r.type,
        score: num(r.score),
        reason: r.reason,
        chunkId: r.chunk_id,
        otherChunkId: r.other_chunk_id,
      }));
    },

    async neighbourhood(docId) {
      return tx.execute<NbRow>(nbSql(tid, docId));
    },

    async corpus(minShared, limit) {
      const rows = await tx.execute<CorpusRow>(sql`with docs as materialized (
          select id from knowledge.documents where tenant_id = ${tid}::uuid and kind <> 'contract'),
        pair as (select least(l.src_doc_id, l.dst_doc_id) as a, greatest(l.src_doc_id, l.dst_doc_id) as b,
            l.kind, count(*)::int as n
          from knowledge.chunk_links l
          where l.tenant_id = ${tid}::uuid and l.src_doc_id <> l.dst_doc_id
            and l.src_doc_id in (select id from docs) and l.dst_doc_id in (select id from docs)
          group by 1, 2, 3),
        de as materialized (select distinct c.doc_id, ce.entity_id
          from knowledge.chunk_entities ce join knowledge.chunks c on c.tenant_id = ${tid}::uuid and c.id = ce.chunk_id
          where ce.tenant_id = ${tid}::uuid and c.doc_id in (select id from docs)),
        sh as (select x.doc_id as a, y.doc_id as b, count(*)::int as n
          from de x join de y on y.entity_id = x.entity_id and x.doc_id < y.doc_id
          group by 1, 2 having count(*) >= ${minShared} order by n desc, a, b limit ${limit})
        select * from (
          select 'node' as row, d.id::text as a, null::text as b, d.title as label, 'Document' as type, 0 as n, 0 as rk
          from knowledge.documents d where d.tenant_id = ${tid}::uuid and d.id in (select id from docs)
          union all select 'pair', a::text, b::text, null, kind, n, 1 from pair
          union all select 'link', dl.src_id::text, dl.dst_id::text, null, 'LINKS_TO', 1, 2
            from knowledge.document_links dl where dl.tenant_id = ${tid}::uuid
              and dl.src_id in (select id from docs) and dl.dst_id in (select id from docs)
          union all select 'shares', a::text, b::text, null, 'SHARES', n, 3 from sh) z
        order by rk, n desc, a, b`);
      return rows.map((r) => ({ ...r, n: Number(r.n) }));
    },

    async stats() {
      return graphStats(tx, tid);
    },

    async conflicts(limit) {
      const rows = await tx.execute<ConfRow>(sql`with docs as materialized (
          select id from knowledge.documents where tenant_id = ${tid}::uuid and kind <> 'contract'),
        p as (select l.kind as type, least(l.src_doc_id, l.dst_doc_id) as a, greatest(l.src_doc_id, l.dst_doc_id) as b,
            max(l.score) as score, min(l.reason) as reason
          from knowledge.chunk_links l
          where l.tenant_id = ${tid}::uuid and l.src_doc_id <> l.dst_doc_id
            and l.src_doc_id in (select id from docs) and l.dst_doc_id in (select id from docs)
          group by 1, 2, 3
          order by case l.kind when 'CONFLICTS' then 0 else 1 end, max(l.score) desc nulls last, 2, 3
          limit ${limit})
        select p.type, a.id::text as a_id, a.title as a_title, a.uri as a_uri,
          b.id::text as b_id, b.title as b_title, b.uri as b_uri, p.score, p.reason
        from p join knowledge.documents a on a.tenant_id = ${tid}::uuid and a.id = p.a
          join knowledge.documents b on b.tenant_id = ${tid}::uuid and b.id = p.b
        order by case p.type when 'CONFLICTS' then 0 else 1 end, p.score desc nulls last, p.a, p.b`);
      return rows.map(
        (r): ConflictRow => ({
          type: r.type,
          a: { id: r.a_id, title: r.a_title, uri: r.a_uri },
          b: { id: r.b_id, title: r.b_title, uri: r.b_uri },
          score: num(r.score),
          reason: r.reason,
        }),
      );
    },
  };
}

export const graphRepos = (tx: Tx, tenantId: string): GraphRepos => ({
  graph: graphRepo(tx, tenantId),
});
