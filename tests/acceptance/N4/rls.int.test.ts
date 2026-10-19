// N4-FR-05 · N4-AC01 · ADR-0021 §2 + Hệ quả ("test chéo tenant không lộ đoạn nào"): bộ RLS theo hợp đồng TK1 cho schema
// `knowledge` (role `knowledge_rw`). Khai bảng + seed; ca đọc/ghi/chuyển/thăm dò chéo do `defineRlsSuite` sinh.
import { tenantId, userId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { defineRlsSuite, type RlsTable } from "@ai/test-kit/rls-suite";

const tenants = { a: tenantId(941), b: tenantId(942) };
const who = userId(941);
const hash = (): string => Bun.SHA256.hash(crypto.randomUUID(), "hex") as string;
const rnd = (pk?: string): string => pk ?? crypto.randomUUID();

const one = async (sql: Sql, text: string, params: unknown[]): Promise<string> => {
  const rows = (await sql.unsafe(
    `${text} returning id::text as id`,
    params as never[],
  )) as unknown as { id: string }[];
  return rows[0]?.id as string;
};
const firstOf = async (sql: Sql, table: string, t: string): Promise<string> => {
  const r = (await sql.unsafe(
    `select id::text as id from knowledge.${table} where tenant_id = $1 order by id limit 1`,
    [t],
  )) as unknown as { id: string }[];
  return r[0]?.id as string;
};

const tables: RlsTable[] = [
  {
    name: "documents",
    seed: (o, t) =>
      one(
        o,
        `insert into knowledge.documents (tenant_id, title, content_hash, created_by) values ($1, 'Tài liệu', $2, $3)`,
        [t, hash(), who],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into knowledge.documents (id, tenant_id, title, content_hash) values ($1, $2, 'X', $3)`,
        [rnd(pk), t, hash()],
      ),
  },
  {
    name: "chunks",
    seed: async (o, t) =>
      one(
        o,
        `insert into knowledge.chunks (tenant_id, doc_id, ord, body) values ($1, $2, 0, 'Điều 1. Bí mật của tenant')`,
        [t, await firstOf(o, "documents", t)],
      ),
    // cha giả: RLS chặn (42501) trước FK
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into knowledge.chunks (id, tenant_id, doc_id, ord, body) values ($1, $2, $3, 9, 'x')`,
        [rnd(pk), t, crypto.randomUUID()],
      ),
  },
  {
    name: "chunk_embeddings",
    seed: async (o, t) =>
      one(
        o,
        `insert into knowledge.chunk_embeddings (tenant_id, chunk_id, model, emb) values ($1, $2, 'm', array[0.1, 0.2]::real[])`,
        [t, await firstOf(o, "chunks", t)],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into knowledge.chunk_embeddings (id, tenant_id, chunk_id, model, emb) values ($1, $2, $3, 'm', array[1]::real[])`,
        [rnd(pk), t, crypto.randomUUID()],
      ),
  },
  {
    // R1 · bảng df (trigger giữ); seed owner trực tiếp để có hàng riêng mỗi tenant
    name: "lexemes",
    seed: (o, t) =>
      one(o, `insert into knowledge.lexemes (tenant_id, lexeme, df) values ($1, $2, 1)`, [
        t,
        `bimat${crypto.randomUUID().slice(0, 8)}`,
      ]),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into knowledge.lexemes (id, tenant_id, lexeme, df) values ($1, $2, $3, 1)`,
        [rnd(pk), t, `x${crypto.randomUUID().slice(0, 8)}`],
      ),
  },
  {
    name: "files",
    seed: (o, t) =>
      one(
        o,
        `insert into knowledge.files (tenant_id, org, file_id, name, mime, size_bytes, created_by) values ($1, $2, $3, 'a.docx', 'application/octet-stream', 1, $4)`,
        [t, `t_${t}`, crypto.randomUUID(), who],
      ),
    insert: (tx, t, pk) =>
      tx.unsafe(
        `insert into knowledge.files (id, tenant_id, org, file_id, name, mime, size_bytes, created_by) values ($1, $2, $3, $4, 'a.docx', 'application/octet-stream', 1, $5)`,
        [rnd(pk), t, `t_${t}`, crypto.randomUUID(), who],
      ),
  },
  {
    name: "index_outbox",
    writeOnly: true,
    seed: (o, t) =>
      one(
        o,
        `insert into knowledge.index_outbox (tenant_id, entity, entity_id, op) values ($1, 'document', $2, 'upsert')`,
        [t, crypto.randomUUID()],
      ),
    insert: (tx, t) =>
      tx.unsafe(
        `insert into knowledge.index_outbox (tenant_id, entity, entity_id, op) values ($1, 'document', $2, 'upsert')`,
        [t, crypto.randomUUID()],
      ),
  },
];

defineRlsSuite({
  key: "knowledge",
  tables,
  tenants,
  // G1: bảng đồ thị khai ở G1/rls.int.test.ts
  ignoreTables: [
    "entities",
    "chunk_entities",
    "entity_aliases",
    "entity_rels",
    "chunk_links",
    "document_links",
  ],
  open: async () => {
    await cloneDb("full");
    return openOwner(2);
  },
  close: (owner) => owner.end({ timeout: 2 }),
  reset: async (owner) => {
    await owner`truncate knowledge.chunk_embeddings, knowledge.chunks, knowledge.documents, knowledge.lexemes, knowledge.files, knowledge.index_outbox cascade`;
  },
});
