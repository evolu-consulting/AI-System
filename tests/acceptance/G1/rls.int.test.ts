// G1 · CR-095 · TK1: hợp đồng cách ly tenant cho bảng đồ thị trong schema `knowledge` (role `knowledge_rw`, RLS FORCE). Bảng
// cạnh không có cột `id` ⇒ khoá dùng cho ca thăm dò là cột đầu (uuid, duy nhất trong seed). Bảng N4 khai ở N4/rls.int.test.ts.
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { defineRlsSuite, type RlsTable } from "@ai/test-kit/rls-suite";

const tenants = { a: tenantId(981), b: tenantId(982) };
const who = userId(981);
const rnd = (pk?: string): string => pk ?? crypto.randomUUID();
const ids = async (sql: Sql, text: string, params: unknown[]): Promise<string[]> =>
  ((await sql.unsafe(text, params as never[])) as unknown as { id: string }[]).map((r) => r.id);

/** Mỗi tenant: 2 tài liệu × 1 đoạn + 2 thực thể (owner, bỏ RLS). */
const base = new Map<string, { docs: string[]; chunks: string[]; ents: string[] }>();
async function baseOf(o: Sql, t: string) {
  const got = base.get(t);
  if (got) return got;
  const docs = await ids(
    o,
    `insert into knowledge.documents (tenant_id, title, content_hash, created_by)
     select $1::uuid, 'Tài liệu ' || g, md5($1::text || g) || md5(g::text), $2 from generate_series(1, 2) g returning id::text as id`,
    [t, who],
  );
  const chunks = await ids(
    o,
    `insert into knowledge.chunks (tenant_id, doc_id, ord, body)
     select $1, d, 0, 'Bí mật của tenant' from unnest($2::uuid[]) d returning id::text as id`,
    [t, docs],
  );
  const ents = (
    await ids(
      o,
      `insert into knowledge.entities (tenant_id, key, name, type)
       select $1, 'P:' || g, 'Tên ' || g, 'P' from generate_series(1, 2) g returning id::text as id`,
      [t],
    )
  ).sort();
  const v = { docs, chunks, ents };
  base.set(t, v);
  return v;
}
const first = async (o: Sql, text: string, params: unknown[]) =>
  (await ids(o, text, params))[0] as string;

const tables: RlsTable[] = [
  {
    name: "entities",
    seed: async (o, t) => (await baseOf(o, t)).ents[0] as string,
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into knowledge.entities (id, tenant_id, key, name, type) values ($1, $2, $3, 'X', 'P')`,
        [rnd(pk), t, `P:${crypto.randomUUID()}`],
      ),
  },
  {
    name: "chunk_entities",
    pk: "chunk_id",
    seed: async (o, t) => {
      const b = await baseOf(o, t);
      return first(
        o,
        `insert into knowledge.chunk_entities (tenant_id, chunk_id, entity_id) values ($1, $2, $3) returning chunk_id::text as id`,
        [t, b.chunks[0], b.ents[0]],
      );
    },
    // cha giả: RLS chặn (42501) trước FK
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into knowledge.chunk_entities (tenant_id, chunk_id, entity_id) values ($1, $2, $3)`,
        [t, rnd(pk), crypto.randomUUID()],
      ),
  },
  {
    name: "entity_aliases",
    pk: "a_id",
    seed: async (o, t) => {
      const b = await baseOf(o, t);
      return first(
        o,
        `insert into knowledge.entity_aliases (tenant_id, a_id, b_id) values ($1, $2, $3) returning a_id::text as id`,
        [t, b.ents[0], b.ents[1]],
      );
    },
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into knowledge.entity_aliases (tenant_id, a_id, b_id) values ($1, $2, 'ffffffff-ffff-4fff-8fff-fffffffffffe')`,
        [t, rnd(pk)],
      ),
  },
  {
    name: "entity_rels",
    pk: "src_id",
    seed: async (o, t) => {
      const b = await baseOf(o, t);
      return first(
        o,
        `insert into knowledge.entity_rels (tenant_id, src_id, dst_id, type, evidence_chunk_id) values ($1, $2, $3, 'R', $4)
         returning src_id::text as id`,
        [t, b.ents[0], b.ents[1], b.chunks[0]],
      );
    },
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into knowledge.entity_rels (tenant_id, src_id, dst_id, type) values ($1, $2, $3, 'R')`,
        [t, rnd(pk), crypto.randomUUID()],
      ),
  },
  {
    name: "chunk_links",
    pk: "src_id",
    seed: async (o, t) => {
      const b = await baseOf(o, t);
      return first(
        o,
        `insert into knowledge.chunk_links (tenant_id, src_id, dst_id, kind, score, src_doc_id, dst_doc_id)
         values ($1, $2, $3, 'SIMILAR', 0.9, $4, $5) returning src_id::text as id`,
        [t, b.chunks[0], b.chunks[1], b.docs[0], b.docs[1]],
      );
    },
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into knowledge.chunk_links (tenant_id, src_id, dst_id, kind, src_doc_id, dst_doc_id)
         values ($1, $2, $3, 'CONFLICTS', $3, $3)`,
        [t, rnd(pk), crypto.randomUUID()],
      ),
  },
  {
    name: "document_links",
    pk: "src_id",
    seed: async (o, t) => {
      const b = await baseOf(o, t);
      return first(
        o,
        `insert into knowledge.document_links (tenant_id, src_id, dst_id) values ($1, $2, $3) returning src_id::text as id`,
        [t, b.docs[0], b.docs[1]],
      );
    },
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into knowledge.document_links (tenant_id, src_id, dst_id) values ($1, $2, $3)`,
        [t, rnd(pk), crypto.randomUUID()],
      ),
  },
];

defineRlsSuite({
  key: "knowledge",
  tables,
  tenants,
  ignoreTables: ["documents", "chunks", "chunk_embeddings", "lexemes", "files", "index_outbox"], // lexemes: R1, bộ N4
  open: async () => {
    await cloneDb("full");
    return openOwner(2);
  },
  close: (owner) => owner.end({ timeout: 2 }),
  reset: async (owner) => {
    base.clear();
    await owner`truncate knowledge.entities, knowledge.documents cascade`;
  },
});
