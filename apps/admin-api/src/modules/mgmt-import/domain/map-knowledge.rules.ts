// I1 · tri thức mgmt-app: documents + chunks (OpenSearch) ⇒ knowledge.documents/chunks; đồ thị Neo4j ⇒ bảng G1
// (knowledge.entities, chunk_entities, entity_aliases, entity_rels, chunk_links, document_links — nhánh slice/g1-graph).
// Tenant: tài liệu HĐ (domain=contract, id = id HĐ) theo org của HĐ; tài liệu chung (nội bộ, không org) theo `knowledgeOrg`.
// Thực thể Neo4j dùng chung toàn cục ⇒ nhân bản vào mỗi tenant có đoạn nhắc tới nó. Embedding KHÔNG chuyển (N4 dựng lại). Thuần.
import { type Ctx, docsOf, idOf, type Snapshot, type SourceDoc } from "./context";
import { bump, type Plan, push, type TenantPlan, tenantPlan } from "./plan";
import { int, str, ts } from "./values.rules";

type Kn = {
  docTenant: Map<string, TenantPlan>;
  docRow: Map<string, Record<string, unknown>>;
  chunkTenant: Map<string, TenantPlan>;
  cid: (mgmtId: string) => string;
  /** id HĐ mgmt ⇒ org (tài liệu HĐ theo org của HĐ). */
  orgOfContract: Map<string, string>;
};

function docTenant(
  d: SourceDoc,
  ctx: Ctx,
  p: Plan,
  orgOfContract: Map<string, string>,
): TenantPlan | null {
  const org = d.src.domain === "contract" ? orgOfContract.get(d.id) : ctx.knowledgeOrg;
  const tid = org ? ctx.tenantOf(org) : null;
  return tid && org ? tenantPlan(p, tid, org) : null;
}

const sha = (v: unknown): string | null =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : null;

function docRow(d: SourceDoc, ctx: Ctx, hash: string): Record<string, unknown> {
  return {
    id: idOf(ctx, "doc", d.id),
    title: str(d.src.title, 300) ?? d.id.slice(0, 300),
    kind: d.src.domain === "contract" ? "contract" : "markdown",
    source: `mgmt_${str(d.src.source_type, 30) ?? "upload"}`.slice(0, 40),
    uri: str(d.src.uri, 1000),
    content_hash: hash,
    chunk_count: 0,
    created_at: ts(d.src.created_at),
  };
}

function mapDocs(s: Snapshot, ctx: Ctx, p: Plan, k: Kn): void {
  const hashes = new Set<string>();
  for (const d of docsOf(s, "documents")) {
    const t = docTenant(d, ctx, p, k.orgOfContract);
    if (!t) {
      bump(p.noTenant, "documents");
      continue;
    }
    const hash = sha(d.src.content_hash);
    const key = `${t.tenantId}|${hash}`;
    if (!hash || hashes.has(key)) {
      ctx.issues.push({
        entity: "document",
        ref: `documents/${d.id}`,
        code: hash ? "DOC_DUP_HASH" : "DOC_NO_HASH",
      });
      continue;
    }
    hashes.add(key);
    const row = docRow(d, ctx, hash);
    push(t, "knowledge.documents", row);
    k.docRow.set(d.id, row);
    k.docTenant.set(d.id, t);
  }
}

function mapChunks(s: Snapshot, ctx: Ctx, k: Kn): void {
  const ords = new Set<string>();
  for (const d of docsOf(s, "chunks")) {
    const docId = str(d.src.doc_id, 300);
    const t = docId ? k.docTenant.get(docId) : undefined;
    const ord = int(d.src.chunk_index, 0);
    const text = str(d.src.text, 100_000);
    if (!t || !docId || ord === null || !text || ords.has(`${docId}|${ord}`)) {
      if (t) ctx.issues.push({ entity: "chunk", ref: `chunks/${d.id}`, code: "CHUNK_SKIPPED" });
      continue;
    }
    ords.add(`${docId}|${ord}`);
    if (Array.from(text).length > 8000)
      ctx.issues.push({ entity: "chunk", ref: `chunks/${d.id}`, code: "CHUNK_TRUNCATED" });
    push(t, "knowledge.chunks", {
      id: idOf(ctx, "chunk", d.id),
      doc_id: idOf(ctx, "doc", docId),
      ord,
      heading: str(d.src.heading, 400) ?? "",
      clause_no: str(d.src.clause_no, 20),
      context: "",
      body: str(text, 8000),
    });
    k.chunkTenant.set(d.id, t);
    const doc = k.docRow.get(docId);
    if (doc) doc.chunk_count = (doc.chunk_count as number) + 1;
  }
}

/** Thực thể theo khoá (nút Neo4j). */
function entityMeta(s: Snapshot): Map<string, { name: string; type: string }> {
  const meta = new Map<string, { name: string; type: string }>();
  for (const [key, name, type] of s.graph.entities ?? []) {
    const kk = str(key, 300);
    if (kk) meta.set(kk, { name: str(name, 300) ?? kk, type: str(type, 60) ?? "Concept" });
  }
  return meta;
}

/** MENTIONS ⇒ thực thể + chunk_entities theo tenant của đoạn; trả khoá ⇒ tập tenant có thực thể đó. */
function mapEntities(s: Snapshot, k: Kn): Map<string, Set<TenantPlan>> {
  const meta = entityMeta(s);
  const where = new Map<string, Set<TenantPlan>>();
  for (const [chunk, key] of s.graph.mentions ?? []) {
    const t = k.chunkTenant.get(String(chunk));
    const m = meta.get(String(key));
    if (!t || !m) continue;
    const set = where.get(String(key)) ?? new Set<TenantPlan>();
    if (!set.has(t)) push(t, "knowledge.entities", { key, ...m });
    set.add(t);
    where.set(String(key), set);
    push(t, "knowledge.chunk_entities", { chunk_id: k.cid(String(chunk)), key });
  }
  return where;
}

type Where = Map<string, Set<TenantPlan>>;
const both = (where: Where, a: unknown, b: unknown): TenantPlan[] =>
  [...(where.get(String(a)) ?? [])].filter((t) => where.get(String(b))?.has(t));

/** review C#25: tenant nhận một REL. Có đoạn làm chứng ⇒ CHỈ tenant của đoạn đó (đoạn không được nhập ⇒ không tenant nào,
 *  không rải sang tenant khác); không có đoạn làm chứng ⇒ mọi tenant có cả hai đầu. */
function relTenants(
  k: Kn,
  where: Where,
  rel: unknown[],
): { tenants: TenantPlan[]; evidence: string | null } {
  const [a, b, , ev] = rel;
  if (ev === null || ev === undefined) return { tenants: both(where, a, b), evidence: null };
  const evT = k.chunkTenant.get(String(ev));
  return {
    tenants: evT ? both(where, a, b).filter((t) => t === evT) : [],
    evidence: evT ? k.cid(String(ev)) : null,
  };
}

/** REL theo `relTenants`; ALIAS_OF: mọi tenant có cả hai đầu. */
function mapEntityEdges(s: Snapshot, k: Kn, where: Where): void {
  for (const rel of s.graph.rels ?? []) {
    const { tenants, evidence } = relTenants(k, where, rel);
    for (const t of tenants)
      push(t, "knowledge.entity_rels", {
        src: rel[0],
        dst: rel[1],
        type: str(rel[2], 60) ?? "RELATED",
        evidence,
      });
  }
  for (const [a, b] of s.graph.aliases ?? [])
    for (const t of both(where, a, b)) push(t, "knowledge.entity_aliases", { a, b });
}

/** SIMILAR/CONFLICTS giữa đoạn và LINKS_TO giữa tài liệu — chỉ khi hai đầu cùng tenant. */
function mapDocEdges(s: Snapshot, ctx: Ctx, k: Kn): void {
  for (const [x, y, kind, score, reason] of s.graph.chunk_links ?? []) {
    const t = k.chunkTenant.get(String(x));
    if (!t || t !== k.chunkTenant.get(String(y)) || x === y) continue;
    push(t, "knowledge.chunk_links", {
      src_id: k.cid(String(x)),
      dst_id: k.cid(String(y)),
      kind: kind === "CONFLICTS" ? "CONFLICTS" : "SIMILAR",
      score: typeof score === "number" ? score : null,
      reason: str(reason, 2000),
    });
  }
  for (const [a, b] of s.graph.doc_links ?? []) {
    const t = k.docTenant.get(String(a));
    if (!t || t !== k.docTenant.get(String(b)) || a === b) continue;
    push(t, "knowledge.document_links", {
      src_id: idOf(ctx, "doc", String(a)),
      dst_id: idOf(ctx, "doc", String(b)),
    });
  }
}

export function mapKnowledge(
  s: Snapshot,
  ctx: Ctx,
  p: Plan,
  orgOfContract: Map<string, string>,
): void {
  const k: Kn = {
    docTenant: new Map(),
    docRow: new Map(),
    chunkTenant: new Map(),
    cid: (m) => idOf(ctx, "chunk", m),
    orgOfContract,
  };
  mapDocs(s, ctx, p, k);
  mapChunks(s, ctx, k);
  mapEntityEdges(s, k, mapEntities(s, k));
  mapDocEdges(s, ctx, k);
}
