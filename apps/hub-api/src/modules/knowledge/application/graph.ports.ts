// G1 · CR-095 (bỏ Neo4j): cổng đồ thị tri thức trên bảng Postgres `knowledge.*` (thay `app/store/graph.py` của mgmt-app).
// Mọi id là uuid của N4 (`documents.id`, `chunks.id`); thực thể định danh bằng `key` (vd "Project:apollo") trong tenant.
// Mỗi hàm = số câu SQL cố định (Luật 4c), không phụ thuộc số hàng.
import type { Who } from "./ports";

export type EntityIn = { key: string; name: string; type: string };
export type RelationIn = { src: string; dst: string; type: string };
/** Thực thể/quan hệ trích từ một đoạn (MENTIONS + REL của `upsert_document`). */
export type ChunkGraphIn = { chunkId: string; entities: EntityIn[]; relations: RelationIn[] };

export type LinkKind = "SIMILAR" | "CONFLICTS";
export type ChunkLinkIn = {
  a: string;
  b: string;
  kind: LinkKind;
  score?: number | null;
  reason?: string | null;
};

export type SimilarRow = {
  docId: string;
  title: string;
  uri: string | null;
  type: LinkKind;
  score: number | null;
  reason: string | null;
  chunkId: string;
  otherChunkId: string;
};

/** Hàng thô của `neighbourhood` (một câu SQL); `toNeighbourhood` dựng nodes/links như mgmt-app. */
export type NbRowKind = "doc" | "mention" | "rel" | "alias" | "doclink";
export type NbRow = {
  row: NbRowKind;
  src: string;
  dst: string | null;
  label: string;
  ntype: string;
  ltype: string | null;
};

export type CorpusRowKind = "node" | "pair" | "link" | "shares";
export type CorpusRow = {
  row: CorpusRowKind;
  a: string;
  b: string | null;
  label: string | null;
  type: string;
  n: number;
};

export type GraphNode = { id: string; label: string; type: string };
export type GraphLink = { source: string; target: string; type: string; n?: number };
export type Graph = { nodes: GraphNode[]; links: GraphLink[] };

export type DocRef = { id: string; title: string; uri: string | null };
export type ConflictRow = {
  type: LinkKind;
  a: DocRef;
  b: DocRef;
  score: number | null;
  reason: string | null;
};
export type GraphStats = {
  entities: { total: number; byType: Record<string, number>; aliasPairs: number };
  links: { conflicts: number; duplicates: number };
};

export type GraphRepo = {
  /** Ghi MENTIONS + thực thể + REL cho các đoạn của `docId` (thay MENTIONS cũ của tài liệu). 2 câu. */
  attach(docId: string, chunks: readonly ChunkGraphIn[]): Promise<void>;
  /** LINKS_TO tới tài liệu có `uri` thuộc danh sách (bỏ chính nó). 1 câu; trả số cạnh mới. */
  linkDocuments(docId: string, uris: readonly string[]): Promise<number>;
  /** Đoạn nhắc tới thực thể `keys` hoặc bí danh trực tiếp của chúng (ALIAS_OF*0..1). 1 câu. */
  expand(keys: readonly string[], exclude: readonly string[], limit: number): Promise<string[]>;
  hasAlias(a: string, b: string): Promise<boolean>;
  /** true khi vừa thêm (cả hai thực thể có, chưa là bí danh của nhau). */
  addAlias(a: string, b: string): Promise<boolean>;
  /** SIMILAR/CONFLICTS theo lô (1 câu); cạnh đã có ⇒ cập nhật score/reason. Trả số hàng ghi. */
  addLinks(rows: readonly ChunkLinkIn[]): Promise<number>;
  similarDocuments(docId: string, limit: number): Promise<SimilarRow[]>;
  neighbourhood(docId: string): Promise<NbRow[]>;
  corpus(minShared: number, limit: number): Promise<CorpusRow[]>;
  stats(): Promise<GraphStats>;
  conflicts(limit: number): Promise<ConflictRow[]>;
};
export type GraphRepos = { graph: GraphRepo };

export type GraphUow = {
  tenant<T>(who: Who, fn: (r: GraphRepos) => Promise<T>): Promise<T>;
};
