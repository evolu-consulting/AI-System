// N4-FR-04 (`knowledge.add`) · N4-FR-03 (`knowledge.search`) · N4-FR-06 (`knowledge.get`) · ADR-0021 §2: use case trên cổng.
// Mọi đọc/ghi trong tx của tenant người gọi (`KnowledgeUow` = `withPackScope` role `knowledge_rw`); thiếu/sai tenant ⇒
// `PackScopeError` trước khi mở tx (truy vấn thiếu tenant bị từ chối). Không gọi mạng trong tx; embedding (nếu có) gọi một
// lô SAU tx, lỗi ⇒ tài liệu vẫn tìm được bằng FTS (log, không ném).
import { chunkDocument } from "../domain/chunk.rules";
import {
  type AddInput,
  checkAdd,
  checkQuery,
  clampK,
  isUuid,
  type KnowledgeError,
  kindOf,
  LIMITS,
  rrf,
} from "../domain/knowledge.rules";
import type {
  Embedder,
  ExternalSource,
  Hit,
  KnowledgeLog,
  KnowledgeUow,
  NewChunk,
  Reranker,
  RerankRequest,
  RetrievalStrategy,
  Who,
} from "./ports";

export type Result<T> = { ok: true; value: T } | { ok: false; code: KnowledgeError };
const fail = <T>(code: KnowledgeError): Result<T> => ({ ok: false, code });

export type AddDeps = {
  uow: KnowledgeUow;
  newId: () => string;
  sha256: (s: string) => string;
  embedder?: Embedder | null;
  log?: KnowledgeLog;
  /** Lô embedding mỗi lời gọi API. */
  embedBatch?: number;
  /** Gắn ngữ cảnh tài liệu vào đoạn (mặc định bật; tắt chỉ để đo đối chứng eval). */
  docContext?: boolean;
};
export type AddOutput = {
  documentId: string;
  chunks: number;
  duplicate: boolean;
  embedded: number;
};

export function addDocument(d: AddDeps) {
  return async (who: Who, i: AddInput & { source?: string }): Promise<Result<AddOutput>> => {
    const bad = checkAdd(i);
    if (bad) return fail(bad);
    const kind = kindOf(i.kind);
    const title = i.title.trim();
    const hash = d.sha256(`${kind}\n${i.content}`);
    const all = chunkDocument(title, i.content, kind);
    const parts = d.docContext === false ? all.map((c) => ({ ...c, context: "" })) : all;
    if (parts.length > LIMITS.chunksMax) return fail("TOO_MANY_CHUNKS");
    const docId = d.newId();
    const chunks: NewChunk[] = parts.map((c, ord) => ({ ...c, id: d.newId(), ord }));
    const saved = await d.uow.tenant(who, async (r) => {
      const dup = await r.knowledge.findByHash(hash);
      if (dup) return { documentId: dup.id, chunks: dup.chunkCount, duplicate: true };
      await r.knowledge.insert(
        {
          id: docId,
          title,
          kind,
          source: i.source ?? "mcp",
          uri: i.uri ?? null,
          contentHash: hash,
          createdBy: who.userId,
        },
        chunks,
      );
      return { documentId: docId, chunks: chunks.length, duplicate: false };
    });
    const embedded = saved.duplicate ? 0 : await embedChunks(d, who, chunks);
    return { ok: true, value: { ...saved, embedded } };
  };
}

/** Embedding theo lô (không gọi theo từng đoạn); lỗi ⇒ 0 + log. */
async function embedChunks(d: AddDeps, who: Who, chunks: readonly NewChunk[]): Promise<number> {
  const e = d.embedder;
  if (!e || chunks.length === 0) return 0;
  const size = d.embedBatch ?? 96;
  try {
    const rows: { chunkId: string; emb: number[] }[] = [];
    for (let i = 0; i < chunks.length; i += size) {
      const part = chunks.slice(i, i + size);
      const vecs = await e.embed(part.map((c) => `${c.context}\n${c.body}`));
      for (const [j, c] of part.entries()) rows.push({ chunkId: c.id, emb: vecs[j] as number[] });
    }
    await d.uow.tenant(who, (r) => r.knowledge.insertEmbeddings(e.model, rows));
    return rows.length;
  } catch (err) {
    d.log?.("knowledge-embed-failed", { error_name: err instanceof Error ? err.name : "unknown" });
    return 0;
  }
}

export type SearchDeps = {
  strategy: RetrievalStrategy;
  reranker?: Reranker | null;
  /** R1 · nguồn ngoài (KnowledgeHub); rỗng/vắng ⇒ chỉ kho nội bộ. */
  sources?: readonly ExternalSource[];
  log?: KnowledgeLog;
};
export type SearchOutput = {
  strategy: string;
  reranked: boolean;
  /** R1 · nguồn ngoài ĐÃ trả lời lần này (rỗng khi tắt/lỗi/không được phép). */
  federated: string[];
  hits: Hit[];
};

const errName = (err: unknown): string => (err instanceof Error ? err.name : "unknown");

/** Hỏi song song mọi nguồn ngoài tenant được phép; nguồn lỗi bị bỏ (log, không ném). */
async function askSources(
  d: SearchDeps,
  who: Who,
  q: { query: string; pool: number },
  signal?: AbortSignal,
): Promise<{ name: string; hits: Hit[] }[]> {
  const on = (d.sources ?? []).filter((s) => s.allows(who.tenantId));
  const got = await Promise.allSettled(on.map((s) => s.search(q.query, q.pool, signal)));
  return got.flatMap((r, i) => {
    const name = (on[i] as ExternalSource).name;
    if (r.status === "fulfilled")
      return [{ name, hits: r.value.map((h) => ({ ...h, source: name })) }];
    d.log?.("knowledge-source-failed", { source: name, error_name: errName(r.reason) });
    return [];
  });
}

/** Rerank (có key) trên tập đã gộp; lỗi/không key ⇒ giữ thứ tự gộp (FTS khi không có nguồn ngoài). */
async function rerankOrKeep(
  d: SearchDeps,
  r: RerankRequest,
  signal?: AbortSignal,
): Promise<{ reranked: boolean; hits: Hit[] }> {
  const { hits, k } = r;
  if (!d.reranker || hits.length <= 1) return { reranked: false, hits: hits.slice(0, k) };
  try {
    return { reranked: true, hits: (await d.reranker.rerank(r, signal)).slice(0, k) };
  } catch (err) {
    d.log?.("knowledge-rerank-failed", { error_name: errName(err) });
    return { reranked: false, hits: hits.slice(0, k) };
  }
}

/**
 * Nội bộ ‖ nguồn ngoài (song song) ⇒ gộp RRF (chỉ khi có nguồn ngoài trả hit; không thì giữ thứ tự FTS) ⇒ rerank Claude khi
 * có key. Kết quả là DỮ LIỆU (HUB-BR-31).
 */
export function searchKnowledge(d: SearchDeps) {
  return async (
    who: Who,
    i: { query: string; k?: unknown },
    signal?: AbortSignal,
  ): Promise<Result<SearchOutput>> => {
    const bad = checkQuery(i.query);
    if (bad) return fail(bad);
    const k = clampK(i.k);
    const query = i.query.trim();
    const pool = d.reranker || d.sources?.length ? Math.max(k, LIMITS.candidates) : k;
    const [local, ext] = await Promise.all([
      d.strategy.search(who, query, pool, signal),
      askSources(d, who, { query, pool }, signal),
    ]);
    const extHits = ext.filter((e) => e.hits.length > 0);
    const merged = extHits.length ? rrf([local, ...extHits.map((e) => e.hits)]) : local;
    const out = await rerankOrKeep(d, { who, query, hits: merged, k }, signal);
    return {
      ok: true,
      value: { strategy: d.strategy.name, federated: ext.map((e) => e.name), ...out },
    };
  };
}

export type GetOutput =
  | { kind: "chunk"; hit: Hit }
  | { kind: "document"; id: string; title: string; chunks: Hit[] };

/** `id` = id đoạn (ưu tiên) hoặc id tài liệu. Không thấy (kể cả id của tenant khác — RLS) ⇒ `null`. */
export function getKnowledge(d: { uow: KnowledgeUow }) {
  return async (who: Who, id: string): Promise<Result<GetOutput | null>> => {
    if (!isUuid(id)) return fail("ID_INVALID");
    const out = await d.uow.tenant(who, async (r): Promise<GetOutput | null> => {
      const hit = await r.knowledge.getChunk(id);
      if (hit) return { kind: "chunk", hit };
      const doc = await r.knowledge.getDocument(id);
      return doc ? { kind: "document", ...doc } : null;
    });
    return { ok: true, value: out };
  };
}
