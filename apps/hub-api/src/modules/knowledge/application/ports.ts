// N4-FR-01…06 · ADR-0021 · ADR-0023 lớp 2 (chỉ kiểu): cổng của dịch vụ tri thức. Chiến lược truy hồi sau MỘT cổng
// (`RetrievalStrategy`) để (c) FTS và (a) embedding đổi cho nhau bằng cấu hình; `Embedder`/`Reranker` là dịch vụ ngoài tuỳ chọn
// (vắng key ⇒ không dựng, không gọi mạng).
import type { Chunk, DocKind } from "../domain/chunk.rules";
import type { QueryTerm } from "../domain/text.rules";

export type Who = { tenantId: string; userId: string | null };

export type NewDoc = {
  id: string;
  title: string;
  kind: DocKind;
  source: string;
  uri: string | null;
  contentHash: string;
  createdBy: string | null;
};
export type NewChunk = Chunk & { id: string; ord: number };

/** Một đoạn trả về cho người gọi (kết quả là DỮ LIỆU, không phải lệnh — HUB-BR-31). */
export type Hit = {
  chunkId: string;
  docId: string;
  title: string;
  heading: string;
  clauseNo: string | null;
  ord: number;
  body: string;
  score: number;
};

export type FtsMode = "idf" | "plain";
export type FtsOpts = { mode: FtsMode; limit: number };

export type KnowledgeRepo = {
  findByHash(hash: string): Promise<{ id: string; chunkCount: number } | null>;
  /** 1 câu SQL: tài liệu + mọi đoạn (một tham số jsonb). */
  insert(doc: NewDoc, chunks: readonly NewChunk[]): Promise<void>;
  getChunk(id: string): Promise<Hit | null>;
  getDocument(id: string): Promise<{ id: string; title: string; chunks: Hit[] } | null>;
  searchFts(terms: readonly QueryTerm[], o: FtsOpts): Promise<Hit[]>;
  /** 1 câu SQL cho cả lô. */
  insertEmbeddings(
    model: string,
    rows: readonly { chunkId: string; emb: number[] }[],
  ): Promise<void>;
  searchVector(model: string, emb: readonly number[], limit: number): Promise<Hit[]>;
};
export type KnowledgeRepos = { knowledge: KnowledgeRepo };

export type KnowledgeUow = {
  tenant<T>(who: Who, fn: (r: KnowledgeRepos) => Promise<T>): Promise<T>;
};

export type Embedder = {
  readonly model: string;
  /** Một lô văn bản → vector (cùng thứ tự). Ném khi lỗi mạng/API. */
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>;
};

export type Reranker = {
  /** Sắp lại `hits` theo độ liên quan với `query`, trả tối đa `k`. Ném khi lỗi ⇒ bên gọi giữ thứ tự cũ. */
  rerank(query: string, hits: readonly Hit[], k: number, signal?: AbortSignal): Promise<Hit[]>;
};

export type RetrievalStrategy = {
  /** "fts" (c) | "embedding" (a) — ghi vào kết quả/eval. */
  readonly name: string;
  search(who: Who, query: string, k: number, signal?: AbortSignal): Promise<Hit[]>;
};

export type KnowledgeLog = (msg: string, meta: Record<string, unknown>) => void;
