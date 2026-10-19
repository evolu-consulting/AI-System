// R1 · bộ SINH đồ thị (port `ingest/pipeline.py` phần sau chia đoạn + `resolve.link_aliases` + `query/similar.link_similar`), ghi
// qua cổng G1 (`graphService`: attach, linkDocuments, addAlias, addLinks). Luật 4c: số câu cố định mỗi tài liệu — attach 1 tx,
// linkDocuments 1, ứng viên bí danh 1, ứng viên giống 1 (tìm FTS), addLinks 1 lô; addAlias ≤ `aliasMax` (mỗi cặp 1 câu của G1).
// LLM gọi NGOÀI tx; lỗi từng bước ⇒ log, bước sau vẫn chạy (đồ thị là best-effort như mgmt-app).

import {
  aliasForm,
  docProbeTerms,
  type Entity,
  type Extraction,
  entityKey,
  EXTRACT_LIMITS as L,
  similarPairs,
} from "../domain/extract.rules";
import { extractLinks } from "../domain/ingest.rules";
import type { ChunkGraphIn, ChunkLinkIn, EntityIn } from "./graph.ports";
import type { GraphService } from "./graph.usecases";
import type {
  ExistingEntity,
  GraphAi,
  Hit,
  IngestReadRepo,
  KnowledgeLog,
  KnowledgeRepo,
  Who,
} from "./ports";

export type IngestUow = {
  tenant<T>(
    who: Who,
    fn: (r: { knowledge: KnowledgeRepo; ingest: IngestReadRepo }) => Promise<T>,
  ): Promise<T>;
};
export type ProducerDeps = {
  graph: GraphService;
  uow: IngestUow;
  ai: GraphAi | null;
  log?: KnowledgeLog;
  /** Số lời gọi LLM trích song song (mgmt-app `_EXTRACT_WORKERS` = 5). */
  workers?: number;
};
export type GraphReport = {
  entities: number;
  aliases: number;
  similar: number;
  conflicts: number;
  docLinks: number;
};

const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

/** Trích song song có giới hạn (không theo từng đoạn tuần tự, không vô hạn). */
async function extractAll(
  ai: GraphAi,
  texts: readonly string[],
  workers: number,
): Promise<Extraction[]> {
  const out: Extraction[] = new Array(texts.length);
  let next = 0;
  const one = async () => {
    for (let i = next++; i < texts.length; i = next++)
      out[i] = await ai.extract(texts[i] as string).catch(() => ({ entities: [], relations: [] }));
  };
  await Promise.all(Array.from({ length: Math.min(workers, texts.length) }, one));
  return out;
}

/** Extraction mỗi đoạn ⇒ `ChunkGraphIn` (quan hệ theo tên ⇒ theo key). */
export function toChunkGraph(chunkId: string, ex: Extraction): ChunkGraphIn {
  const byName = new Map(ex.entities.map((e) => [e.name, entityKey(e)]));
  const entities: EntityIn[] = ex.entities.map((e) => ({
    key: entityKey(e),
    name: e.name,
    type: e.type,
  }));
  const relations = ex.relations.flatMap((r) => {
    const src = byName.get(r.src);
    const dst = byName.get(r.dst);
    return src && dst ? [{ src, dst, type: r.type }] : [];
  });
  return { chunkId, entities, relations };
}

/** `link_aliases`: ứng viên (1 câu) ⇒ cùng dạng so ⇒ LLM xác nhận ⇒ addAlias; ≤ 1 bí danh mỗi thực thể, ≤ aliasMax mỗi lần. */
async function linkAliases(d: ProducerDeps, who: Who, ents: readonly Entity[]): Promise<number> {
  const uniq = [...new Map(ents.map((e) => [entityKey(e), e])).values()];
  if (uniq.length === 0 || !d.ai) return 0;
  const probes = uniq
    .map((e) => ({ type: e.type, q: aliasForm(e.name) }))
    .filter((p) => p.q !== "");
  const cands: ExistingEntity[] = await d.uow.tenant(who, (r) => r.ingest.aliasCandidates(probes));
  let linked = 0;
  for (const e of uniq) {
    if (linked >= L.aliasMax) break;
    const key = entityKey(e);
    const c = cands.find(
      (x) => x.type === e.type && x.key !== key && aliasForm(x.name) === aliasForm(e.name),
    );
    if (!c) continue;
    const has = await d.graph.hasAlias(who, key, c.key);
    if (has.ok && has.value) continue;
    if (!(await d.ai.sameEntity(e.type, e.name, c.name).catch(() => false))) continue;
    const r = await d.graph.addAlias(who, key, c.key);
    if (r.ok && r.value) linked++;
  }
  return linked;
}

/** `link_similar`: ứng viên = 1 lần tìm FTS theo từ đại diện tài liệu; cặp giống ⇒ SIMILAR; cặp gần trùng ⇒ LLM phán CONFLICTS. */
async function linkSimilar(d: ProducerDeps, who: Who, docId: string, chunks: readonly Hit[]) {
  const terms = docProbeTerms(chunks.map((c) => c.body)).map((term) => ({ term, w: 1 }));
  if (terms.length === 0) return { similar: 0, conflicts: 0 };
  const others = await d.uow.tenant(who, (r) =>
    r.knowledge.searchFts(terms, { mode: "idf", limit: 60 + chunks.length }),
  );
  const pairs = similarPairs(
    chunks.map((c) => ({ id: c.chunkId, docId, body: c.body })),
    others
      .filter((o) => o.docId !== docId)
      .map((o) => ({ id: o.chunkId, docId: o.docId, body: o.body })),
  );
  const rows: ChunkLinkIn[] = pairs.map((p) => ({
    a: p.a,
    b: p.b,
    kind: "SIMILAR",
    score: p.score,
  }));
  if (d.ai)
    for (const p of pairs.filter((x) => x.score >= L.judge).slice(0, L.judgeMax)) {
      const v = await d.ai.judge(p.aText, p.bText).catch(() => null);
      if (v?.verdict === "CONFLICT")
        rows.push({ a: p.a, b: p.b, kind: "CONFLICTS", reason: v.reason.slice(0, 500) });
    }
  const w = await d.graph.addLinks(who, rows.slice(0, 1000));
  if (!w.ok) d.log?.("knowledge-graph-links-failed", { code: w.code });
  return { similar: pairs.length, conflicts: rows.length - pairs.length };
}

/** Sinh đồ thị cho MỘT tài liệu vừa nạp (`chunks` = các đoạn của nó). */
export function graphProducers(d: ProducerDeps) {
  return async (
    who: Who,
    docId: string,
    chunks: readonly Hit[],
    md: string,
    kind: "contract" | "markdown" = "markdown",
  ): Promise<GraphReport> => {
    const rep: GraphReport = { entities: 0, aliases: 0, similar: 0, conflicts: 0, docLinks: 0 };
    const step = async (name: string, fn: () => Promise<void>) =>
      fn().catch((e) =>
        d.log?.("knowledge-graph-step-failed", { step: name, error_name: errName(e) }),
      );
    await step("extract", async () => {
      if (!d.ai) return;
      const ex = await extractAll(
        d.ai,
        chunks.map((c) => c.body),
        d.workers ?? 5,
      );
      const graph = chunks.map((c, i) => toChunkGraph(c.chunkId, ex[i] as Extraction));
      const r = await d.graph.attach(who, docId, graph);
      if (!r.ok) throw new Error(r.code);
      const ents = ex.flatMap((x) => x.entities);
      rep.entities = new Set(ents.map(entityKey)).size;
      rep.aliases = await linkAliases(d, who, ents);
    });
    await step("doclinks", async () => {
      const r = await d.graph.linkDocuments(who, docId, extractLinks(md));
      rep.docLinks = r.ok ? r.value : 0;
    });
    // hợp đồng khác nhà cung cấp luôn khác nhau — mgmt-app chỉ so hợp đồng với phụ lục của nó (chưa có quan hệ đó ở đây)
    if (kind !== "contract")
      await step("similar", async () => {
        Object.assign(rep, await linkSimilar(d, who, docId, chunks));
      });
    return rep;
  };
}
