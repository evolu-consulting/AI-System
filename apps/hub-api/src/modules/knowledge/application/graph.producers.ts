// R1 · bộ SINH đồ thị (port `ingest/pipeline.py` phần sau chia đoạn + `resolve.link_aliases` + `query/similar.link_similar`), ghi
// qua cổng G1 (`graphService`: attach, linkDocuments, addAlias, addLinks). Luật 4c: số câu cố định mỗi tài liệu — attach 1 tx,
// linkDocuments 1, ứng viên bí danh 1, cặp đã là bí danh 1 (F-08, thay hasAlias từng cặp), ứng viên giống 1 (tìm FTS), addLinks
// 1 lô; addAlias ≤ `aliasMax` (mỗi cặp đã được LLM xác nhận 1 câu của G1). LLM gọi NGOÀI tx, song song có giới hạn (`workers`),
// số lần thử bí danh có trần (`aliasTryMax`). Lỗi từng bước ⇒ log + ghi `failed`, bước sau vẫn chạy (đồ thị best-effort như
// mgmt-app; nạp lại tài liệu chưa có đồ thị sẽ dựng lại — F-06).
import {
  aliasForm,
  aliasPairKey,
  aliasTries,
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
import type { GraphAi, Hit, IngestReadRepo, KnowledgeLog, KnowledgeRepo, Who } from "./ports";

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
  /** Số lời gọi LLM song song (mgmt-app `_EXTRACT_WORKERS` = 5). */
  workers?: number;
};
export type GraphReport = {
  entities: number;
  aliases: number;
  similar: number;
  conflicts: number;
  docLinks: number;
  /** F-06: bước lỗi (extract | doclinks | similar) — rỗng ⇒ đồ thị đầy đủ. */
  failed: string[];
};
export type ProduceInput = {
  docId: string;
  chunks: readonly Hit[];
  md: string;
  kind?: "contract" | "markdown";
};

const errName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

/** Chạy `fn` trên mọi phần tử, tối đa `n` lời gọi cùng lúc, giữ thứ tự kết quả (không tuần tự, không vô hạn). */
export async function mapLimit<T, R>(
  items: readonly T[],
  n: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const one = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i] as T);
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, n), items.length) }, one));
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

/**
 * `link_aliases`: ứng viên (1 câu) ⇒ cặp cùng dạng so (Map, ≤ aliasTryMax) ⇒ bỏ cặp đã là bí danh (1 câu cho cả lô) ⇒ LLM xác
 * nhận song song có giới hạn ⇒ addAlias ≤ aliasMax.
 */
async function linkAliases(d: ProducerDeps, who: Who, ents: readonly Entity[]): Promise<number> {
  const ai = d.ai;
  if (ents.length === 0 || !ai) return 0;
  const probes = [...new Map(ents.map((e) => [entityKey(e), e])).values()]
    .map((e) => ({ type: e.type, q: aliasForm(e.name) }))
    .filter((p) => p.q !== "");
  const tries = await d.uow.tenant(who, async (r) => {
    const t = aliasTries(ents, await r.ingest.aliasCandidates(probes));
    const done = await r.ingest.aliasedPairs(t);
    return t.filter((p) => !done.has(aliasPairKey(p.a, p.b)));
  });
  const same = await mapLimit(tries, d.workers ?? 5, (p) =>
    ai.sameEntity(who, { type: p.type, a: p.aName, b: p.bName }).catch(() => false),
  );
  let linked = 0;
  for (const p of tries.filter((_, i) => same[i]).slice(0, L.aliasMax)) {
    const r = await d.graph.addAlias(who, p.a, p.b);
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
  const ai = d.ai;
  if (ai) {
    const judged = pairs.filter((x) => x.score >= L.judge).slice(0, L.judgeMax);
    const verdicts = await mapLimit(judged, d.workers ?? 5, (p) =>
      ai.judge(who, { a: p.aText, b: p.bText }).catch(() => null),
    );
    judged.forEach((p, i) => {
      const v = verdicts[i];
      if (v?.verdict === "CONFLICT")
        rows.push({ a: p.a, b: p.b, kind: "CONFLICTS", reason: v.reason.slice(0, 500) });
    });
  }
  const w = await d.graph.addLinks(who, rows.slice(0, 1000));
  if (!w.ok) throw new Error(w.code); // F-06: không báo số cạnh khi ghi lỗi
  return { similar: pairs.length, conflicts: rows.length - pairs.length };
}

async function extractStep(d: ProducerDeps, who: Who, i: ProduceInput, rep: GraphReport) {
  const ai = d.ai;
  if (!ai) return;
  const ex = await mapLimit(i.chunks, d.workers ?? 5, (c) =>
    ai.extract(who, c.body).catch((): Extraction => ({ entities: [], relations: [] })),
  );
  const graph = i.chunks.map((c, n) => toChunkGraph(c.chunkId, ex[n] as Extraction));
  const r = await d.graph.attach(who, i.docId, graph);
  if (!r.ok) throw new Error(r.code);
  const ents = ex.flatMap((x) => x.entities);
  rep.entities = new Set(ents.map(entityKey)).size;
  rep.aliases = await linkAliases(d, who, ents);
}

/** Sinh đồ thị cho MỘT tài liệu vừa nạp (`chunks` = các đoạn của nó). */
export function graphProducers(d: ProducerDeps) {
  return async (who: Who, i: ProduceInput): Promise<GraphReport> => {
    const rep: GraphReport = {
      entities: 0,
      aliases: 0,
      similar: 0,
      conflicts: 0,
      docLinks: 0,
      failed: [],
    };
    const step = async (name: string, fn: () => Promise<void>) =>
      fn().catch((e) => {
        rep.failed.push(name);
        d.log?.("knowledge-graph-step-failed", { step: name, error_name: errName(e) });
      });
    await step("extract", () => extractStep(d, who, i, rep));
    await step("doclinks", async () => {
      const r = await d.graph.linkDocuments(who, i.docId, extractLinks(i.md));
      if (!r.ok) throw new Error(r.code);
      rep.docLinks = r.value;
    });
    // hợp đồng khác nhà cung cấp luôn khác nhau — mgmt-app chỉ so hợp đồng với phụ lục của nó (chưa có quan hệ đó ở đây)
    if (i.kind !== "contract")
      await step("similar", async () => {
        Object.assign(rep, await linkSimilar(d, who, i.docId, i.chunks));
      });
    return rep;
  };
}
