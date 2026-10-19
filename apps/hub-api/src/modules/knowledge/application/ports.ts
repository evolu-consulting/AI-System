// N4-FR-01…06 · ADR-0021 · ADR-0023 lớp 2 (chỉ kiểu): cổng của dịch vụ tri thức. Chiến lược truy hồi sau MỘT cổng
// (`RetrievalStrategy`) để (c) FTS và (a) embedding đổi cho nhau bằng cấu hình; `Embedder`/`Reranker` là dịch vụ ngoài tuỳ chọn
// (vắng key ⇒ không dựng, không gọi mạng).
import type { Chunk, DocKind } from "../domain/chunk.rules";
import type { Extraction, Verdict } from "../domain/extract.rules";
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
  /** R1 · nguồn của đoạn: vắng = kho nội bộ; "kh" = KnowledgeHub (tìm liên kết). */
  source?: string;
};

/**
 * R1 · nguồn tìm ngoài (KnowledgeHub…): bật theo cấu hình. KH là kho DÙNG CHUNG (khoá nền tảng, không theo tenant) ⇒ chỉ
 * tenant trong danh sách cho phép mới được hỏi (`allows`). `search` ném khi lỗi ⇒ bên gọi bỏ nguồn đó, vẫn trả kết quả nội bộ.
 */
export type ExternalSource = {
  readonly name: string;
  allows(tenantId: string): boolean;
  search(query: string, k: number, signal?: AbortSignal): Promise<Hit[]>;
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

/** R1 · thực thể đã có (G1 `knowledge.entities`) — ứng viên bí danh. */
export type ExistingEntity = { key: string; name: string; type: string };
/** R1 · đọc phục vụ nạp (1 câu mỗi hàm, theo tập). */
export type IngestReadRepo = {
  /** Thực thể cùng loại có tên chứa mọi từ của `q` (đã gấp dấu); tối đa 200. */
  aliasCandidates(probes: readonly { type: string; q: string }[]): Promise<ExistingEntity[]>;
};

/**
 * R1 · LLM cho đồ thị (port `extract.py` / `resolve.confirm_alias` / `judge_similar`). Vắng (không key) ⇒ không trích thực thể;
 * bản giả tất định cho dev/test. Văn bản đoạn là DỮ LIỆU (HUB-BR-31).
 */
export type GraphAi = {
  extract(text: string, signal?: AbortSignal): Promise<Extraction>;
  sameEntity(type: string, a: string, b: string, signal?: AbortSignal): Promise<boolean>;
  judge(a: string, b: string, signal?: AbortSignal): Promise<Verdict>;
};

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
